/**
 * W3's TypeScript run against W2's REAL SQL, on the whole migration chain (full_chain.ts), as
 * service_role. Every other W3 test fakes the database, which is exactly how a shape mismatch
 * hides: an earlier W3 read heal_account_deletions' `scrub_errors` (an ARRAY) with a number helper,
 * so a failing scrub read as "no errors", and nothing could notice because the fake agreed with
 * the code instead of with the database. Here the database is the arbiter.
 *
 * Against REAL Postgres (PGlite). NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 *   deno test --allow-read --allow-env supabase/tests/account_deletion_functions.pglite.test.ts
 *
 * The chain includes THIS branch's own 20261125000011 (the cron guard), so it is exercised against
 * the real unclocked_deleted_seat_turns() too.
 *
 * `admin` below is a thin stand-in for the supabase-js service-role client: .rpc() runs the named
 * function as service_role (so a missing grant fails here) and resolves { data, error } like
 * PostgREST (error, never a throw); .from() reads league_members; auth.admin.deleteUser deletes the
 * auth row like GoTrue (404 user_not_found when absent).
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { loadChain } from './full_chain.ts';
import { finishAuthStage, finishDeletion } from '../functions/_shared/account-deletion.ts';
import { makeLedgerDeps } from '../functions/_shared/account-deletion-db.ts';
import { decideDeletedSeatPick, listUnclockedDeletedSeatTurns, seatReader } from '../functions/_shared/deleted-seat.ts';
import { clientResponse, previewResponse, statusFor } from '../functions/join-league/takeover.ts';
import { type HealDeps, parseHealResult, runHeal, UNREVOKED_LOG_LINE } from '../functions/heal-account-deletions/run.ts';
import type { DraftClock } from '../functions/_shared/auto-pick.ts';

// deno-lint-ignore no-explicit-any
type Row = any;

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LG = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TABLE_FNS = new Set(['unclocked_deleted_seat_turns']);

function makeAdmin(db: PGlite) {
  const asService = async <T>(fn: () => Promise<T>): Promise<T> => {
    await db.exec('set role service_role');
    try { return await fn(); } finally { await db.exec('reset role'); }
  };
  // deno-lint-ignore no-explicit-any
  const err = (e: any) => ({ code: e?.code, message: e?.message, status: undefined });
  return {
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const keys = Object.keys(args);
      const call = `public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
      const sql = TABLE_FNS.has(fn)
        ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as v from ${call} t`
        : `select to_jsonb(${call}) as v`;
      try {
        const { rows } = await asService(() => db.query<Row>(sql, keys.map((k) => args[k])));
        return { data: rows[0]?.v ?? null, error: null };
      } catch (e) {
        return { data: null, error: err(e) };
      }
    },
    from(table: string) {
      const eqs: Array<[string, unknown]> = [];
      let cols = '*';
      const q = {
        select(c: string) { cols = c; return q; },
        eq(c: string, v: unknown) { eqs.push([c, v]); return q; },
        async maybeSingle() {
          const where = eqs.map(([c], i) => `${c} = $${i + 1}`).join(' and ');
          try {
            const { rows } = await asService(() =>
              db.query<Row>(`select ${cols} from public.${table}${where ? ` where ${where}` : ''}`, eqs.map(([, v]) => v)));
            // PostgREST's maybeSingle: more than one row is an ERROR (PGRST116), not "the first one".
            if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows', status: undefined } };
            return { data: rows[0] ?? null, error: null };
          } catch (e) {
            return { data: null, error: err(e) };
          }
        },
      };
      return q;
    },
    auth: {
      admin: {
        async deleteUser(id: string) {
          const { rows } = await db.query<Row>(`delete from auth.users where id = $1 returning id`, [id]);
          return rows.length ? { error: null } : { error: { status: 404, code: 'user_not_found' } };
        },
      },
    },
  };
}

Deno.test({
  name: 'W3 TypeScript against W2 SQL: the pipeline, the heal, Apple, refusals, takeover shapes, the deleted-seat plumbing',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    await loadChain(db);
    const q = async (s: string, p: unknown[] = []) => (await db.query<Row>(s, p)).rows;
    const one = async (s: string, p: unknown[] = []) => (await q(s, p))[0];
    const admin = makeAdmin(db);
    const deps = makeLedgerDeps(admin);
    const user = (n: number) => q(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [U(n), { username: `user_${n}` }]);
    const ledger = async (n: number) => await one(`select stage, apple_revoke, last_error from public.account_deletions where user_id = $1`, [U(n)]);
    const authExists = async (n: number) => (await q(`select 1 from auth.users where id = $1`, [U(n)])).length === 1;
    const age = (n: number, interval = '20 minutes') =>
      q(`update public.account_deletions set updated_at = now() - $2::interval, requested_at = now() - $2::interval where user_id = $1`, [U(n), interval]);
    const quiet = async <T>(fn: () => Promise<T>) => {
      const o = { log: console.log, error: console.error };
      const lines: string[] = [];
      console.log = () => {};
      console.error = (...a: unknown[]) => lines.push(a.map(String).join(' '));
      try { return { out: await fn(), lines }; } finally { Object.assign(console, o); }
    };
    const vaultCount = async (n: number) => Number((await one(`select count(*)::int c from vault.secrets where name = $1`, [`apple_revoke:${U(n)}`])).c);
    // Notices the heal hands to delivery (the real scrub results' shape, parsed by W3's scrubNotices).
    const delivered: Array<{ kind: string; recipient: string; league_id: string | null }> = [];
    const healDeps = (over: Partial<HealDeps> = {}): HealDeps => ({
      ...deps,
      deliverNotices: (n) => { delivered.push(...n.map(({ kind, recipient, league_id }) => ({ kind, recipient, league_id }))); return Promise.resolve(); },
      appleConfigured: true,
      revokeAppleToken: () => Promise.resolve({ kind: 'ok' }),
      hashId: (id) => Promise.resolve(`h-${id.slice(-2)}`),
      ...over,
    });

    await t.step("the user's request path: open → scrub → auth delete → mark_done 'done' (ok only then)", async () => {
      await user(1);
      const opened = await deps.openLedger(U(1), false);
      assertEquals(opened.error, null);
      assertEquals(opened.row, { stage: 'requested', apple_revoke: 'none' });
      const r = await finishDeletion(deps, U(1), 'requested');
      assertEquals(r, { ok: true, stage: 'done' });
      assertFalse(await authExists(1));
      assertEquals((await ledger(1)).stage, 'done');
    });

    await t.step('a retry re-opens without moving the stage backwards, and an Apple account opens as required', async () => {
      await user(2);
      assertEquals((await deps.openLedger(U(2), true)).row, { stage: 'requested', apple_revoke: 'required' });
      assertEquals((await scrubOnly(2)).status, 'scrubbed');
      assertEquals((await deps.openLedger(U(2), true)).row?.stage, 'scrubbed', 'a retry keeps the stage it reached');
      await deps.deleteAuthUser(U(2)); await deps.markDone(U(2)); // leave it tidy
    });
    async function scrubOnly(n: number) {
      const r = await deps.scrub(U(n));
      assertEquals(r.error, null);
      return r.data as Row;
    }

    await t.step('open for an auth user that does not exist is an ERROR to the TypeScript, never a stage', async () => {
      const r = await deps.openLedger(U(999), false);
      assertEquals(r.row, null);
      assert(r.error);
    });

    await t.step('EVERY interrupted stage reaches done on the next heal pass, read from W2\'s real result shape', async () => {
      for (const n of [10, 11, 12]) await user(n);
      // 10: died right after the ledger opened (stage requested)
      await deps.openLedger(U(10), false); await age(10);
      // 11: died after the scrub, before the auth delete (scrubbed, auth user present)
      await deps.openLedger(U(11), false); await scrubOnly(11); await age(11);
      // 12: the auth delete landed, mark_done never ran (scrubbed, auth user already gone)
      await deps.openLedger(U(12), false); await scrubOnly(12); await deps.deleteAuthUser(U(12)); await age(12);

      const raw = await deps.heal(); // the real result, parsed by the real validator
      assertEquals(raw.error, null);
      assert(parseHealResult(raw.data), `W2's heal result failed W3's shape check: ${JSON.stringify(raw.data)}`);
      await q(`update public.account_deletions set stage = 'requested' where user_id = $1`, [U(10)]); // undo that peek's scrub of 10
      await q(`update public.account_deletions set updated_at = now() - interval '20 minutes' where user_id in ($1,$2,$3)`, [U(10), U(11), U(12)]);

      const r = await runHeal(healDeps());
      for (const n of [10, 11, 12]) {
        assertEquals((await ledger(n)).stage, 'done', `user ${n}`);
        assertFalse(await authExists(n), `auth user ${n}`);
      }
      assertEquals(r.outcome.status, 'success', JSON.stringify(r.response.body));
      // exact counts from W2's real arrays: one row re-scrubbed, three auth deletions
      assertEquals(r.response.body.scrubbed, 1);
      assertEquals(r.response.body.auth_deleted, 3);
      assertEquals(r.outcome.work, 4);
      assertEquals(r.response.body.ok, true);
      // and the next pass has nothing to do
      const again = await runHeal(healDeps());
      assertEquals(again.outcome.status, 'success');
      assertEquals(again.outcome.work, 0);
    });

    await t.step('mark_done refusing (auth user still there) → ledger_failed, and the ledger row says WHY', async () => {
      await user(20);
      await deps.openLedger(U(20), false); await scrubOnly(20);
      const r = await finishAuthStage({ ...deps, deleteAuthUser: () => Promise.resolve({ error: null }) }, U(20));
      assertEquals(r, { ok: false, reason: 'ledger_failed' });
      const row = await ledger(20);
      assertEquals(row.stage, 'scrubbed', 'never done while the auth user exists');
      assertEquals(row.last_error, 'mark done: auth_user_exists', 'the vocabulary W3 writes is accepted by account_deletion_fail');
      await deps.deleteAuthUser(U(20)); await deps.markDone(U(20));
    });

    await t.step("a 'live_state' refusal (state went live after the scrub) fails this pass and the NEXT heal clears it", async () => {
      await user(21);
      const L = LG(70);
      await q(`insert into auth.users (id) values ($1) on conflict do nothing`, [U(22)]);
      await deps.openLedger(U(21), false); await scrubOnly(21);
      // after the scrub, the (still valid) session joins a league: live state
      await q(`insert into leagues (id, name, commissioner_id, invite_code, num_participants, league_type)
               values ($1, 'L', $2, 'LIVESTATE1', 8, 'duration')`, [L, U(22)]);
      await q(`insert into league_members (league_id, user_id, role) values ($1, $2, 'commissioner'), ($1, $3, 'member')`, [L, U(22), U(21)]);
      await deps.deleteAuthUser(U(21));
      const refused = await finishAuthStage(deps, U(21));
      assertEquals(refused, { ok: false, reason: 'ledger_failed' });
      assertEquals((await ledger(21)).stage, 'scrubbed');
      assertEquals((await ledger(21)).last_error, 'mark done: live_state');
      await age(21);
      delivered.length = 0;
      const r = await runHeal(healDeps()); // re-scrubs the 'scrubbed' row before listing it
      assertEquals((await ledger(21)).stage, 'done', JSON.stringify(r.response.body));
      // the re-scrub left the pre-draft league: its member_left notice came back in W2's real scrub_results
      // shape and W3's scrubNotices read it (the only way that push ever happens)
      assertEquals(delivered.filter((d) => d.kind === 'member_left'), [{ kind: 'member_left', recipient: U(22), league_id: L }]);
    });

    await t.step("a scrub that REALLY fails in W2's SQL: scrub_errors has an entry, the run is FAILED (never success), the ledger says why, and the next pass heals it", async () => {
      const L = LG(71);
      await user(60); await q(`insert into auth.users (id) values ($1) on conflict do nothing`, [U(61)]);
      await q(`insert into leagues (id, name, commissioner_id, invite_code, num_participants, league_type)
               values ($1, 'L', $2, 'SCRUBFAIL1', 8, 'duration')`, [L, U(61)]);
      await q(`insert into league_members (league_id, user_id, role) values ($1, $2, 'commissioner'), ($1, $3, 'member')`, [L, U(61), U(60)]);
      await deps.openLedger(U(60), false); await age(60);
      // sabotage: the pre-draft leave deletes the member row; make that raise
      await q(`create function public.sabotage() returns trigger language plpgsql as $$ begin raise exception 'sabotage for a@example.com'; end $$`);
      await q(`create trigger sabotage before delete on public.league_members for each row execute function public.sabotage()`);
      const raw = await deps.heal();
      assert(parseHealResult(raw.data), 'W2 returns its normal shape even when a scrub fails');
      const errs = (raw.data as Row).scrub_errors;
      assert(Array.isArray(errs) && errs.length === 1, `scrub_errors must be W2's array with one entry: ${JSON.stringify(raw.data)}`);
      await age(60);
      const { out: r, lines } = await quiet(() => runHeal(healDeps()));
      assertEquals(r.outcome.status, 'failed', 'a failing scrub must never read as a healthy run');
      assertEquals(r.response.body.scrub_errors, 1);
      assertEquals((await ledger(60)).stage, 'requested', 'nothing moved: the failed scrub rolled back');
      assert(await authExists(60), 'and the account was NOT deleted');
      assertFalse(lines.join('\n').includes('a@example.com') || lines.join('\n').includes(U(60)), 'the error text and id never reach a log');
      assertFalse(r.outcome.message!.includes('a@example.com') || r.outcome.message!.includes(U(60)));
      // fix the cause: the next pass finishes it
      await q(`drop trigger sabotage on public.league_members`);
      await age(60);
      const ok = await runHeal(healDeps());
      assertEquals((await ledger(60)).stage, 'done', JSON.stringify(ok.response.body));
      assertEquals(ok.outcome.status, 'success');
    });

    await t.step("mark_done's other refusals come back as stage + a whitelisted reason: not_scrubbed, no_ledger", async () => {
      await user(62);
      await deps.openLedger(U(62), false);
      const early = await deps.markDone(U(62));
      assertEquals(early, { stage: 'requested', reason: 'not_scrubbed', error: null });
      const none = await deps.markDone(U(998));
      assertEquals(none, { stage: null, reason: 'no_ledger', error: null });
      // and finishAuthStage treats both as "not done", recording the reason
      const r = await finishAuthStage({ ...deps, deleteAuthUser: () => Promise.resolve({ error: null }) }, U(62));
      assertEquals(r, { ok: false, reason: 'ledger_failed' });
      assertEquals((await ledger(62)).last_error, 'mark done: not_scrubbed');
      await scrubOnly(62); await deps.deleteAuthUser(U(62)); await deps.markDone(U(62));
    });

    await t.step('Apple: a pending revoke is retried from REAL vault; success drops the token and settles done', async () => {
      await user(30);
      await deps.openLedger(U(30), true);
      assertEquals((await deps.stashAppleToken(U(30), 'apple-refresh-token-1')).error, null);
      assertEquals((await ledger(30)).apple_revoke, 'pending');
      assertEquals(await vaultCount(30), 1);
      assertEquals((await deps.appleToken(U(30))).token, 'apple-refresh-token-1');
      await scrubOnly(30); await deps.deleteAuthUser(U(30)); await deps.markDone(U(30));
      const seen: string[] = [];
      const r = await runHeal(healDeps({ revokeAppleToken: (tok) => { seen.push(tok); return Promise.resolve({ kind: 'ok' }); } }));
      assertEquals(seen, ['apple-refresh-token-1']);
      assertEquals((await ledger(30)).apple_revoke, 'done');
      assertEquals(await vaultCount(30), 0, 'the refresh token is deleted once revoked');
      assertEquals(r.response.body.apple_revoked, 1);
    });

    await t.step('Apple: a 4xx on a held token settles unrevoked, drops the token and logs the constant line with a hash', async () => {
      await user(31);
      await deps.openLedger(U(31), true);
      await deps.stashAppleToken(U(31), 'apple-refresh-token-2');
      await scrubOnly(31); await deps.deleteAuthUser(U(31)); await deps.markDone(U(31));
      const { out: r, lines } = await quiet(() => runHeal(healDeps({ revokeAppleToken: () => Promise.resolve({ kind: 'rejected', status: 400, error: 'invalid_grant' }) })));
      assertEquals((await ledger(31)).apple_revoke, 'unrevoked');
      assertEquals(await vaultCount(31), 0);
      assertEquals(r.response.body.apple_unrevoked, 1);
      const line = lines.find((l) => l.startsWith(UNREVOKED_LOG_LINE));
      assert(line?.endsWith('h-' + U(31).slice(-2)));
      assertFalse(lines.join('\n').includes(U(31)) || lines.join('\n').includes('apple-refresh-token-2'));
    });

    await t.step('Apple: a revoke pending past 7 days and a stale "required" row are settled by W2 and REPORTED to W3 (logged, not dropped)', async () => {
      for (const n of [32, 33]) { await user(n); await deps.openLedger(U(n), true); }
      await deps.stashAppleToken(U(32), 'apple-refresh-token-3');
      await age(32, '8 days');   // pending, requested 8 days ago
      await age(33, '20 minutes'); // still 'required'
      for (const n of [32, 33]) { await scrubOnly(n); await deps.deleteAuthUser(U(n)); await deps.markDone(U(n)); }
      await age(32, '8 days'); await age(33, '20 minutes');
      const { out: r, lines } = await quiet(() => runHeal(healDeps()));
      assertEquals((await ledger(32)).apple_revoke, 'unrevoked');
      assertEquals((await ledger(33)).apple_revoke, 'unrevoked');
      assertEquals(await vaultCount(32), 0, "W2's expiry drops the vault entry");
      assertEquals(lines.filter((l) => l.startsWith(UNREVOKED_LOG_LINE)).length, 2);
      assertEquals(r.response.body.apple_unrevoked, 2);
    });

    await t.step("W2's REAL settle replies: ok carries the ledger value; a settled ledger REFUSES backward with its value; no_ledger is a refusal", async () => {
      await user(70);
      await deps.openLedger(U(70), true);
      // forward from required: ok, with the ledger's value
      const pend = await deps.stashAppleToken(U(70), 'apple-refresh-token-9');
      assertEquals(pend, { error: null, ok: true, reason: null, apple_revoke: 'pending' });
      assertEquals(await vaultCount(70), 1);
      const unrev = await deps.appleUnrevoked(U(70));
      assertEquals(unrev, { error: null, ok: true, reason: null, apple_revoke: 'unrevoked' });
      assertEquals(await vaultCount(70), 0);
      // the ledger is now terminal: every other settle is REFUSED, as data, with the ledger's own value
      const stash = await deps.stashAppleToken(U(70), 'apple-refresh-token-10');
      assertEquals(stash, { error: null, ok: false, reason: 'backward', apple_revoke: 'unrevoked' });
      assertEquals(await vaultCount(70), 0, 'a refused stash stores nothing');
      assertEquals(await deps.appleRevoked(U(70)), { error: null, ok: false, reason: 'backward', apple_revoke: 'unrevoked' });
      // the same outcome again is idempotent, not a refusal
      assertEquals((await deps.appleUnrevoked(U(70))).ok, true);
      // no ledger at all
      const none = await deps.appleUnrevoked(U(997));
      assertEquals(none.error, null);
      assertEquals(none.ok, false);
      assertEquals(none.reason, 'no_ledger');
      assertEquals((await ledger(70)).apple_revoke, 'unrevoked', 'the ledger never moved backwards');
      await scrubOnly(70); await deps.deleteAuthUser(U(70)); await deps.markDone(U(70));
    });

    await t.step('takeover and preview: the real refusal shapes pass through the shapers with one HTTP status', async () => {
      await user(40);
      const code = 'ZZZZZZZZZZ';
      const prev = await admin.rpc('takeover_preview', { p_code: code, p_user_id: U(40) });
      assertEquals(prev.error, null);
      assertEquals(previewResponse(prev.data), { ok: false, reason: 'invalid_code' });
      const take = await admin.rpc('take_over_team', { p_code: code, p_user_id: U(40) });
      assertEquals(take.error, null);
      assertEquals(clientResponse(take.data), { ok: false, reason: 'invalid_code' });
      assertEquals(statusFor(previewResponse(prev.data)), statusFor(clientResponse(take.data)));
      assertEquals(statusFor(previewResponse(prev.data)), 200);
    });

    await t.step('the deleted-seat plumbing on real SQL: the list, the seat read, the decision, and the cron guard', async () => {
      const mkLeague = async (id: string, clocked: boolean, deleted: boolean) => {
        const [B, C, D, A] = [U(51), U(52), U(53), U(54)];
        for (const u of [B, C, D, A]) await q(`insert into auth.users (id) values ($1) on conflict do nothing`, [u]);
        await q(`insert into leagues (id, name, commissioner_id, invite_code, num_participants, league_type)
                 values ($1::uuid, 'L', $2, upper(substr(md5($1::text), 1, 10)), 8, 'duration')`, [id, B]);
        for (const [u, role] of [[B, 'commissioner'], [C, 'member'], [D, 'member'], [A, 'member']]) {
          await q(`insert into league_members (league_id, user_id, role) values ($1, $2, $3)`, [id, u, role]);
        }
        await q(`update leagues set draft_status = 'in_progress', draft_started_at = now() where id = $1`, [id]);
        if (!clocked) await q(`update leagues set pick_clock_enabled = false where id = $1`, [id]);
        await q(`insert into drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number, recorded_at)
                 values ($1, $2, 'AAPL', 1, 1, 1, 1, now()), ($1, $3, 'MSFT', 1, 1, 1, 2, now())`, [id, B, C]);
        if (deleted) await q(`update league_members set deleted_at = now() where league_id = $1 and user_id = $2`, [id, A]);
      };
      const due = async () => {
        const r = await admin.rpc('draft_auto_start_work_due');
        assertEquals(r.error, null);
        return r.data;
      };
      assertEquals(await due(), false, 'idle: nothing due, nothing deleted-seat');

      await mkLeague(LG(80), true, true);   // clocked, deleted seat: not this pass's business
      await mkLeague(LG(81), false, false); // unclocked, nobody deleted
      assertEquals((await listUnclockedDeletedSeatTurns(admin)).turns, []);
      assertEquals(await due(), false);

      await mkLeague(LG(82), false, true);  // unclocked with a deleted seat: listed
      const listed = await listUnclockedDeletedSeatTurns(admin);
      assertEquals(listed.error, false);
      assertEquals(listed.turns, [{ leagueId: LG(82), pickNumber: 3 }], 'the next pick after 2 recorded');
      assertEquals(await due(), true, 'the 10 s cron guard posts for it (real unclocked_deleted_seat_turns + my guard)');

      const read = seatReader(admin, LG(82));
      assertEquals(await read(U(54)), { deleted: true, error: false });
      assertEquals(await read(U(53)), { deleted: false, error: false });

      // order [B, C, D, A]: pick 3 is D (live) -> skip; pick 4 would be A (deleted) -> go
      const clock = (picksMade: number): DraftClock => ({
        draftStatus: 'in_progress', clockRunning: false, pickSeconds: 60, picksMade, turnStartedAt: null, deadlineAt: null,
        serverNow: new Date().toISOString(),
      });
      const order = [U(51), U(52), U(53), U(54)];
      const picks = (n: number) => Array.from({ length: n }, (_, i) => ({ user_id: order[i], symbol: `S${i}`, entry_price: 1, quantity: 1, pick_number: i + 1, slot_id: null })) as never;
      assertEquals((await decideDeletedSeatPick({ picks: picks(2), order, numRounds: 2 }, clock(2), read)), { kind: 'skip', why: 'seat_live' });
      assertEquals((await decideDeletedSeatPick({ picks: picks(3), order, numRounds: 2 }, clock(3), read)), { kind: 'go', pickerId: U(54) });
    });
  },
});
