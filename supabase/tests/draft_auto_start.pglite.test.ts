/**
 * Draft auto-start (20261109000000 + 20261109000001, and the cron guards of
 * 20261109000002 / 20261109000003) against REAL Postgres (PGlite). NOT
 * hermetic: the first run fetches npm:@electric-sql/pglite. Run:
 *   deno test --allow-read --allow-env supabase/tests/draft_auto_start.pglite.test.ts
 *
 * Loads VERBATIM, in prod order, every migration whose triggers fire on a
 * leagues / league_members / league_notifications write (the freeze test's
 * chain, plus draft_stalls, participant names, and #126's reconfirm table +
 * real start gate), then the two migrations under test. leagues is replayed
 * from every leagues DDL in supabase/migrations/ (as the freeze test does), so
 * the compare-and-swap is judged against the real column types. The chain is
 * loaded in TWO halves around legacy fixtures, so the one-off backfills
 * (legacy postponement, settling #67's pending notices) run on real rows.
 *
 * The cron files cannot run here (no pg_cron / pg_net / vault): each post guard
 * is SLICED out of the latest migration that schedules the job and executed.
 *
 * Time: every case sets draft_date relative to the DB clock (now()), so the
 * gate/room/reminder windows are exercised for real. What one connection cannot
 * show: two writers racing on the row lock; the lock clauses are pinned
 * structurally and the argument is in 20261109000000's header.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { buildStartExpect } from '../functions/_shared/draft-start.ts';
import { SQL_POLICY } from '../functions/_shared/draft-start-policy.ts';
import type { Slot } from '../functions/_shared/draft-validation.ts';

const ROOT = new URL('../../', import.meta.url);
const BASE = [   // prod (timestamp) order, before the migrations under test
  '20251205110000_enable_drafts_rls.sql',
  '20260712000000_rls_b1_00_helpers.sql',
  '20260712000001_rls_b1_01_leagues.sql',
  '20260712000002_rls_b1_02_league_members.sql',
  '20260810000004_create_league_draft_slots.sql',
  '20260811000003_drafts_drop_direct_client_insert.sql',
  '20260925000000_leagues_member_draft_complete_column_guard.sql',
  '20261004000000_participant_display_names.sql',
  '20261010000000_draft_pick_clock_and_queue.sql',
  '20261012000002_freeze_playoff_teams_after_draft_start.sql',
  '20261013000000_draft_order_modes.sql',
  '20261101000001_draft_stalls.sql',
  '20261104000000_freeze_league_rules_after_draft_start.sql',
  // #126: league_roster_reconfirm + the REAL start gate + the kind CHECK it set.
  '20261107000000_leave_league_schema.sql',
  '20261107000006_draft_waits_for_roster_reconfirm.sql',
].map((f) => new URL(`supabase/migrations/${f}`, ROOT));
const UNDER_TEST = [
  '20261109000000_draft_auto_start.sql',
  '20261109000001_draft_status_server_only.sql',
].map((f) => new URL(`supabase/migrations/${f}`, ROOT));

const SCHEMA_PRE = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;
const SCHEMA_POST = `
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, role text, joined_at timestamptz not null default clock_timestamp(),
  primary key (league_id, user_id));
create table user_profiles (id uuid primary key, username text);
create table categories (id uuid primary key default gen_random_uuid(), slug text unique, name text);
create table drafts (id serial primary key, league_id uuid not null references leagues(id) on delete cascade,
  user_id text, symbol text, entry_price numeric, quantity numeric, round int, pick_number int,
  slot_id uuid, created_at timestamptz default now());
create table draft_sessions (id serial primary key, league_id uuid);
create table draft_settings (id serial primary key, league_id uuid);
create table symbols (symbol text primary key, active boolean default true, is_draftable boolean not null default false,
  price_unsupported boolean not null default false, last_price numeric, market_cap numeric, gics_industry text);
create table category_rules (gics_industry text unique not null, category_id uuid not null references categories(id));
create table symbol_category_overrides (symbol text not null, category_id uuid not null references categories(id),
  unique (symbol, category_id));
`;

/** leagues' column DDL, replayed from the migrations (same rules as
 * freeze_league_rules.pglite.test.ts, which also proves the replay complete). */
async function leaguesColumnDdl(): Promise<string[]> {
  const dir = new URL('supabase/migrations/', ROOT);
  const files: string[] = [];
  for await (const e of Deno.readDir(dir)) if (e.isFile && e.name.endsWith('.sql')) files.push(e.name);
  files.sort();
  const ddl: string[] = [];
  const startsWith = /^(create\s+table(\s+if\s+not\s+exists)?|alter\s+table(\s+if\s+exists)?(\s+only)?)\s+(public\.)?leagues\b/i;
  for (const f of files) {
    const sql = (await Deno.readTextFile(new URL(f, dir))).replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    for (const raw of sql.split(';')) {
      const st = raw.trim();
      if (!startsWith.test(st)) continue;
      if (/^create/i.test(st) || /\b(add|drop|rename)\s+column\b/i.test(st)) {
        ddl.push(st.replace(
          /\breferences\s+[\w.]+\s*(\([^)]*\))?(\s+on\s+(delete|update)\s+(set\s+null|cascade|restrict|no\s+action|set\s+default))*/gi, ''));
      }
    }
  }
  return ddl;
}

