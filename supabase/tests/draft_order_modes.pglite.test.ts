/**
 * 20261013000000_draft_order_modes.sql against REAL Postgres (PGlite).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite. Kept outside
 * supabase/functions/ so `deno test supabase/functions/` stays offline.
 * Run instructions: supabase/tests/README.md.
 *
 * Loads the migration VERBATIM on top of PR #9's leagues column guard and the
 * pick-clock migration (so all three leagues triggers fire in their real
 * order), on a minimal replica of the schema with Supabase's default
 * anon/authenticated/service_role grants simulated — so the proacl/relacl
 * assertions prove the explicit revokes work.
 *
 * Time: every q() is its own transaction, so now() is fresh per statement;
 * reveal gating is tested with draft_date set relative to now().
 *
 * NOT covered here (PGlite has no pg_cron / pg_net / vault): the deferred
 * cron migration. Static review + its post-promotion data check only.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const MIGRATION = new URL('supabase/migrations/20261013000000_draft_order_modes.sql', ROOT);
const PICK_CLOCK = new URL('supabase/migrations/20261010000000_draft_pick_clock_and_queue.sql', ROOT);
const GUARD = new URL('supabase/migrations/20260925000000_leagues_member_draft_complete_column_guard.sql', ROOT);
const EFFECT_TEST = new URL('docs/security/draft-order-modes-effect-test.sql', ROOT);

const SCHEMA = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                     nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table leagues (
  id uuid primary key default gen_random_uuid(), name text, commissioner_id text not null,
  draft_status text default 'not_started', num_rounds int not null default 6,
  invite_code text, num_participants int default 4, draft_date timestamptz,
  league_start_date timestamptz, league_end_date timestamptz);
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, role text not null default 'member',
  joined_at timestamptz not null default clock_timestamp(), primary key (league_id, user_id));
create table drafts (id serial primary key, league_id uuid, user_id text, symbol text,
  entry_price numeric, quantity numeric, round int, pick_number int, created_at timestamptz default now());
create unique index drafts_league_pick_unique_idx on drafts (league_id, pick_number) where created_at > '2026-01-08';
create table symbols (symbol text primary key, active boolean default true, is_draftable boolean not null default false,
  price_unsupported boolean not null default false, last_price numeric, market_cap numeric, gics_industry text);
create table categories (id uuid primary key default gen_random_uuid(), slug text unique not null);
create table category_rules (gics_industry text unique not null, category_id uuid not null references categories(id));
create table symbol_category_overrides (symbol text not null, category_id uuid not null references categories(id),
  unique (symbol, category_id));
create function is_member(l uuid) returns boolean language sql stable security definer as
  $$ select exists (select 1 from league_members m where m.league_id = l and m.user_id = auth.uid()::text) $$;
alter table leagues enable row level security;
alter table drafts enable row level security;
alter table league_members enable row level security;
create policy leagues_select on leagues for select using (is_member(id) or commissioner_id = auth.uid()::text);
create policy leagues_insert_self on leagues for insert to authenticated with check (commissioner_id = auth.uid()::text);
create policy leagues_update_commissioner on leagues for update to authenticated
  using (commissioner_id = auth.uid()::text) with check (commissioner_id = auth.uid()::text);
create policy lm_select on league_members for select using (is_member(league_id));
create policy lm_insert_bot on league_members for insert to authenticated with check (user_id like 'bot-%' and is_member(league_id));
create policy lm_delete_self on league_members for delete to authenticated using (user_id = auth.uid()::text);
`;

// The pre-migration derivation, VERBATIM from the deleted computeDraftOrder —
// the oracle the SQL backfill must reproduce byte-for-byte.
function legacyDraftOrder(commissionerId: string | null, memberIds: string[]): string[] {
  const rest = memberIds.filter((id) => id !== commissionerId).sort();
  return commissionerId && memberIds.includes(commissionerId) ? [commissionerId, ...rest] : rest;
}

// The commissioner id sorts FIRST (the old rule put it first regardless), so
// "commissioner at position 1" is never an accident of id order.
const C = '00000000-0000-4000-8000-00000000000c'; // commissioner
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const D = '00000000-0000-4000-8000-00000000000d';
const X = '00000000-0000-4000-8000-00000000000e'; // outsider

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'draft order modes on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    const asRole = async (role: 'authenticated' | 'service_role' | 'anon' | null, uid: string | null = null) => {
      await db.exec(`reset role`);
      await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
      if (role) await db.exec(`set role ${role}`);
    };
    const asUser = (uid: string) => asRole('authenticated', uid);
    // Writes with every trigger OFF — to fabricate a divergence the triggers
    // would otherwise prevent.
    const raw = async (s: string, p: unknown[] = []) => {
      await db.exec(`set session_replication_role = replica`);
      try { return await q(s, p); } finally { await db.exec(`set session_replication_role = origin`); }
    };
    const step = (name: string, fn: () => Promise<void>) =>
      t.step(name, async () => {
        await asRole(null);
        try { await fn(); } finally { await asRole(null); }
      });

    await db.exec(SCHEMA);

    // ---- Seed BEFORE the migration: what the backfill must preserve ---------
    const MIXED = [C, A, 'bot-1', 'test-user-2', 'Zed', 'bot-10', 'bot-2'];
    const [inProg] = await q(`insert into leagues (name, commissioner_id, draft_status) values ('legacy-ip',$1,'in_progress') returning id`, [C]);
    const [done] = await q(`insert into leagues (name, commissioner_id, draft_status) values ('legacy-done',$1,'completed') returning id`, [B]);
    const [ghost] = await q(`insert into leagues (name, commissioner_id, draft_status) values ('legacy-ghost','ghost','in_progress') returning id`);
    const [pre] = await q(`insert into leagues (name, commissioner_id, draft_status) values ('pre','${C}','not_started') returning id`);
    for (const m of MIXED) await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [inProg.id, m]);
    for (const m of [A, B, D]) await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [done.id, m]);
    for (const m of [D, A]) await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [ghost.id, m]);
    for (const m of [C, A]) await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [pre.id, m]);

    await db.exec(await Deno.readTextFile(GUARD));
    await db.exec(await Deno.readTextFile(PICK_CLOCK));
    const migration = await Deno.readTextFile(MIGRATION);
    await db.exec(migration);

    const lg = async (id: string) => (await q(`select * from leagues where id=$1`, [id]))[0];
    const meta = async (id: string) => (await q(`select * from league_draft_order_meta where league_id=$1`, [id]))[0];
    const order = async (id: string) =>
      (await q(`select user_id from league_draft_order where league_id=$1 order by position`, [id])).map((r: Row) => r.user_id);
    const positions = async (id: string) =>
      (await q(`select position from league_draft_order where league_id=$1 order by position`, [id])).map((r: Row) => r.position);
    const members = async (id: string) =>
      (await q(`select user_id from league_members where league_id=$1`, [id])).map((r: Row) => r.user_id);
    const notices = async (id: string) =>
      (await q(`select user_id from league_notifications where league_id=$1 order by user_id`, [id])).map((r: Row) => r.user_id);
    const getOrder = async (uid: string, id: string) => {
      await asUser(uid);
      try { return (await q(`select get_draft_order($1) r`, [id]))[0].r; } finally { await asRole(null); }
    };
    const setOrder = async (uid: string, id: string, ids: unknown) => {
      await asUser(uid);
      try { return (await q(`select set_draft_order($1, $2::text[]) r`, [id, ids]))[0].r; } finally { await asRole(null); }
    };
    async function mkLeague(ids: string[], extra: Record<string, unknown> = {}) {
      const row: Record<string, unknown> = { name: 't', commissioner_id: ids[0], ...extra };
      const cols = Object.keys(row);
      const [l] = await q(
        `insert into leagues (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`,
        Object.values(row),
      );
      for (const m of ids) await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [l.id, m]);
      return l;
    }
    const inHours = async (h: number) => (await q(`select now() + make_interval(secs => $1::float8 * 3600) t`, [h]))[0].t;
    const isPermutationOf = (o: string[], ms: string[]) =>
      o.length === ms.length && new Set(o).size === o.length && ms.every((m) => o.includes(m));

    await step('grants: proacl / relacl match the header; search_path pinned', async () => {
      const acl = async (name: string) =>
        (await q(`select proacl::text a, proconfig::text c from pg_proc where proname=$1`, [name]))[0];
      const clientOnly = /^\{postgres=X\/postgres,authenticated=X\/postgres\}$/;
      const serviceOnly = /^\{postgres=X\/postgres,service_role=X\/postgres\}$/;
      const ownerOnly = /^\{postgres=X\/postgres\}$/;
      for (const f of ['get_draft_order', 'set_draft_order']) {
        const a = await acl(f);
        assert(clientOnly.test(a.a), `${f}: ${a.a}`);
      }
      for (const f of ['finalize_due_draft_orders', 'draft_order_notify_due']) {
        const a = await acl(f);
        assert(serviceOnly.test(a.a), `${f}: ${a.a}`);
      }
      for (const f of [
        '_draft_order_is_due', '_draft_order_materialize', '_draft_order_notify_members', '_draft_order_finalize',
        '_draft_order_sync', '_draft_order_matches_members', '_draft_order_reconcile',
        'enforce_league_draft_order_rows', 'enforce_league_draft_order_meta', 'enforce_leagues_draft_order_mode',
        'lock_draft_order_on_start', 'sync_draft_order_on_member_change',
      ]) {
        const a = await acl(f);
        assert(ownerOnly.test(a.a), `${f}: ${a.a}`);
        assert(String(a.c).includes('search_path=public, pg_temp'), `${f}: ${a.c}`);
      }
      for (const tbl of ['league_draft_order', 'league_draft_order_meta', 'league_notifications']) {
        const [r] = await q(`select relacl::text a from pg_class where relname=$1`, [tbl]);
        assert(!/anon=/.test(r.a), `${tbl}: ${r.a}`);
        assert(/authenticated=r\//.test(r.a) && /service_role=r\//.test(r.a), `${tbl}: ${r.a}`);
      }
      const [cols] = await q(
        `select string_agg(attname || '=' || attacl::text, ' ' order by attname) a from pg_attribute
          where attrelid='league_notifications'::regclass and attacl is not null`,
      );
      assertEquals(
        (cols.a.match(/(\w+)=\{service_role=w\/postgres\}/g) ?? []).map((s: string) => s.split('=')[0]).sort(),
        ['push_attempted_at', 'push_attempts', 'push_error', 'push_status'],
        cols.a,
      );
    });

    await step('backfill: started leagues get the VERBATIM legacy order, locked; not_started gets nothing', async () => {
      for (const [l, comm] of [[inProg, C], [done, B], [ghost, 'ghost']] as const) {
        assertEquals(await order(l.id), legacyDraftOrder(comm, await members(l.id)));
        const m = await meta(l.id);
        assertEquals([m.state, m.source], ['locked', 'legacy_backfill']);
        assertEquals((await lg(l.id)).draft_order_mode, 'legacy');
      }
      assertEquals(await order(inProg.id), [C, A, 'Zed', 'bot-1', 'bot-10', 'bot-2', 'test-user-2']);
      assertEquals((await lg(pre.id)).draft_order_mode, 'random');
      assertEquals(await meta(pre.id), undefined);
      // Idempotent: re-applying the migration changes nothing.
      const before = await order(inProg.id);
      await db.exec(migration);
      assertEquals(await order(inProg.id), before);
      assertEquals(await meta(pre.id), undefined);
    });

    await step('default is random: nothing exists before draft_date - 1h; outsider and anon refused', async () => {
      const l = await mkLeague([C, A, B, D], { draft_date: await inHours(3) });
      assertEquals(l.draft_order_mode, 'random');
      const r = await getOrder(A, l.id);
      assertEquals([r.ok, r.mode, r.revealed, r.finalized, r.locked, r.order], [true, 'random', false, false, false, null]);
      assertEquals(new Date(r.finalize_at).getTime(), new Date(l.draft_date).getTime() - 3600_000);
      assertEquals(await meta(l.id), undefined, 'a read before the reveal must not generate anything');
      assertEquals((await getOrder(X, l.id)).reason, 'not_a_member');
      await asRole('anon');
      await assertRejects(() => q(`select get_draft_order($1)`, [l.id]), Error, 'permission denied');
      await assertRejects(() => q(`select set_draft_order($1, '{}')`, [l.id]), Error, 'permission denied');
    });

    await step('reveal gating at draft_date - 1h, generated exactly once, notices for humans only', async () => {
      const l = await mkLeague([C, A, B, 'bot-1'], { draft_date: await inHours(1 + 5 / 3600) }); // T−1h is 5s away
      assertEquals((await getOrder(A, l.id)).revealed, false);
      await q(`update leagues set draft_date = now() + interval '1 hour' - interval '1 second' where id=$1`, [l.id]);
      const r = await getOrder(A, l.id);
      assertEquals([r.revealed, r.finalized, r.locked, r.state], [true, true, false, 'finalized']);
      const first = await order(l.id);
      assert(isPermutationOf(first, [C, A, B, 'bot-1']));
      const m1 = await meta(l.id);
      assertEquals(m1.source, 'random');
      // Repeated reads, the cron path, and a direct second materialize: same order.
      for (let i = 0; i < 5; i++) assertEquals((await getOrder(i % 2 ? A : C, l.id)).order.map((o: Row) => o.user_id), first);
      await q(`select finalize_due_draft_orders()`);
      assertEquals((await q(`select _draft_order_materialize($1, 'random') r`, [l.id]))[0].r, false);
      assertEquals(await order(l.id), first);
      assertEquals(String((await meta(l.id)).materialized_at), String(m1.materialized_at));
      assertEquals(await notices(l.id), [A, B, C].sort());
    });

    await step('REGRESSION: no path yields commissioner-first by default (every path, adversarial reads)', async () => {
      // Worst case for each path: the commissioner creates the league, is its
      // only member, and reads the order after EVERY join. Before the 4-member
      // floor + random-slot seed, this path put the commissioner first 200/200.
      const N = 200;
      const firsts = { randomDue: 0, randomLater: 0, manualSeed: 0, startBackstop: 0 };
      const sequences = new Set<string>();
      const build = async (extra: Record<string, unknown>) => {
        const [l] = await q(
          `insert into leagues (name, commissioner_id, draft_order_mode, draft_date) values ('r',$1,$2,$3) returning *`,
          [C, extra.mode ?? 'random', extra.draft_date ?? null],
        );
        for (const m of [C, A, B, D]) {
          await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [l.id, m]);
          await getOrder(C, l.id);
        }
        return l;
      };
      for (let i = 0; i < N; i++) {
        const due = await build({ draft_date: await inHours(0.5) }); // created INSIDE the hour
        const o = await order(due.id);
        assertEquals((await meta(due.id)).state, 'finalized');
        if (o[0] === C) firsts.randomDue++;
        sequences.add(o.join(','));

        const later = await build({ draft_date: await inHours(-1) }); // T−1h long gone
        await q(`select finalize_due_draft_orders()`);
        if ((await order(later.id))[0] === C) firsts.randomLater++;

        const man = await build({ mode: 'manual', draft_date: await inHours(5) });
        if ((await order(man.id))[0] === C) firsts.manualSeed++;

        const tbd = await build({}); // date TBD, started directly
        await q(`update leagues set draft_status='in_progress' where id=$1`, [tbd.id]);
        if ((await order(tbd.id))[0] === C) firsts.startBackstop++;
      }
      // Expected N/4 = 50 each; P(outside 20..90) is astronomically small.
      for (const [k, v] of Object.entries(firsts)) assert(v >= 20 && v <= 90, `${k}: commissioner first ${v}/${N}`);
      assert(sequences.size > 12, `only ${sequences.size} distinct orders of 24`);
    });

    await step('below 4 members nothing is set, even past T-1h; the 4th join sets it', async () => {
      const l = await mkLeague([C, A, B], { draft_date: await inHours(0.5) });
      const r = await getOrder(C, l.id);
      assertEquals([r.revealed, r.finalized, r.waiting_for_members, r.member_count, r.min_members], [false, false, true, 3, 4]);
      assertEquals(await meta(l.id), undefined);
      await asRole('service_role');
      assertEquals((await q(`select finalize_due_draft_orders() n`))[0].n, 0);
      await asRole(null);
      await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [l.id, D]);
      const r2 = await getOrder(A, l.id);
      assertEquals([r2.revealed, r2.finalized, r2.waiting_for_members], [true, true, false]);
      assert(isPermutationOf(await order(l.id), [C, A, B, D]));
      assertEquals(await notices(l.id), [A, B, C, D].sort());
    });

    await step('manual: seeded on first read, commissioner saves permutations, refusals are reasons', async () => {
      const l = await mkLeague([C, A, B, 'bot-1'], { draft_order_mode: 'manual', draft_date: await inHours(5) });
      const r = await getOrder(A, l.id); // any member's first read seeds
      assertEquals([r.mode, r.state, r.revealed, r.can_edit_order, r.is_commissioner], ['manual', 'open', true, false, false]);
      assertEquals((await meta(l.id)).source, 'manual_seed');
      assertEquals((await getOrder(C, l.id)).can_edit_order, true);
      assertEquals((await getOrder(C, l.id)).can_change_mode, true);

      assertEquals((await setOrder(A, l.id, ['bot-1', A, B, C])).reason, 'not_commissioner');
      assertEquals((await setOrder(X, l.id, ['bot-1', A, B, C])).reason, 'not_a_member');
      for (const bad of [[A, B, C], [A, A, B, C], [A, B, C, X], [A, B, C, 'bot-1', D], [A, B, C, null], [[A, B], [C, 'bot-1']], null]) {
        assertEquals((await setOrder(C, l.id, bad)).reason, 'not_a_permutation', JSON.stringify(bad));
      }
      const saved = await setOrder(C, l.id, ['bot-1', A, B, C]);
      assertEquals(saved.ok, true);
      assertEquals(await order(l.id), ['bot-1', A, B, C]);
      assertEquals(await positions(l.id), [1, 2, 3, 4]);
      assert((await meta(l.id)).last_edited_at !== null);
      assertEquals((await setOrder(C, l.id, [C, B, A, 'bot-1'])).ok, true); // any number of saves
      assertEquals(await order(l.id), [C, B, A, 'bot-1']);

      const rnd = await mkLeague([C, A], { draft_date: await inHours(5) });
      assertEquals((await setOrder(C, rnd.id, [A, C])).reason, 'not_manual');
    });

    await step('manual finalizes at T-1h as-is; edits then refused; a date move cannot un-finalize', async () => {
      const l = await mkLeague([C, A, B, D], { draft_order_mode: 'manual', draft_date: await inHours(5) });
      await getOrder(C, l.id);
      assertEquals((await setOrder(C, l.id, [B, D, C, A])).ok, true);
      // T−1h passes (nobody reads, no cron): fabricate with triggers off.
      await raw(`update leagues set draft_date = now() + interval '30 minutes' where id=$1`, [l.id]);
      assertEquals((await setOrder(C, l.id, [A, B, C, D])).reason, 'finalized');
      assertEquals(await order(l.id), [B, D, C, A], 'the saved order is what finalized');
      assertEquals((await meta(l.id)).state, 'finalized');
      assertEquals(await notices(l.id), [A, B, C, D].sort());

      // Moving the date later AFTER the finalize instant (cron late, nobody read)
      // finalizes at the old date first; the move cannot reopen editing.
      const m = await mkLeague([C, A, B, D], { draft_order_mode: 'manual', draft_date: await inHours(5) });
      await getOrder(C, m.id);
      await raw(`update leagues set draft_date = now() + interval '30 minutes' where id=$1`, [m.id]);
      assertEquals((await meta(m.id)).state, 'open', 'precondition: not yet flipped');
      await asUser(C);
      await q(`update leagues set draft_date = now() + interval '1 day' where id=$1`, [m.id]);
      await asRole(null);
      assertEquals((await meta(m.id)).state, 'finalized');
      const r = await getOrder(C, m.id);
      assertEquals([r.can_edit_order, r.can_change_mode, r.finalized], [false, false, true]);
    });

    await step('mode changes: allowed only before T-1h; manual->random discards; legacy never', async () => {
      const l = await mkLeague([C, A, B, D], { draft_date: await inHours(5) });
      await asUser(C);
      await q(`update leagues set draft_order_mode='manual' where id=$1`, [l.id]);
      await asRole(null);
      await getOrder(C, l.id);
      assertEquals((await meta(l.id)).state, 'open');
      await asUser(C);
      await q(`update leagues set draft_order_mode='random' where id=$1`, [l.id]);
      await asRole(null);
      assertEquals(await meta(l.id), undefined, 'manual order discarded');
      assertEquals(await order(l.id), []);

      await asUser(A); // non-commissioner: RLS admits no row to update
      await q(`update leagues set draft_order_mode='manual' where id=$1`, [l.id]);
      await asRole(null);
      assertEquals((await lg(l.id)).draft_order_mode, 'random');

      await asUser(C);
      await assertRejects(() => q(`update leagues set draft_order_mode='legacy' where id=$1`, [l.id]), Error, 'draft_order_mode_locked');
      await assertRejects(
        () => q(`insert into leagues (name, commissioner_id, draft_order_mode) values ('x',$1,'legacy')`, [C]),
        Error, 'draft_order_mode_invalid');
      await assertRejects(
        () => q(`update leagues set draft_order_mode='manual', draft_date = now() + interval '10 minutes' where id=$1`, [l.id]),
        Error, 'draft_order_reveal_passed');
      await q(`update leagues set draft_date = now() + interval '50 minutes' where id=$1`, [l.id]);
      await assertRejects(() => q(`update leagues set draft_order_mode='manual' where id=$1`, [l.id]), Error, 'draft_order_reveal_passed');
      await asRole(null);
      // A revealed random order is final.
      await getOrder(A, l.id);
      assertEquals((await meta(l.id)).state, 'finalized');
      await assertRejects(() => q(`update leagues set draft_order_mode='manual' where id=$1`, [l.id]), Error, 'draft_order_reveal_passed');

      const started = await mkLeague([C, A]);
      await q(`update leagues set draft_status='in_progress' where id=$1`, [started.id]);
      await assertRejects(() => q(`update leagues set draft_order_mode='manual' where id=$1`, [started.id]), Error, 'draft_order_mode_locked');
    });

    await step('joins and leaves: seed slot random, edited appends, finalized appends (+notice), leaves compact', async () => {
      const l = await mkLeague([C, A, B], { draft_order_mode: 'manual', draft_date: await inHours(5) });
      await getOrder(C, l.id);
      assertEquals((await setOrder(C, l.id, [B, A, C])).ok, true); // edited: joiners append
      await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [l.id, D]);
      assertEquals(await order(l.id), [B, A, C, D]);
      await asUser(A);
      await q(`delete from league_members where league_id=$1 and user_id=$2`, [l.id, A]); // [I5] leave
      await asRole(null);
      assertEquals(await order(l.id), [B, C, D]);
      assertEquals(await positions(l.id), [1, 2, 3]);
      await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [l.id, A]);
      assertEquals(await order(l.id), [B, C, D, A]);

      await raw(`update leagues set draft_date = now() + interval '30 minutes' where id=$1`, [l.id]);
      await getOrder(C, l.id); // finalizes
      assertEquals((await meta(l.id)).state, 'finalized');
      assertEquals(await notices(l.id), [A, B, C, D].sort());
      const Y = '00000000-0000-4000-8000-0000000000f1';
      await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [l.id, Y]); // late joiner
      await asUser(C);
      await q(`insert into league_members (league_id, user_id) values ($1,'bot-7')`, [l.id]); // [I6] bot
      await asRole(null);
      assertEquals(await order(l.id), [B, C, D, A, Y, 'bot-7'], 'announced slots preserved; joiners appended');
      assertEquals(await notices(l.id), [A, B, C, D, Y].sort(), 'the late human gets a notice; the bot does not');
      await q(`delete from league_members where league_id=$1 and user_id=$2`, [l.id, C]);
      assertEquals(await order(l.id), [B, D, A, Y, 'bot-7']);
      assertEquals(await positions(l.id), [1, 2, 3, 4, 5]);

      // Finalized: no reordering, even as the table owner; no insert mid-order.
      await assertRejects(
        () => q(`update league_draft_order set position = 9 where league_id=$1 and user_id=$2`, [l.id, B]),
        Error, 'draft_order_finalized');
      await assertRejects(
        () => q(`update league_draft_order set user_id = $2 where league_id=$1 and position = 1`, [l.id, X]),
        Error, 'draft_order_finalized');
      await assertRejects(() => q(`insert into league_draft_order values ($1, 2, $2)`, [l.id, X]), Error, 'draft_order_finalized');
      assertEquals((await setOrder(B, l.id, [B, D, A, Y, 'bot-7'])).reason, 'not_commissioner');
    });

    await step('service_role and authenticated cannot write the order tables at all', async () => {
      const l = await mkLeague([C, A], { draft_order_mode: 'manual', draft_date: await inHours(5) });
      await getOrder(C, l.id);
      for (const role of ['service_role', 'authenticated'] as const) {
        await asRole(role, C);
        await assertRejects(() => q(`insert into league_draft_order values ($1, 9, 'x')`, [l.id]), Error, 'permission denied');
        await assertRejects(() => q(`update league_draft_order set position = 1 where league_id=$1`, [l.id]), Error, 'permission denied');
        await assertRejects(() => q(`delete from league_draft_order_meta where league_id=$1`, [l.id]), Error, 'permission denied');
        await assertRejects(() => q(`insert into league_notifications (league_id, user_id, kind) values ($1,$2,'draft_order_set')`, [l.id, C]), Error, 'permission denied');
        await assertRejects(() => q(`select _draft_order_materialize($1, 'random')`, [l.id]), Error, 'permission denied');
        await assertRejects(() => q(`select _draft_order_sync($1, true)`, [l.id]), Error, 'permission denied');
      }
      await asRole('authenticated', C);
      await assertRejects(() => q(`select finalize_due_draft_orders()`), Error, 'permission denied');
      await assertRejects(() => q(`select draft_order_notify_due()`), Error, 'permission denied');
      await asRole('service_role');
      await assertRejects(() => q(`select get_draft_order($1)`, [l.id]), Error, 'permission denied');
      await q(`select finalize_due_draft_orders(), draft_order_notify_due()`);
    });

    await step('start: backstop materializes+locks; [I2a] flip; reconcile recorded; invariant holds', async () => {
      // Random, date TBD, started by the commissioner's direct [I2a] flip.
      const l = await mkLeague([C, A, B, D]);
      await asUser(C);
      await q(`update leagues set draft_status='in_progress' where id=$1`, [l.id]);
      await asRole(null);
      const m = await meta(l.id);
      assertEquals([m.state, m.source, m.reconciled_at_start], ['locked', 'start_backstop', false]);
      assert(isPermutationOf(await order(l.id), [C, A, B, D]));
      assertEquals(await notices(l.id), [], 'no "order is set" notice for a start-time finalize (no future draft_date)');
      const r = await getOrder(A, l.id);
      assertEquals([r.locked, r.finalized, r.can_edit_order, r.can_change_mode], [true, true, false, false]);

      // A finalized order started by draft-control (service role) keeps its exact order.
      const f = await mkLeague([C, A, B, D], { draft_date: await inHours(0.5) });
      await getOrder(C, f.id);
      const fin = await order(f.id);
      await asRole('service_role');
      await q(`update leagues set draft_status='in_progress' where id=$1 and draft_status='not_started'`, [f.id]);
      await asRole(null);
      assertEquals(await order(f.id), fin);
      assertEquals((await meta(f.id)).state, 'locked');

      // A divergence the triggers can't produce (fabricated with triggers off) is reconciled and RECORDED.
      const g = await mkLeague([C, A, B, D], { draft_date: await inHours(0.5) });
      await getOrder(C, g.id);
      assertEquals((await meta(g.id)).state, 'finalized');
      await raw(`delete from league_members where league_id=$1 and user_id=$2`, [g.id, A]);
      await raw(`insert into league_members (league_id, user_id) values ($1,$2)`, [g.id, X]);
      const kept = (await order(g.id)).filter((u: string) => u !== A);
      await q(`update leagues set draft_status='in_progress' where id=$1`, [g.id]);
      assertEquals(await order(g.id), [...kept, X]);
      assertEquals(await positions(g.id), [1, 2, 3, 4]);
      assertEquals((await meta(g.id)).reconciled_at_start, true);

      // A direct jump to completed locks too.
      const h = await mkLeague([C, A]);
      await asUser(C);
      await q(`update leagues set draft_status='completed' where id=$1`, [h.id]);
      await asRole(null);
      assertEquals((await meta(h.id)).state, 'locked');

      // INVARIANT across every league in this database.
      const bad = await q(
        `select l.id from leagues l left join league_draft_order_meta m on m.league_id = l.id
          where coalesce(l.draft_status,'not_started') <> 'not_started' and m.state is distinct from 'locked'`,
      );
      assertEquals(bad, []);
    });

    await step('locked: immutable for every role; joins refused; mid-draft leave refused; history kept', async () => {
      const l = await mkLeague([C, A, B, D], { draft_date: await inHours(0.5) });
      await getOrder(C, l.id);
      await q(`update leagues set draft_status='in_progress' where id=$1`, [l.id]);
      const locked = await order(l.id);
      await assertRejects(() => q(`update league_draft_order set position = position where league_id=$1`, [l.id]), Error, 'draft_order_locked');
      await assertRejects(() => q(`delete from league_draft_order where league_id=$1`, [l.id]), Error, 'draft_order_locked');
      await assertRejects(() => q(`insert into league_draft_order values ($1, 99, 'z')`, [l.id]), Error, 'draft_order_locked');
      await assertRejects(() => q(`update league_draft_order_meta set locked_at = null where league_id=$1`, [l.id]), Error, 'draft_order_locked');
      await assertRejects(() => q(`delete from league_draft_order_meta where league_id=$1`, [l.id]), Error, 'draft_order_locked');
      await assertRejects(() => q(`insert into league_members (league_id, user_id) values ($1,'bot-9')`, [l.id]), Error, 'draft_order_locked');
      await asUser(A);
      await assertRejects(() => q(`delete from league_members where league_id=$1 and user_id=$2`, [l.id, A]), Error, 'draft_in_progress');
      await asRole(null);
      assertEquals(await order(l.id), locked);

      await q(`update leagues set draft_status='completed' where id=$1`, [l.id]);
      await asUser(A);
      await q(`delete from league_members where league_id=$1 and user_id=$2`, [l.id, A]); // after the draft: allowed
      await asRole(null);
      assertEquals(await order(l.id), locked, 'order kept as history');

      // A later re-start with a locked order that no longer fits is refused, not reshuffled.
      await raw(`update leagues set draft_status='not_started' where id=$1`, [l.id]);
      await assertRejects(() => q(`update leagues set draft_status='in_progress' where id=$1`, [l.id]), Error, 'draft_order_locked_mismatch');
    });

    await step('league delete still cascades through a locked order', async () => {
      const l = await mkLeague([C, A]);
      await q(`update leagues set draft_status='in_progress' where id=$1`, [l.id]);
      assertEquals((await meta(l.id)).state, 'locked');
      await asUser(C);
      await q(`delete from leagues where id=$1`, [l.id]).catch(() => {}); // no client DELETE policy in this replica
      await asRole(null);
      await q(`delete from leagues where id=$1`, [l.id]);
      assertEquals((await q(`select count(*)::int n from league_draft_order_meta where league_id=$1`, [l.id]))[0].n, 0);
      assertEquals((await q(`select count(*)::int n from league_draft_order where league_id=$1`, [l.id]))[0].n, 0);
    });

    await step('cron path: stale leagues finalize silently; due leagues finalize with notices; due flag', async () => {
      await q(`update league_notifications set push_status = 'sent'`);
      // Members join BEFORE the date moves inside the hour (triggers off), so
      // only the cron can finalize these — as for a league nobody opens.
      const stale = await mkLeague([C, A, B, D], { draft_date: await inHours(3) });
      const soon = await mkLeague([C, A, B, 'bot-1'], { draft_date: await inHours(3) });
      const later = await mkLeague([C, A, B, D], { draft_date: await inHours(3) });
      const small = await mkLeague([C, A], { draft_date: await inHours(3) });
      await raw(`update leagues set draft_date = now() - interval '48 hours' where id = any($1::uuid[])`, [[stale.id, small.id]]);
      await raw(`update leagues set draft_date = now() + interval '15 minutes' where id=$1`, [soon.id]);
      await asRole('service_role');
      assertEquals((await q(`select draft_order_notify_due() d`))[0].d, true);
      assertEquals((await q(`select finalize_due_draft_orders() n`))[0].n, 2);
      await asRole(null);
      assertEquals((await meta(stale.id)).state, 'finalized');
      assertEquals(await notices(stale.id), [], 'no push about a league whose draft time already passed');
      assertEquals(await notices(soon.id), [A, B, C].sort());
      assertEquals(await meta(small.id), undefined, 'under 4 members: never finalized, never "due"');
      assertEquals(await meta(later.id), undefined);
      await asRole('service_role');
      assertEquals((await q(`select draft_order_notify_due() d`))[0].d, true, 'pending pushes');
      await q(`update league_notifications set push_status='sent', push_attempts = 1, push_attempted_at = now() where league_id=$1`, [soon.id]);
      assertEquals((await q(`select draft_order_notify_due() d`))[0].d, false);
      await assertRejects(() => q(`update league_notifications set user_id = 'x' where league_id=$1`, [soon.id]), Error, 'permission denied');
    });

    await step('notifications: owner-only SELECT', async () => {
      const l = await mkLeague([C, A, B, D], { draft_date: await inHours(0.5) });
      await getOrder(C, l.id);
      await asUser(A);
      const mine = await q(`select user_id, kind from league_notifications where league_id=$1`, [l.id]);
      assertEquals(mine, [{ user_id: A, kind: 'draft_order_set' }]);
      await asUser(X);
      assertEquals(await q(`select * from league_notifications where league_id=$1`, [l.id]), []);
      assertEquals(await q(`select * from league_draft_order where league_id=$1`, [l.id]), [], 'outsiders see no order');
    });

    await step('effect test (the SQL-editor script) passes and rolls back', async () => {
      const before = (await q(`select count(*)::int n from leagues`))[0].n;
      const err = await assertRejects(async () => { await db.exec(await Deno.readTextFile(EFFECT_TEST)); });
      const msg = String((err as Error).message);
      assert(msg.includes('DRAFT ORDER MODES EFFECT TEST RESULTS'), msg);
      assert(!msg.includes('FAIL'), msg);
      assertEquals(msg.match(/PASS/g)?.length, 24, msg); // one per case in the file's EXPECTED OUTPUT
      assertEquals((await q(`select count(*)::int n from leagues`))[0].n, before, 'fixture rolled back');
    });
  },
});
