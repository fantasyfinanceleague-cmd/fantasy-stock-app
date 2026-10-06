/**
 * Draft auto-start (20261109000000 + 20261109000001, and the cron guard of
 * 20261109000002) against REAL Postgres (PGlite). NOT hermetic: the first run
 * fetches npm:@electric-sql/pglite. Run:
 *   deno test --allow-read --allow-env supabase/tests/draft_auto_start.pglite.test.ts
 *
 * Loads VERBATIM, in prod order, every migration whose triggers fire on a
 * leagues / league_members write (the same chain as
 * freeze_league_rules.pglite.test.ts, plus draft_stalls for the cron guard and
 * #126's reconfirm table + start gate),
 * then the two migrations under test. So start_league_draft's UPDATE runs the
 * real order lock, pick-clock anchor and #123 freeze, and the server-only rule
 * runs inside #123's real function. leagues is built by replaying every leagues
 * DDL statement in supabase/migrations/ (as the freeze test does), so the CAS is
 * judged against the real column types (numeric budget_amount, etc.).
 *
 * The cron file itself cannot run here (no pg_cron / pg_net / vault): its
 * where-guard is SLICED out of the latest migration that schedules
 * 'draft_autopick_sweep' and executed against the real overdue_draft_turns()
 * and due_draft_starts().
 *
 * What one connection cannot show: two starters racing on the row lock. The
 * lock clause is pinned structurally; the argument is in 20261109000000's
 * header.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { buildStartExpect } from '../functions/_shared/draft-start.ts';
import { START_GRACE_SECONDS } from '../functions/_shared/draft-start-policy.ts';
import type { Slot } from '../functions/_shared/draft-validation.ts';

const ROOT = new URL('../../', import.meta.url);
const MIGRATIONS = [   // prod (timestamp) order
  '20251205110000_enable_drafts_rls.sql',
  '20260712000000_rls_b1_00_helpers.sql',
  '20260712000001_rls_b1_01_leagues.sql',
  '20260712000002_rls_b1_02_league_members.sql',
  '20260810000004_create_league_draft_slots.sql',
  '20260811000003_drafts_drop_direct_client_insert.sql',
  '20260925000000_leagues_member_draft_complete_column_guard.sql',
  '20261010000000_draft_pick_clock_and_queue.sql',
  '20261012000002_freeze_playoff_teams_after_draft_start.sql',
  '20261013000000_draft_order_modes.sql',
  '20261101000001_draft_stalls.sql',
  '20261104000000_freeze_league_rules_after_draft_start.sql',
  // #126: league_roster_reconfirm + the REAL start gate (trg_leagues_roster_reconfirm_gate).
  '20261107000000_leave_league_schema.sql',
  '20261107000006_draft_waits_for_roster_reconfirm.sql',
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

/** The latest migration (not deferred/) that schedules draft_autopick_sweep. */
async function latestSweepSchedule(): Promise<{ file: string; sql: string }> {
  const dir = new URL('supabase/migrations/', ROOT);
  const hits: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith('.sql')) continue;
    const sql = await Deno.readTextFile(new URL(e.name, dir));
    if (/cron\.schedule\(\s*'draft_autopick_sweep'/.test(sql)) hits.push(e.name);
  }
  hits.sort();
  const file = hits[hits.length - 1];
  return { file, sql: await Deno.readTextFile(new URL(file, dir)) };
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
    for (const m of MIGRATIONS) await db.exec(await Deno.readTextFile(m));

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

    /** A league as the owner (auth.uid() NULL), with `members` members and two slots. */
    async function league(opts: { minutesFromNow: number | null; members?: number; extra?: Record<string, unknown> }) {
      const row: Record<string, unknown> = {
        name: 'L', commissioner_id: COMMISH, invite_code: crypto.randomUUID(), num_participants: 8, num_rounds: 6,
        num_weeks: 11, league_type: 'matchup', playoff_teams: 4, stake_mode: 'budget_cap', budget_amount: '250.00',
        draft_date: opts.minutesFromNow === null ? null : new Date(Date.now() + opts.minutesFromNow * 60_000).toISOString(),
        ...opts.extra,
      };
      const keys = Object.keys(row);
      const [l] = await q(
        `insert into leagues (${keys.join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning id`,
        Object.values(row),
      );
      const ids = [COMMISH, MEMBER, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()].slice(0, opts.members ?? 4);
      for (const u of ids) await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [l.id, u]);
      await q(`insert into league_draft_slots (league_id, slot_index, slot_count, price_min, price_max)
        values ($1,1,3,50.50,null),($1,0,3,null,50.50)`, [l.id]);
      return l.id as string;
    }
    /** The expectation exactly as draft-start.ts builds it: PostgREST-shaped rows
     * (numerics as JS numbers) through the real buildStartExpect. */
    async function expectFor(L: string) {
      const [lg] = await q(`select stake_mode, budget_amount::float8 budget_amount, num_rounds, allow_undraftable,
        league_type, playoff_teams from leagues where id=$1`, [L]);
      const [{ n }] = await q(`select count(*)::int n from league_members where league_id=$1`, [L]);
      const slots: Slot[] = (await q(`select id::text id, slot_index, slot_count, price_min::float8 pmin, price_max::float8 pmax,
        category_id::text cat from league_draft_slots where league_id=$1 order by slot_index desc`, [L])).map((s: Row) => ({
          id: s.id, slotIndex: s.slot_index, slotCount: s.slot_count, priceMin: s.pmin, priceMax: s.pmax, categoryId: s.cat,
        }));
      return buildStartExpect(lg, n, slots);
    }
    const start = async (L: string, expect: unknown) =>
      (await as('service', () => q(`select public.start_league_draft($1, $2::jsonb) r`, [L, JSON.stringify(expect)])))[0].r;
    const status = async (L: string) => (await q(`select draft_status s from leagues where id=$1`, [L]))[0].s;
    const due = async () => (await as('service', () => q(`select league_id from public.due_draft_starts()`))).map((r: Row) => r.league_id);

    await t.step('structure: grants, security mode, search_path, RLS, lock clause', async () => {
      const fns = await q(`select proname, prosecdef, proconfig, coalesce(proacl::text,'') acl from pg_proc
        where proname in ('draft_start_grace','note_draft_start_blocked','due_draft_starts','start_league_draft',
                          'enforce_leagues_insert_not_started','enforce_league_rules_frozen_after_draft_start')
        order by proname`);
      assertEquals(fns.map((f: Row) => [f.proname, f.prosecdef]), [
        ['draft_start_grace', false],
        ['due_draft_starts', false],
        ['enforce_league_rules_frozen_after_draft_start', false],
        ['enforce_leagues_insert_not_started', false],
        ['note_draft_start_blocked', true],
        ['start_league_draft', true],
      ]);
      for (const f of fns) {
        assert(f.acl !== '', `${f.proname}: proacl NULL means default PUBLIC execute`);
        assert(!/(^|[{,])=X/.test(f.acl), `${f.proname}: PUBLIC grant survives: ${f.acl}`);
        assert(!/anon=|authenticated=/.test(f.acl), `${f.proname}: default role grant survives: ${f.acl}`);
        assertEquals(f.proconfig, ['search_path=public, pg_temp']);
      }
      for (const f of fns.filter((f: Row) => !f.proname.startsWith('enforce_'))) {
        assert(/service_role=X/.test(f.acl), `${f.proname}: service_role cannot execute: ${f.acl}`);
      }
      const [tb] = await q(`select relrowsecurity rls, relacl::text acl from pg_class where oid='public.draft_start_blocks'::regclass`);
      assert(tb.rls, 'RLS off on draft_start_blocks');
      assert(!/anon=|authenticated=/.test(tb.acl), `draft_start_blocks client grant: ${tb.acl}`);
      assert(/service_role=r\//.test(tb.acl), `draft_start_blocks: service_role must be SELECT-only (writes go through DEFINER fns): ${tb.acl}`);
      const [src] = await q(`select prosrc from pg_proc where proname='start_league_draft'`);
      const body = String(src.prosrc).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
      assert(/from public\.leagues where id = p_league_id for update/i.test(body), 'start_league_draft must take the row lock FOR UPDATE');
      assert(body.indexOf('for update') < body.indexOf('update public.leagues set draft_status'), 'lock before the flip');
    });

    await t.step('policy: SQL draft_start_grace() equals START_GRACE_SECONDS', async () => {
      const [r] = await q(`select extract(epoch from public.draft_start_grace())::int s`);
      assertEquals(r.s, START_GRACE_SECONDS);
    });

    await t.step('due_draft_starts: the half-open window [draft_date, draft_date + grace), TBD never', async () => {
      const inWin = await league({ minutesFromNow: -1 });
      const edge = await league({ minutesFromNow: -(START_GRACE_SECONDS / 60) + 0.5 });
      const past = await league({ minutesFromNow: -(START_GRACE_SECONDS / 60) - 0.5 });
      const future = await league({ minutesFromNow: 5 });
      const tbd = await league({ minutesFromNow: null });
      const d = await due();
      assert(d.includes(inWin) && d.includes(edge), 'in-window leagues must be due');
      assert(!d.includes(past) && !d.includes(future) && !d.includes(tbd), 'past-grace, future and TBD must not be due');
    });

    await t.step('back-off: a blocked attempt hides the league for 60 s; a new draft_date re-arms it at once', async () => {
      const L = await league({ minutesFromNow: -1 });
      await as('service', () => q(`select public.note_draft_start_blocked($1, 'x', '[]'::jsonb)`, [L]));
      assert(!(await due()).includes(L), 'blocked < 60 s ago: skipped');
      await q(`update draft_start_blocks set last_seen_at = now() - interval '61 seconds' where league_id=$1`, [L]);
      assert((await due()).includes(L), 'blocked > 60 s ago: tried again');
      // A second block increments attempts; a block against a new date restarts the episode.
      await as('service', () => q(`select public.note_draft_start_blocked($1, 'y', '[{"code":"y"}]'::jsonb)`, [L]));
      let [b] = await q(`select attempts, reason from draft_start_blocks where league_id=$1`, [L]);
      assertEquals([b.attempts, b.reason], [2, 'y']);
      await q(`update leagues set draft_date = now() - interval '2 minutes' where id=$1`, [L]);
      assert((await due()).includes(L), 'the block was for the OLD draft_date: no back-off');
      await as('service', () => q(`select public.note_draft_start_blocked($1, 'z', '[]'::jsonb)`, [L]));
      [b] = await q(`select attempts from draft_start_blocks where league_id=$1`, [L]);
      assertEquals(b.attempts, 1);
      // A started / TBD league is never noted.
      const T = await league({ minutesFromNow: null });
      await as('service', () => q(`select public.note_draft_start_blocked($1, 'x', '[]'::jsonb)`, [T]));
      assertEquals((await q(`select 1 from draft_start_blocks where league_id=$1`, [T])).length, 0);
    });

    await t.step('start_league_draft: not_due / missed / refused, nothing written', async () => {
      const F = await league({ minutesFromNow: 5 });
      assertEquals((await start(F, await expectFor(F))).status, 'not_due');
      const T = await league({ minutesFromNow: null });
      assertEquals((await start(T, await expectFor(T))).status, 'not_due');
      const M = await league({ minutesFromNow: -(START_GRACE_SECONDS / 60) - 1 });
      assertEquals((await start(M, await expectFor(M))).status, 'missed');
      assertEquals((await start(crypto.randomUUID(), {})).reason, 'league_not_found');
      for (const L of [F, T, M]) assertEquals(await status(L), 'not_started');
    });

    await t.step('start_league_draft: the floor (defense in depth)', async () => {
      const cases: Array<[Record<string, unknown>, number, string]> = [
        [{ stake_mode: null }, 4, 'no_stake_mode'],
        [{}, 3, 'not_enough_members'],
        [{ playoff_teams: null }, 4, 'invalid_playoff_teams'],
        [{ playoff_teams: 5 }, 4, 'playoff_teams_exceeds_members'],
      ];
      for (const [extra, members, reason] of cases) {
        const L = await league({ minutesFromNow: -1, members, extra });
        const r = await start(L, await expectFor(L));
        assertEquals([r.status, r.reason], ['blocked', reason]);
        assertEquals(await status(L), 'not_started');
      }
      // A duration league ignores playoff_teams, like computeStartBlockers.
      const D = await league({ minutesFromNow: -1, extra: { league_type: 'duration', playoff_teams: null } });
      assertEquals((await start(D, await expectFor(D))).status, 'started');
    });

    await t.step('CAS: every judged input that moves between evaluation and flip -> changed, nothing written', async () => {
      const L = await league({ minutesFromNow: -1 });
      const judged = await expectFor(L);
      const mutations: Array<[string, string, unknown[]]> = [
        ['playoff_teams', `update leagues set playoff_teams = 3 where id=$1`, [L]],
        ['budget_amount', `update leagues set budget_amount = 300 where id=$1`, [L]],
        ['num_rounds', `update leagues set num_rounds = 7 where id=$1`, [L]],
        ['allow_undraftable', `update leagues set allow_undraftable = true where id=$1`, [L]],
        ['stake_mode', `update leagues set stake_mode = 'price_tiers' where id=$1`, [L]],
        ['slot_count', `update league_draft_slots set slot_count = 4 where league_id=$1 and slot_index=0`, [L]],
        ['price_min', `update league_draft_slots set price_min = 50.51 where league_id=$1 and slot_index=1`, [L]],
        ['new slot', `insert into league_draft_slots (league_id, slot_index, slot_count) values ($1, 2, 1)`, [L]],
        ['join', `insert into league_members (league_id, user_id) values ($1, 'late-joiner')`, [L]],
      ];
      for (const [what, sql, params] of mutations) {
        await db.exec('begin');
        try {
          await q(sql, params);
          const r = await start(L, judged);
          assertEquals(r.status, 'changed', `${what} moved, but the start was ${JSON.stringify(r)}`);
          assertEquals(await status(L), 'not_started', what);
        } finally {
          await db.exec('rollback');
        }
      }
      assertEquals((await start(L, null)).status, 'changed', 'a NULL expectation never starts');
    });

    await t.step('started: TS expectation = SQL rebuild (numerics by value, slot order); order locked, clock anchored, block cleared', async () => {
      const L = await league({ minutesFromNow: -1 });
      await as('service', () => q(`select public.note_draft_start_blocked($1, 'x', '[]'::jsonb)`, [L]));
      const r = await start(L, await expectFor(L));
      assertEquals(r.status, 'started', JSON.stringify(r));
      const [l] = await q(`select draft_status, draft_started_at from leagues where id=$1`, [L]);
      assertEquals(l.draft_status, 'in_progress');
      assert(l.draft_started_at, 'trg_leagues_pick_clock must anchor the first turn');
      const [m] = await q(`select state from league_draft_order_meta where league_id=$1`, [L]);
      assertEquals(m.state, 'locked');
      const [{ n: order }] = await q(`select count(*)::int n from league_draft_order where league_id=$1`, [L]);
      assertEquals(order, 4);
      assertEquals((await q(`select 1 from draft_start_blocks where league_id=$1`, [L])).length, 0);
      // Idempotent: a second starter (the cron after a manual tap) is a no-op.
      const again = await start(L, await expectFor(L));
      assertEquals([again.status, again.draft_status], ['already_started', 'in_progress']);
      assert(!(await due()).includes(L));
    });

    await t.step('gates: #126\'s REAL reconfirm gate is "blocked"; a named stand-in (#94) too; any other 22023 re-raises', async () => {
      // The real one (20261107000006): a pending roster confirmation refuses the flip for every role.
      const R = await league({ minutesFromNow: -1 });
      await q(`insert into league_roster_reconfirm (league_id, departed, members_before)
        values ($1, '[{"user_id":"x","name":"Sam"}]'::jsonb, 5)`, [R]);
      const rr = await start(R, await expectFor(R));
      assertEquals([rr.status, rr.reason], ['blocked', 'roster_reconfirm_required']);
      assertEquals(await status(R), 'not_started');
      await q(`delete from league_roster_reconfirm where league_id=$1`, [R]);
      assertEquals((await start(R, await expectFor(R))).status, 'started', 'starts once confirmed');

      // #94's trg_leagues_renewal_gate is not on main: a stand-in raising its exact text
      // ('renewal_replies_pending: ...', errcode 22023, origin/feat/run-it-back 20261105000004).
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
      const G = await league({ minutesFromNow: -1 });
      await q(`insert into gate_flags values ($1, 'renewal_replies_pending: every Season 1 player must answer before the draft can be set or started')`, [G]);
      const rg = await start(G, await expectFor(G));
      assertEquals([rg.status, rg.reason], ['blocked', 'renewal_replies_pending']);
      assertEquals(await status(G), 'not_started');
      const X = await league({ minutesFromNow: -1 });
      await q(`insert into gate_flags values ($1, 'draft_order_locked_mismatch: test')`, [X]);
      const ex = await expectFor(X);
      await refused(() => start(X, ex), 'draft_order_locked_mismatch', '22023');
      assertEquals(await status(X), 'not_started');
      await db.exec(`drop trigger trg_leagues_test_gate on leagues; drop function test_gate(); drop table gate_flags;`);
    });

    await t.step('server-only: no user session changes draft_status; same-value patches and the service role pass', async () => {
      const L = await league({ minutesFromNow: 60 * 5 });
      await as('commish', () => refused(() => q(`update leagues set draft_status='in_progress' where id=$1`, [L]), 'draft_status_server_only'));
      await as('commish', () => refused(() => q(`update leagues set draft_status='completed' where id=$1`, [L]), 'draft_status_server_only'));
      await as('commish', () => q(`update leagues set draft_status='not_started', name='renamed' where id=$1`, [L]));
      assertEquals((await q(`select name from leagues where id=$1`, [L]))[0].name, 'renamed');
      // [I2b]: a member's in_progress -> completed, and the commissioner's rewind.
      const P = await league({ minutesFromNow: -1 });
      await q(`update leagues set draft_status='in_progress' where id=$1`, [P]);   // owner, exempt
      await as('member', () => refused(() => q(`update leagues set draft_status='completed' where id=$1`, [P]), 'draft_status_server_only'));
      await as('service', () => q(`update leagues set draft_status='completed' where id=$1`, [P]));
      await as('commish', () => refused(() => q(`update leagues set draft_status='not_started' where id=$1`, [P]), 'draft_status_server_only'));
      assertEquals(await status(P), 'completed');
      // The rules freeze still works after the re-create.
      await as('commish', () => refused(() => q(`update leagues set num_rounds=9 where id=$1`, [P]), 'league_rules_locked'));
    });

    await t.step('server-only INSERT: a user session creates only not_started leagues', async () => {
      await as('commish', () => refused(() => q(`insert into leagues (name, commissioner_id, invite_code, num_participants, draft_status)
        values ('x', $1, $2, 8, 'in_progress')`, [COMMISH, crypto.randomUUID()]), 'draft_status_server_only'));
      await as('commish', () => q(`insert into leagues (name, commissioner_id, invite_code, num_participants)
        values ('ok', $1, $2, 8)`, [COMMISH, crypto.randomUUID()]));
      await as('service', () => q(`insert into leagues (name, commissioner_id, invite_code, num_participants, draft_status)
        values ('svc', $1, $2, 8, 'completed')`, [COMMISH, crypto.randomUUID()]));
    });

    await t.step('clients: authenticated / anon cannot call the start functions or read the blocks', async () => {
      for (const sql of [`select public.start_league_draft(gen_random_uuid(), '{}'::jsonb)`,
                         `select * from public.due_draft_starts()`,
                         `select public.note_draft_start_blocked(gen_random_uuid(), 'x', '[]'::jsonb)`,
                         `select * from public.draft_start_blocks`]) {
        await as('commish', () => refused(() => q(sql), 'permission denied'));
      }
    });

    await t.step('cron guard (latest draft_autopick_sweep schedule, sliced) posts for an overdue turn OR a due start', async () => {
      const { file, sql } = await latestSweepSchedule();
      const command = sql.slice(sql.indexOf('$$') + 2, sql.lastIndexOf('$$'));
      const m = command.match(/\n\s*(where exists \([\s\S]*?\n\s*\)\s*\n\s*or exists \(select 1 from public\.due_draft_starts\(\)\))\s*;/);
      assert(m, `${file}: could not slice the overdue OR due guard out of the cron command`);
      const post = async () => (await q(`select 1 as post ${m[1]}`)).length === 1;
      // Isolate: retire every fixture league from both lists.
      await q(`update leagues set draft_date = null where draft_status = 'not_started'`);
      await q(`update leagues set pick_clock_enabled = false where draft_status = 'in_progress'`);
      assertEquals(await post(), false, 'idle: no post');
      const L = await league({ minutesFromNow: -1 });
      assertEquals(await post(), true, 'a due start posts');
      await as('service', () => q(`select public.note_draft_start_blocked($1, 'x', '[]'::jsonb)`, [L]));
      assertEquals(await post(), false, 'a blocked start (< 60 s) does not post');
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
      const lines = msg.split('\n').filter((l) => /^[A-Z]\d /.test(l));
      assertEquals(lines.length, 20, msg);
      const bad = lines.filter((l) => !(l.endsWith('PASS') || (l.startsWith('C1') && l.endsWith('SKIP'))));
      assertEquals(bad, [], msg);
      const [{ n: after }] = await q(`select count(*)::int n from leagues`);
      assertEquals(after, before, 'the effect block must roll back');
    });

    await db.close();
  },
});