/** The post guard of the LATEST migration (not deferred/) that schedules `job`. */
async function latestGuard(job: string): Promise<{ file: string; guard: string }> {
  const dir = new URL('supabase/migrations/', ROOT);
  const hits: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith('.sql')) continue;
    if (new RegExp(`cron\\.schedule\\(\\s*'${job}'`).test(await Deno.readTextFile(new URL(e.name, dir)))) hits.push(e.name);
  }
  hits.sort();
  const file = hits[hits.length - 1];
  const sql = await Deno.readTextFile(new URL(file, dir));
  const command = sql.slice(sql.indexOf('$$') + 2, sql.lastIndexOf('$$'));
  const m = command.match(/\)\s*\n(\s*where [\s\S]*?);\s*$/);
  if (!m) throw new Error(`${file}: could not slice the post guard`);
  return { file, guard: m[1] };
}

const COMMISH = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'draft auto-start on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    await db.exec(SCHEMA_PRE);
    for (const st of await leaguesColumnDdl()) await db.exec(st);
    await db.exec(SCHEMA_POST);
    for (const m of BASE) await db.exec(await Deno.readTextFile(m));
    await q(`insert into user_profiles (id, username) values ($1, 'Roberto B.')`, [COMMISH]);

    // ---- helpers ----------------------------------------------------------
    async function as<T>(who: 'commish' | 'member' | 'service', fn: () => Promise<T>): Promise<T> {
      if (who === 'service') await db.exec(`set role service_role; reset request.jwt.claim.sub;`);
      else await db.exec(`set role authenticated; set request.jwt.claim.sub = '${who === 'commish' ? COMMISH : MEMBER}';`);
      try {
        return await fn();
      } finally {
        await db.exec(`reset role; reset request.jwt.claim.sub;`);
      }
    }
    async function refused(fn: () => Promise<unknown>, needle: string, code = '42501') {
      let err: Row = null;
      try {
        await fn();
      } catch (e) {
        err = e;
      }
      assert(err, `expected a refusal containing "${needle}", but it succeeded`);
      assertEquals(err.code, code, `${err.message}`);
      assert(String(err.message).includes(needle), `expected "${needle}" in: ${err.message}`);
    }
    /** A league as the owner (auth.uid() NULL): `members` members (the last ones
     * may be bots), two slots, draft_date `minutes` from the DB clock. */
    async function league(o: { minutes: number | null; members?: number; bots?: number; extra?: Record<string, unknown> }) {
      const row: Record<string, unknown> = {
        name: 'Serie A Traders', commissioner_id: COMMISH, invite_code: crypto.randomUUID(), num_participants: 8,
        num_rounds: 6, num_weeks: 11, league_type: 'matchup', playoff_teams: 4, stake_mode: 'budget_cap',
        budget_amount: '250.00', ...o.extra,
      };
      const keys = Object.keys(row);
      const [l] = await q(
        `insert into leagues (${keys.join(',')}, draft_date) values (${keys.map((_, i) => '$' + (i + 1)).join(',')},
           case when $${keys.length + 1}::float8 is null then null else now() + make_interval(secs => $${keys.length + 1}::float8 * 60) end)
         returning id`,
        [...Object.values(row), o.minutes],
      );
      const n = o.members ?? 4;
      const bots = o.bots ?? 0;
      const ids = [COMMISH, MEMBER, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
        .slice(0, n - bots).concat(Array.from({ length: bots }, (_, i) => `bot-${i + 1}`));
      for (const u of ids) await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [l.id, u]);
      await q(`insert into league_draft_slots (league_id, slot_index, slot_count, price_min, price_max)
        values ($1,1,3,50.50,null),($1,0,3,null,50.50)`, [l.id]);
      return l.id as string;
    }
    /** The expectation exactly as draft-start.ts builds it (PostgREST-shaped rows). */
    async function expectFor(L: string) {
      const [lg] = await q(`select stake_mode, budget_amount::float8 budget_amount, num_rounds, allow_undraftable,
        league_type, playoff_teams from leagues where id=$1`, [L]);
      const [{ n }] = await q(`select count(*)::int n from league_members where league_id=$1`, [L]);
      const [{ rc }] = await q(`select exists (select 1 from league_roster_reconfirm where league_id=$1) rc`, [L]);
      const slots: Slot[] = (await q(`select id::text id, slot_index, slot_count, price_min::float8 pmin, price_max::float8 pmax,
        category_id::text cat from league_draft_slots where league_id=$1 order by slot_index desc`, [L])).map((s: Row) => ({
          id: s.id, slotIndex: s.slot_index, slotCount: s.slot_count, priceMin: s.pmin, priceMax: s.pmax, categoryId: s.cat,
        }));
      return buildStartExpect(lg, n, slots, rc);
    }
    const dd = async (L: string) => (await q(`select draft_date from leagues where id=$1`, [L]))[0].draft_date as Date | null;
    const svc = async (sql: string, p: unknown[] = []) => (await as('service', () => q(sql, p)))[0];
    const record = async (L: string, blocked: boolean | null, gate = false, blockers: unknown[] = []) =>
      (await svc(`select public.record_draft_watch($1, $2, $3::jsonb, $4, $5::jsonb, $6) r`,
        [L, await dd(L), JSON.stringify(await expectFor(L)), blocked, JSON.stringify(blockers), gate])).r;
    const postpone = async (L: string, stage = 'room_open', reason = 'not_enough_members') =>
      (await svc(`select public.postpone_league_draft($1, $2, $3, $4, '[{"code":"not_enough_members"}]'::jsonb) r`,
        [L, await dd(L), stage, reason])).r;
    const start = async (L: string, expect?: unknown) =>
      (await svc(`select public.start_league_draft($1, $2::jsonb) r`, [L, JSON.stringify(expect ?? await expectFor(L))])).r;
    const status = async (L: string) => (await q(`select draft_status s from leagues where id=$1`, [L]))[0].s;
    const watchDue = async () => (await as('service', () => q(`select league_id from public.draft_watch_due()`))).map((r: Row) => r.league_id);
    const startDue = async () => (await as('service', () => q(`select league_id from public.due_draft_starts()`))).map((r: Row) => r.league_id);
    const notices = async (L: string, kind?: string) =>
      (await q(`select user_id, kind, push_status from league_notifications where league_id=$1 ${kind ? 'and kind=$2' : ''}
        order by created_at, user_id`, kind ? [L, kind] : [L]));
    /** As the owner: the room opened for the CURRENT draft time (a past one, for start cases). */
    const roomOpened = async (L: string) => {
      await q(`select public._draft_order_sync($1, true)`, [L]);
      await q(`insert into draft_start_watch (league_id, draft_date, inputs_sig, blocked, gate_cleared_at, room_opened_at)
        select id, draft_date, 'x', false, now(), now() from leagues where id=$1`, [L]);
    };

    // ---- legacy fixtures, BEFORE the migrations under test ------------------
    const LEGACY = await league({ minutes: -60 * 24 * 3 });      // not_started, its time long gone
    const LEGACY_FUTURE = await league({ minutes: 60 * 24 * 3 }); // still ahead: untouched
    // Its member inserts finalized the order (#67: due + 4 members), which wrote a
    // pending 'draft_order_set' per human that its deferred cron never delivered.
    const pendingBefore = (await notices(LEGACY, 'draft_order_set')).map((x: Row) => x.push_status);
    assertEquals(pendingBefore, ['pending', 'pending', 'pending', 'pending']);
    for (const m of UNDER_TEST) await db.exec(await Deno.readTextFile(m));

    await t.step('one-off backfills: past not_started leagues postponed silently; #67\'s pending pushes settled', async () => {
      const pp = await q(`select league_id, stage, reason from draft_postponements order by league_id`);
      assertEquals(pp.map((r: Row) => [r.league_id, r.stage, r.reason]), [[LEGACY, 'legacy', 'legacy_past_date']]);
      assert((await dd(LEGACY)) !== null, 'the legacy backfill does not touch leagues.draft_date');
      assertEquals((await notices(LEGACY, 'draft_postponed')).length, 0, 'nobody is told about a legacy league');
      assertEquals((await notices(LEGACY, 'draft_order_set')).map((x: Row) => x.push_status), ['skipped', 'skipped', 'skipped', 'skipped']);
      assert(!(await startDue()).includes(LEGACY) && !(await watchDue()).includes(LEGACY));
      assert((await watchDue()).includes(LEGACY_FUTURE));
    });

    await t.step('structure: grants, security mode, search_path, RLS, lock clauses', async () => {
      const want: Array<[string, boolean]> = [
        ['_draft_start_inputs', false], ['clear_draft_postponement_on_reschedule', true], ['draft_notice_context', true],
        ['draft_room_notices_due', false], ['draft_start_policy', false], ['draft_watch_due', false],
        ['due_draft_starts', false], ['enforce_league_rules_frozen_after_draft_start', false],
        ['enforce_leagues_draft_time', true], ['enforce_leagues_insert_not_started', false],
        ['league_notifications_order_set_in_app', false], ['open_due_draft_rooms', true],
        ['postpone_league_draft', true], ['record_draft_watch', true], ['start_league_draft', true],
      ];
      const fns = await q(`select proname, prosecdef, proconfig, coalesce(proacl::text,'') acl from pg_proc
        where proname = any($1) order by proname`, [want.map(([n]) => n)]);
      assertEquals(fns.map((f: Row) => [f.proname, f.prosecdef]), want);
      const internal = ['clear_draft_postponement_on_reschedule', 'enforce_league_rules_frozen_after_draft_start',
        'enforce_leagues_draft_time', 'enforce_leagues_insert_not_started', 'league_notifications_order_set_in_app'];
      for (const f of fns) {
        assert(f.acl !== '', `${f.proname}: proacl NULL means default PUBLIC execute`);
        assert(!/(^|[{,])=X/.test(f.acl), `${f.proname}: PUBLIC grant survives: ${f.acl}`);
        assert(!/anon=|authenticated=/.test(f.acl), `${f.proname}: default role grant survives: ${f.acl}`);
        assertEquals(f.proconfig, ['search_path=public, pg_temp']);
        if (!internal.includes(f.proname)) assert(/service_role=X/.test(f.acl), `${f.proname}: service_role cannot execute`);
      }
      for (const tbl of ['draft_start_watch', 'draft_postponements']) {
        const [tb] = await q(`select relrowsecurity rls, relacl::text acl from pg_class where oid=$1::regclass`, [`public.${tbl}`]);
        assert(tb.rls, `RLS off on ${tbl}`);
        assert(!/anon=|authenticated=/.test(tb.acl), `${tbl} client grant: ${tb.acl}`);
        assert(/service_role=r\//.test(tb.acl), `${tbl}: service_role must be SELECT-only: ${tb.acl}`);
      }
      const src = async (fn: string) =>
        ((await q(`select prosrc from pg_proc where proname=$1`, [fn]))[0].prosrc as string).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
      for (const fn of ['start_league_draft', 'postpone_league_draft']) {
        const b = await src(fn);
        assert(/from public\.leagues where id = p_league_id for update/i.test(b), `${fn} must lock the league FOR UPDATE`);
      }
      assert(/from public\.leagues where id = p_league_id for share/i.test(await src('record_draft_watch')), 'record_draft_watch FOR SHARE');
      const st = await src('start_league_draft');
      assert(st.indexOf('for update') < st.indexOf('update public.leagues set draft_status'), 'lock before the flip');
      const pp = await src('postpone_league_draft');
      assert(pp.indexOf('insert into public.draft_postponements') < pp.indexOf('update public.leagues set draft_date = null'),
        'the postponement row BEFORE clearing the date');
    });

    await t.step('policy: SQL draft_start_policy() equals the TS SQL_POLICY', async () => {
      const [r] = await q(`select public.draft_start_policy() j`);
      assertEquals(r.j, { ...SQL_POLICY });
    });

    await t.step('kinds: the union CHECK (draft auto-start + #67 + #94 + #126); draft_order_set is in-app only', async () => {
      const L = await league({ minutes: 600 });
      for (const k of ['draft_room_open', 'draft_started', 'draft_at_risk', 'draft_postponed', 'member_left',
        'renewal_invite', 'renewal_reply', 'renewal_nudge', 'renewal_removed', 'season_set']) {
        await q(`insert into league_notifications (league_id, user_id, kind) values ($1, $2, $3)`, [L, MEMBER, k]);
      }
      await refused(() => q(`insert into league_notifications (league_id, user_id, kind) values ($1, $2, 'bogus')`, [L, MEMBER]),
        'league_notifications_kind_check', '23514');
      await q(`insert into league_notifications (league_id, user_id, kind) values ($1, $2, 'draft_order_set')`, [L, COMMISH]);
      const [r] = await q(`select push_status, push_error from league_notifications where league_id=$1 and kind='draft_order_set'`, [L]);
      assertEquals([r.push_status, r.push_error], ['skipped', 'superseded_by_draft_room_open']);
      assertEquals((await notices(L, 'draft_room_open'))[0].push_status, 'pending', 'the new kinds stay pending for delivery');
    });

    await t.step('watch due: no verdict, a changed input, stale inside 24 h, the reminder; quiet otherwise', async () => {
      const L = await league({ minutes: 300 });          // 5 h out
      const FAR = await league({ minutes: 60 * 48 });    // 2 days out
      assert((await watchDue()).includes(L), 'no verdict yet');
      assertEquals((await record(L, false)).status, 'recorded');
      await record(FAR, false);
      let d = await watchDue();
      assert(!d.includes(L) && !d.includes(FAR), 'a fresh unchanged verdict is quiet');
      await q(`insert into league_members (league_id, user_id) values ($1, 'late-joiner')`, [L]);
      assert((await watchDue()).includes(L), 'a join changes the inputs');
      await record(L, false);
      await q(`update leagues set playoff_teams = 5 where id=$1`, [L]);
      assert((await watchDue()).includes(L), 'a settings edit changes the inputs');
      await record(L, false);
      await q(`update draft_start_watch set evaluated_at = now() - interval '6 minutes' where league_id = any($1)`, [[L, FAR]]);
      d = await watchDue();
      assert(d.includes(L) && !d.includes(FAR), 'stale re-evaluation only inside the 24 h horizon');
      const P = await league({ minutes: 300 });
      await postpone(P).catch(() => null);
      assert(!(await watchDue()).includes(P), 'a postponed league is never watched');
    });

    await t.step('at risk: the commissioner is told ONCE when it becomes blocked, again only after it cleared', async () => {
      const L = await league({ minutes: 300, members: 4, bots: 1 });
      const blk = [{ code: 'not_enough_members' }];
      let r = await record(L, true, false, blk);
      assertEquals([r.status, r.blocked, r.notified], ['recorded', true, 'at_risk']);
      r = await record(L, true, false, blk);
      assertEquals(r.notified, null, 'still blocked: no second push');
      r = await record(L, null);
      assertEquals([r.blocked, r.notified], [true, null], 'unknown keeps the verdict, tells nobody');
      r = await record(L, false);
      assertEquals([r.blocked, r.notified], [false, null]);
      r = await record(L, true, false, blk);
      assertEquals(r.notified, 'at_risk', 'blocked again: a new warning');
      const n = await notices(L, 'draft_at_risk');
      assertEquals(n.map((x: Row) => x.user_id), [COMMISH, COMMISH], 'only ever the commissioner');
      const [w] = await q(`select blockers from draft_start_watch where league_id=$1`, [L]);
      assertEquals(w.blockers, blk);
    });

    await t.step('reminder: blocked before T-2h -> one reminder inside it; a first warning inside T-2h is the reminder', async () => {
      const L = await league({ minutes: 300 });
      await record(L, true, false, [{ code: 'x' }]);                      // warned at T-5h
      await q(`update leagues set draft_date = now() + interval '90 minutes' where id=$1`, [L]); // now inside T-2h
      // (a new time is a new episode: re-warn, and it counts as the reminder)
      let r = await record(L, true, false, [{ code: 'x' }]);
      assertEquals(r.notified, 'at_risk');
      assert(!(await watchDue()).includes(L), 'reminder already counted: quiet');
      r = await record(L, true, false, [{ code: 'x' }]);
      assertEquals(r.notified, null);
      // Same episode, warned BEFORE T-2h (seeded: the clock can't be moved), now inside it: one reminder.
      const M = await league({ minutes: 90 });
      await q(`insert into draft_start_watch (league_id, draft_date, inputs_sig, blocked, blockers, blocked_since, evaluated_at)
        select id, draft_date, 'old', true, '[{"code":"x"}]', now() - interval '3 hours', now() - interval '3 hours'
          from leagues where id=$1`, [M]);
      assert((await watchDue()).includes(M), 'the reminder is due');
      r = await record(M, true, false, [{ code: 'x' }]);
      assertEquals(r.notified, 'reminder');
      r = await record(M, true, false, [{ code: 'x' }]);
      assertEquals(r.notified, null, 'one reminder per episode');
      assertEquals((await notices(M, 'draft_at_risk')).length, 1);
    });

    await t.step('record: CAS and staleness (a join mid-evaluation, a moved time, a postponed or started league)', async () => {
      const L = await league({ minutes: 300 });
      const e = await expectFor(L);
      await q(`insert into league_members (league_id, user_id) values ($1, 'mid-eval')`, [L]);
      const r = (await svc(`select public.record_draft_watch($1, $2, $3::jsonb, false, '[]'::jsonb, false) r`,
        [L, await dd(L), JSON.stringify(e)])).r;
      assertEquals(r.status, 'changed');
      const stale = (await svc(`select public.record_draft_watch($1, now() + interval '9 hours', $2::jsonb, false, '[]'::jsonb, false) r`,
        [L, JSON.stringify(await expectFor(L))])).r;
      assertEquals(stale.status, 'stale');
    });

    await t.step('gate: clear in the window -> gate cleared; unknown clears only at the room time', async () => {
      const L = await league({ minutes: 60.2 });   // T-1h-12s: in the gate, before the room
      assert((await watchDue()).includes(L), 'in the gate window, not cleared yet');
      let r = await record(L, null, true);
      assertEquals(r.gate_cleared, false, 'unknown before the room time does not clear');
      r = await record(L, false, true);
      assertEquals(r.gate_cleared, true);
      assert(!(await watchDue()).includes(L), 'cleared: quiet until the start');
      const U = await league({ minutes: 59 });                // past T-1h: the room time has come
      r = await record(U, null, true);
      assertEquals(r.gate_cleared, true, 'unknown at the room time clears (fail open for the notice)');
    });

    await t.step('postpone: row first, date cleared, watch gone, every human told; #67 finalize not triggered', async () => {
      const L = await league({ minutes: 60.2, members: 5, bots: 1 });   // in the gate, before the room
      await record(L, true, false, [{ code: 'not_enough_members' }]);
      const r = await postpone(L);
      assertEquals(r.status, 'postponed');
      const [p] = await q(`select stage, reason, postponed_from is not null f from draft_postponements where league_id=$1`, [L]);
      assertEquals([p.stage, p.reason, p.f], ['room_open', 'not_enough_members', true]);
      assertEquals(await dd(L), null, 'draft_date cleared: nothing is due, leaving re-opens (#126)');
      assertEquals((await q(`select 1 from draft_start_watch where league_id=$1`, [L])).length, 0);
      const told = (await notices(L, 'draft_postponed')).map((x: Row) => x.user_id).sort();
      assertEquals(told.length, 4, 'four humans, the bot skipped');
      assert(!told.some((u: string) => u.startsWith('bot-')));
      const [m] = await q(`select state from league_draft_order_meta where league_id=$1`, [L]);
      assert(!m || m.state === 'open', `the order must not be finalized by the postponement: ${m?.state}`);
      assertEquals((await postpone(L).catch(() => ({ status: 'no-date' }))).status !== 'postponed', true);
      // stale: a moved time is untouched; started: refused.
      const S = await league({ minutes: 300 });
      const stale = (await svc(`select public.postpone_league_draft($1, now(), 'room_open', 'x', '[]'::jsonb) r`, [S])).r;
      assertEquals(stale.status, 'stale');
      assertEquals((await svc(`select public.postpone_league_draft($1, $2, 'legacy', 'x', '[]'::jsonb) r`, [S, await dd(S)])).r.reason,
        'bad_stage', 'only room_open / start from the API');
    });

    await t.step('rooms: open_due_draft_rooms finalizes + tells every human once; late joiners too; gated + postponed never', async () => {
      const L = await league({ minutes: 59, members: 5, bots: 1 });   // the room's time has come
      const NOT_CLEARED = await league({ minutes: 59 });
      await record(L, false, true);
      // A verdict exists for NOT_CLEARED (recorded outside the gate path), but the gate never cleared it.
      assertEquals((await record(NOT_CLEARED, false, false)).gate_cleared, false);
      const [{ due: before }] = await q(`select public.draft_room_notices_due() due`);
      assertEquals(before, true);
      const [{ n }] = await as('service', () => q(`select public.open_due_draft_rooms() n`));
      assert(n >= 1);
      const [m] = await q(`select state from league_draft_order_meta where league_id=$1`, [L]);
      assertEquals(m.state, 'finalized');
      const told = await notices(L, 'draft_room_open');
      assertEquals(told.length, 4, 'one per human');
      assert(told.every((x: Row) => x.push_status === 'pending'));
      assertEquals((await notices(NOT_CLEARED, 'draft_room_open')).length, 0, 'the gate never cleared it: no room');
      await as('service', () => q(`select public.open_due_draft_rooms()`));
      assertEquals((await notices(L, 'draft_room_open')).length, 4, 'idempotent');
      await q(`insert into league_members (league_id, user_id) values ($1, 'late-human')`, [L]);
      const [{ due: late }] = await q(`select public.draft_room_notices_due() due`);
      assertEquals(late, true, 'a late joiner is owed a notice');
      await as('service', () => q(`select public.open_due_draft_rooms()`));
      assertEquals((await notices(L, 'draft_room_open')).map((x: Row) => x.user_id).filter((u: string) => u === 'late-human').length, 1);
      await q(`delete from league_notifications where league_id = $1 and kind = 'draft_room_open'`, [NOT_CLEARED]);
      const [{ pending }] = await q(`select exists (select 1 from leagues l join draft_start_watch w on w.league_id = l.id
        where l.id = $1 and w.room_opened_at is null) pending`, [L]);
      assertEquals(pending, false);
    });

    await t.step('start: due list excludes postponed; the room must have opened; floor; CAS; started + notices; idempotent', async () => {
      const L = await league({ minutes: -1, members: 5, bots: 1 });
      assert((await startDue()).includes(L));
      assertEquals((await start(L)).status, 'room_not_open', 'no >= 1 h notice went out: the caller postpones');
      await roomOpened(L);
      const judged = await expectFor(L);
      await db.exec('begin');
      await q(`update leagues set playoff_teams = 3 where id=$1`, [L]);
      assertEquals((await start(L, judged)).status, 'changed');
      await db.exec('rollback');
      const r = await start(L);
      assertEquals(r.status, 'started', JSON.stringify(r));
      const [l] = await q(`select draft_status, draft_started_at from leagues where id=$1`, [L]);
      assertEquals(l.draft_status, 'in_progress');
      assert(l.draft_started_at, 'the pick clock anchors the first turn');
      assertEquals((await q(`select state from league_draft_order_meta where league_id=$1`, [L]))[0].state, 'locked');
      assertEquals((await notices(L, 'draft_started')).length, 4, 'every human in the order');
      assertEquals((await q(`select 1 from draft_start_watch where league_id=$1`, [L])).length, 0);
      const again = await start(L);
      assertEquals([again.status, again.draft_status], ['already_started', 'in_progress']);
      // Floor cases (room opened, still refused).
      for (const [extra, members, reason] of [[{ stake_mode: null }, 4, 'no_stake_mode'], [{}, 3, 'not_enough_members'],
        [{ playoff_teams: 5 }, 4, 'playoff_teams_exceeds_members']] as Array<[Record<string, unknown>, number, string]>) {
        const F = await league({ minutes: -1, members, extra });
        await roomOpened(F);
        const f = await start(F);
        assertEquals([f.status, f.reason], ['blocked', reason]);
      }
      const P = await league({ minutes: 300 });
      await postpone(P);
      assertEquals((await start(P, {})).status, 'postponed');
      assertEquals((await start(await league({ minutes: 30 }), {})).status, 'not_due');
    });

    await t.step('gates under the lock: #126\'s REAL reconfirm gate and a #94 stand-in are "blocked"; others re-raise', async () => {
      const R = await league({ minutes: -1 });
      await roomOpened(R);
      await q(`insert into league_roster_reconfirm (league_id, departed, members_before)
        values ($1, '[{"user_id":"x","name":"Sofia F."}]'::jsonb, 5)`, [R]);
      const rr = await start(R);
      assertEquals([rr.status, rr.reason], ['blocked', 'roster_reconfirm_required']);
      await db.exec(`
        create table gate_flags (league_id uuid primary key, msg text not null);
        create function test_gate() returns trigger language plpgsql as $$
        declare v text;
        begin
          select msg into v from gate_flags where league_id = new.id;
          if v is not null then raise exception '%', v using errcode = '22023'; end if;
          return new;
        end $$;
        create trigger trg_leagues_test_gate before update of draft_status on leagues
          for each row execute function test_gate();`);
      const G = await league({ minutes: -1 });
      await roomOpened(G);
      await q(`insert into gate_flags values ($1, 'renewal_replies_pending: every Season 1 player must answer before the draft can be set or started')`, [G]);
      const rg = await start(G);
      assertEquals([rg.status, rg.reason], ['blocked', 'renewal_replies_pending']);
      const X = await league({ minutes: -1 });
      await roomOpened(X);
      await q(`insert into gate_flags values ($1, 'draft_order_locked_mismatch: test')`, [X]);
      const ex = await expectFor(X);
      await refused(() => start(X, ex), 'draft_order_locked_mismatch', '22023');
      await db.exec(`drop trigger trg_leagues_test_gate on leagues; drop function test_gate(); drop table gate_flags;`);
      for (const L of [R, G, X]) assertEquals(await status(L), 'not_started');
    });

    await t.step('notice context: everything a push needs, read at send time', async () => {
      const L = await league({ minutes: 300 });
      await record(L, true, false, [{ code: 'not_enough_members' }]);
      const [nt] = await q(`select id from league_notifications where league_id=$1 and kind='draft_at_risk'`, [L]);
      const c = (await svc(`select public.draft_notice_context($1) c`, [nt.id])).c;
      assertEquals([c.kind, c.is_commissioner, c.commissioner_name, c.is_member, c.league_name, c.watch.blocked],
        ['draft_at_risk', true, 'Roberto B.', true, 'Serie A Traders', true]);
      assertEquals(c.postponement, null);
    });

    await t.step('draft time: quarter hours, >= 55 min, locked once the room is open (except postponed); service exempt', async () => {
      const L = await league({ minutes: 600 });
      const set = (when: string) => as('commish', () => q(`update leagues set draft_date = ${when} where id=$1`, [L]));
      const quarter = (mins: number) => `date_trunc('hour', now()) + interval '${mins} minutes'`;
      await refused(() => set(`${quarter(24 * 60)} + interval '7 minutes'`), 'draft_time_invalid', '22023');
      await refused(() => set(`${quarter(24 * 60)} + interval '30 seconds'`), 'draft_time_invalid', '22023');
      await refused(() => set(quarter(0)), 'draft_time_too_soon', '22023');     // this hour: < 55 min ahead
      await set(quarter(24 * 60 + 15));                                        // tomorrow, :15
      await set('null');                                                       // TBD before the room opens
      // Same-value off-grid legacy value passes (league-settings always sends it).
      const OFF = await league({ minutes: 600 + 7.5 });
      await as('commish', () => q(`update leagues set draft_date = draft_date, name = 'renamed' where id=$1`, [OFF]));
      // Room open: locked, even to a valid time, and clearing is refused too.
      const R = await league({ minutes: 45 });
      await refused(() => as('commish', () => q(`update leagues set draft_date = ${quarter(48 * 60)} where id=$1`, [R])),
        'draft_time_locked', '22023');
      await refused(() => as('commish', () => q(`update leagues set draft_date = null where id=$1`, [R])), 'draft_time_locked', '22023');
      // Postponed (date cleared): a new valid time is allowed and ends the postponement.
      const P = await league({ minutes: 60.2 });
      await postpone(P);
      await as('commish', () => q(`update leagues set draft_date = ${quarter(48 * 60)} where id=$1`, [P]));
      assertEquals((await q(`select 1 from draft_postponements where league_id=$1`, [P])).length, 0, 'rescheduled');
      // Legacy postponed (old past date kept): allowed too.
      await as('commish', () => q(`update leagues set draft_date = ${quarter(48 * 60)} where id=$1`, [LEGACY]));
      assertEquals((await q(`select 1 from draft_postponements where league_id=$1`, [LEGACY])).length, 0);
      // INSERT is judged too; the service role is exempt; a started league is inert history.
      await refused(() => as('commish', () => q(`insert into leagues (name, commissioner_id, invite_code, num_participants, draft_date)
        values ('x', $1, $2, 8, now() + interval '2 hours 7 minutes')`, [COMMISH, crypto.randomUUID()])), 'draft_time', '22023');
      await as('service', () => q(`update leagues set draft_date = now() + interval '3 minutes' where id=$1`, [L]));
      const S = await league({ minutes: -5 });
      await q(`update leagues set draft_status = 'completed' where id=$1`, [S]);
      await as('commish', () => q(`update leagues set draft_date = now() - interval '1 day' where id=$1`, [S]));
    });

    await t.step('server-only: no user session changes draft_status; same-value patches and the service role pass', async () => {
      const L = await league({ minutes: 60 * 5 });
      await as('commish', () => refused(() => q(`update leagues set draft_status='in_progress' where id=$1`, [L]), 'draft_status_server_only'));
      await as('commish', () => refused(() => q(`update leagues set draft_status='completed' where id=$1`, [L]), 'draft_status_server_only'));
      await as('commish', () => q(`update leagues set draft_status='not_started', name='renamed' where id=$1`, [L]));
      const P = await league({ minutes: -1 });
      await q(`update leagues set draft_status='in_progress' where id=$1`, [P]);   // owner, exempt
      await as('member', () => refused(() => q(`update leagues set draft_status='completed' where id=$1`, [P]), 'draft_status_server_only'));
      await as('service', () => q(`update leagues set draft_status='completed' where id=$1`, [P]));
      await as('commish', () => refused(() => q(`update leagues set draft_status='not_started' where id=$1`, [P]), 'draft_status_server_only'));
      await as('commish', () => refused(() => q(`update leagues set num_rounds=9 where id=$1`, [P]), 'league_rules_locked'));
      await as('commish', () => refused(() => q(`insert into leagues (name, commissioner_id, invite_code, num_participants, draft_status)
        values ('x', $1, $2, 8, 'in_progress')`, [COMMISH, crypto.randomUUID()]), 'draft_status_server_only'));
      await as('commish', () => q(`insert into leagues (name, commissioner_id, invite_code, num_participants)
        values ('ok', $1, $2, 8)`, [COMMISH, crypto.randomUUID()]));
    });

    await t.step('clients: authenticated cannot call any auto-start function or read its tables', async () => {
      for (const sql of [`select public.start_league_draft(gen_random_uuid(), '{}'::jsonb)`,
        `select public.postpone_league_draft(gen_random_uuid(), now(), 'start', 'x', '[]'::jsonb)`,
        `select public.record_draft_watch(gen_random_uuid(), now(), '{}'::jsonb, false, '[]'::jsonb, false)`,
        `select * from public.due_draft_starts()`, `select * from public.draft_watch_due()`,
        `select public.open_due_draft_rooms()`, `select public.draft_room_notices_due()`,
        `select public.draft_notice_context(gen_random_uuid())`, `select public._draft_start_inputs(gen_random_uuid())`,
        `select * from public.draft_start_watch`, `select * from public.draft_postponements`]) {
        await as('commish', () => refused(() => q(sql), 'permission denied'));
      }
    });

    await t.step('cron guards (sliced from the LATEST schedules): the sweep and the notify job post only when there is work', async () => {
      // Isolate: retire every fixture league from every list (#126's gate refuses a
      // start while a confirmation is owed, for the owner too: clear those first).
      await q(`delete from league_roster_reconfirm`);
      await q(`update leagues set draft_status = 'completed' where draft_status <> 'completed'`);
      await q(`update league_notifications set push_status = 'sent' where push_status in ('pending', 'sending')`);
      const sweep = await latestGuard('draft_autopick_sweep');
      assert(sweep.guard.includes('public.due_draft_starts()') && sweep.guard.includes('public.draft_watch_due()'), sweep.file);
      const notify = await latestGuard('draft_order_notify');
      assert(notify.guard.includes('public.draft_room_notices_due()'), notify.file);
      const posts = async (g: string) => (await q(`select 1 as post ${g}`)).length === 1;
      assertEquals(await posts(sweep.guard), false, 'sweep idle');
      assertEquals(await posts(notify.guard), false, 'notify idle');
      const W = await league({ minutes: 300 });
      assertEquals(await posts(sweep.guard), true, 'a league to watch');
      await record(W, false);
      assertEquals(await posts(sweep.guard), false, 'watched and unchanged');
      const D = await league({ minutes: -1 });
      assertEquals(await posts(sweep.guard), true, 'a draft at its time');
      await q(`update leagues set draft_status = 'completed' where id = $1`, [D]);
      const O = await league({ minutes: 59 });
      await record(O, false, true);
      assertEquals(await posts(notify.guard), true, 'a room to open');
      await as('service', () => q(`select public.open_due_draft_rooms()`));
      assertEquals(await posts(notify.guard), true, 'pending room-open pushes');
      await q(`update league_notifications set push_status = 'sent' where push_status = 'pending'`);
      // (#67's draft_order_notify_due still sees the due unfinalized league W? no: W is 5 h out.)
      assertEquals(await posts(notify.guard), false, 'all delivered');
    });

    await t.step('effect test: docs/security/draft-auto-start-effect-test.sql passes verbatim, writes nothing', async () => {
      const sql = await Deno.readTextFile(new URL('docs/security/draft-auto-start-effect-test.sql', ROOT));
      const [{ n: before }] = await q(`select count(*)::int n from leagues`);
      let msg = '';
      try {
        await db.exec(sql);
      } catch (e) {
        msg = String((e as Error).message);
      }
      const lines = msg.split('\n').filter((l) => /^[A-Z]\d+ /.test(l));
      assert(lines.length >= 20, msg);
      const bad = lines.filter((l) => !(l.endsWith('PASS') || (l.startsWith('C') && l.endsWith('SKIP'))));
      assertEquals(bad, [], msg);
      const [{ n: after }] = await q(`select count(*)::int n from leagues`);
      assertEquals(after, before, 'the effect block must roll back');
    });

    await db.close();
  },
});
