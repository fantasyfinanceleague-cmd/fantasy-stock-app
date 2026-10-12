/**
 * Leaver gaps (20261120000000-01) against REAL Postgres (PGlite).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * After the season, leaving a league sets league_members.hidden_at and keeps the
 * row. Two places treated that row as a current member, or let one be born:
 *   1. transfer_commissioner (20261110000000) could hand the title to a leaver.
 *   2. league_members_insert_self (20261001000000) let the creator insert their
 *      own row already hidden.
 *
 * Boots the leave-league replica (supabase/tests/leave_league.pglite.test.ts's
 * schema and migration chain, verbatim) with ONE difference: league_members'
 * policies are the REAL chain (20260712000002 -> 20260811000005 ->
 * 20261001000000), not hand-declared stand-ins, so the insert cases test the
 * predicate prod runs. Independent of #205 (20261119*): nothing here reads the
 * frozen-name columns.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { assertReplicaDefaultMatchesProd } from './replica_defaults.ts';

const ROOT = new URL('../../', import.meta.url);
const mig = (name: string) => Deno.readTextFile(new URL(`supabase/migrations/${name}`, ROOT));

// league_members' RLS, as prod has it (the latest definition of each policy).
const POLICIES = [
  '20260712000002_rls_b1_02_league_members.sql',
  '20260811000005_league_members_select_visible_to_self.sql',
  '20261001000000_narrow_league_members_insert_self.sql',
];
// The same chain leave_league.pglite.test.ts loads (PRIOR, then OURS).
const PRIOR = [
  '20260925000000_leagues_member_draft_complete_column_guard.sql',
  '20261010000000_draft_pick_clock_and_queue.sql',
  '20261011000003_start_league_playoffs.sql',
  '20261011000004_playoff_bracket_unique_backstop.sql',
  '20261012000000_flexible_playoffs_schema.sql',
  '20261012000001_start_league_playoffs_flexible.sql',
  '20261012000002_freeze_playoff_teams_after_draft_start.sql',
  '20261012000003_backfill_league_end_date_playoff_weeks.sql',
  '20261013000000_draft_order_modes.sql',
  '20261004000000_participant_display_names.sql',
  '20261004000001_get_home_summary_rpc.sql',
  '20261011000000_league_standings_ranked.sql',
  '20261011000001_get_home_summary_unified_rank.sql',
  '20260930000000_join_league_refuse_mid_draft.sql',
  '20261104000000_freeze_league_rules_after_draft_start.sql',
  '20261107000000_leave_league_schema.sql',
  '20261107000001_leave_league_rpc.sql',
  '20261107000002_confirm_league_roster_rpc.sql',
  '20261107000003_get_home_summary_skip_hidden.sql',
  '20261107000004_drop_I5_league_members_delete_self.sql',
  '20261107000005_join_clears_invite_reconfirm.sql',
  '20261107000006_draft_waits_for_roster_reconfirm.sql',
  '20261110000000_transfer_commissioner.sql',
  '20261110000001_leave_league_transfer_first.sql',
  '20261110000002_notify_due_ignores_transfer_notice.sql',
];
const OURS = [
  '20261120000000_transfer_commissioner_refuses_hidden.sql',
  '20261120000001_league_members_insert_self_not_hidden.sql',
];
const EFFECT_TEST = new URL('docs/security/leaver-gaps-effect-test.sql', ROOT);

// leave_league.pglite.test.ts's replica, minus its three league_members policies
// (POLICIES above creates the real ones).
const SCHEMA = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                     nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table leagues (
  id uuid primary key default gen_random_uuid(), name text, commissioner_id text not null,
  draft_status text default 'not_started', num_rounds int not null default 6,
  invite_code text, num_participants int default 8, draft_date timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  league_start_date timestamptz, league_end_date timestamptz,
  -- PROD's default, 'duration' (20251230000000). The guard step (replica_defaults.ts) fails if
  -- this ever drifts from the latest migration's default again: on 2026-10-06 a
  -- 'matchup' default here hid an effect-test fixture that omitted league_type.
  league_type text not null default 'duration', num_weeks int, current_week int default 1,
  season_status text default 'active', playoff_teams int default 4,
  -- the rule columns #123's freeze trigger compares (20261104000000)
  stake_mode text, budget_amount numeric, notional_per_slot numeric, allow_undraftable boolean default false,
  duration_days int, budget_mode text,
  constraint valid_playoff_teams check (playoff_teams is null or playoff_teams in (2, 4, 8)));
create table matchups (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, week_number int not null,
  team1_user_id text, team2_user_id text, team1_gain numeric(12,2), team2_gain numeric(12,2),
  winner_user_id text, week_start timestamptz, week_end timestamptz, is_playoff boolean default false,
  playoff_round text, team1_seed int, team2_seed int, is_tie boolean default false,
  unique(league_id, week_number, team1_user_id), unique(league_id, week_number, team2_user_id),
  constraint valid_playoff_round check (playoff_round is null or playoff_round in ('quarter', 'semi', 'finals')));
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, role text not null default 'member',
  joined_at timestamptz not null default clock_timestamp(), primary key (league_id, user_id));
create table league_invites (id uuid primary key default gen_random_uuid(),
  league_id uuid references leagues(id) on delete cascade, code text, status text default 'pending',
  expires_at timestamptz, inviter_id text);
create table league_draft_slots (id uuid primary key default gen_random_uuid(),
  league_id uuid references leagues(id) on delete cascade, slot_index int, slot_count int default 1,
  price_min numeric, price_max numeric, category_id uuid);
create table drafts (id serial primary key, league_id uuid, user_id text, symbol text,
  entry_price numeric, quantity numeric, round int, pick_number int, created_at timestamptz default now());
create table trades (id uuid primary key default gen_random_uuid(), league_id uuid, user_id uuid, symbol text);
create table symbols (symbol text primary key, active boolean default true, is_draftable boolean not null default false,
  price_unsupported boolean not null default false, last_price numeric, market_cap numeric, gics_industry text);
create table categories (id uuid primary key default gen_random_uuid(), slug text unique not null);
create table category_rules (gics_industry text unique not null, category_id uuid not null references categories(id));
create table symbol_category_overrides (symbol text not null, category_id uuid not null references categories(id),
  unique (symbol, category_id));
create table league_standings (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, wins numeric(5,1) not null default 0, losses numeric(5,1) not null default 0,
  ties numeric(5,1) not null default 0, points_for numeric(12,2) not null default 0,
  points_against numeric(12,2) not null default 0, updated_at timestamptz not null default now(),
  primary key (league_id, user_id));
create table league_seasons (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, season_number int not null default 1,
  started_at timestamptz not null default now(), completed_at timestamptz,
  champion_user_id text, runner_up_user_id text, final_standings jsonb);
alter table leagues add column current_season_id uuid references league_seasons(id);
create table user_profiles (id uuid primary key, username text);
create function is_member(l uuid) returns boolean language sql stable security definer as
  $$ select exists (select 1 from league_members m where m.league_id = l and m.user_id = auth.uid()::text) $$;
alter table leagues enable row level security;
alter table league_members enable row level security;
alter table matchups enable row level security;
alter table league_standings enable row level security;
create policy leagues_select on leagues for select using (is_member(id) or commissioner_id = auth.uid()::text);
create policy leagues_update_commissioner on leagues for update to authenticated
  using (commissioner_id = auth.uid()::text) with check (commissioner_id = auth.uid()::text);
create policy matchups_select_members on matchups for select to authenticated using (is_member(league_id));
create policy league_standings_select_members on league_standings for select to authenticated using (is_member(league_id));
`;

const C = '00000000-0000-4000-8000-00000000000c'; // commissioner
const A = '00000000-0000-4000-8000-00000000000a'; // leaves after the season
const B = '00000000-0000-4000-8000-00000000000b'; // stays

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'leaver gaps on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    await db.exec(SCHEMA);
    for (const f of [...POLICIES, ...PRIOR]) await db.exec(await mig(f));

    const asRole = async (role: 'authenticated' | 'service_role' | 'anon' | null, uid: string | null = null) => {
      await db.exec(`reset role`);
      await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
      if (role) await db.exec(`set role ${role}`);
    };
    const raw = async (s: string, p: unknown[] = []) => {
      await db.exec(`set session_replication_role = replica`);
      try { return await q(s, p); } finally { await db.exec(`set session_replication_role = origin`); }
    };
    const step = (name: string, fn: () => Promise<void>) =>
      t.step(name, async () => {
        await asRole(null);
        try { await fn(); } finally { await asRole(null); }
      });
    const svc = async (sql: string, p: unknown[]) => {
      await asRole('service_role');
      try { return (await q(sql, p))[0].r; } finally { await asRole(null); }
    };
    const leave = (id: string, uid: string) => svc(`select leave_league($1, $2) r`, [id, uid]);
    const unhide = (id: string, uid: string) => svc(`select unhide_league($1, $2) r`, [id, uid]);
    const transfer = (id: string, uid: string, to: string | null) =>
      svc(`select transfer_commissioner($1, $2, $3) r`, [id, uid, to]);
    const fnState = async (name: string) =>
      (await q(`select proacl::text acl, prosecdef, proconfig::text cfg from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and proname=$1`, [name]))[0];
    const membersState = async (id: string) => JSON.stringify({
      m: await q(`select user_id, role, hidden_at from league_members where league_id=$1 order by user_id`, [id]),
      l: await q(`select commissioner_id from leagues where id=$1`, [id]),
      n: await q(`select user_id, kind from league_notifications where league_id=$1 order by created_at`, [id]),
    });
    async function mkLeague(ids: string[]) {
      // league_type is EXPLICIT: the column default is 'duration' (as in prod).
      const [l] = await q(
        `insert into leagues (name, commissioner_id, league_type, draft_date) values ('Test League', $1, 'matchup', now() + interval '48 hours') returning *`,
        [ids[0]],
      );
      for (const m of ids) {
        await q(`insert into league_members (league_id, user_id, role) values ($1,$2,$3)`,
          [l.id, m, m === ids[0] ? 'commissioner' : 'member']);
      }
      return l;
    }
    async function finishedLeague(ids: string[]) {
      const l = await mkLeague(ids);
      await raw(`update leagues set draft_status='completed', draft_started_at=now(), season_status='completed' where id=$1`, [l.id]);
      return l;
    }
    // c's own session inserting into league_members, as the create-league clients do.
    const selfInsert = async (uid: string, cols: Record<string, unknown>) => {
      await asRole('authenticated', uid);
      const keys = Object.keys(cols);
      try {
        await q(`insert into league_members (${keys.join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
          Object.values(cols));
        return 'ok';
      } catch (e) {
        return (e as { code?: string }).code ?? 'err';
      } finally { await asRole(null); }
    };

    // The pre-fix baseline: both gaps are real on the latest applied definitions.
    await step('BEFORE 20261120: a leaver can be made commissioner, and a creator can self-insert hidden', async () => {
      const l = await finishedLeague([C, A, B]);
      assertEquals((await leave(l.id, A)).status, 'hidden');
      assertEquals((await transfer(l.id, C, A)).status, 'transferred', 'the finding: the leaver got the title');
      const [n] = await q(`insert into leagues (name, commissioner_id, league_type) values ('New', $1, 'matchup') returning id`, [C]);
      assertEquals(await selfInsert(C, { league_id: n.id, user_id: C, role: 'commissioner', hidden_at: new Date().toISOString() }),
        'ok', 'the finding: a row born hidden');
    });

    for (const f of OURS) await db.exec(await mig(f));

    await step('replica guard: leagues.league_type default equals the latest migration default (prod)', async () => {
      await assertReplicaDefaultMatchesProd(q, 'leagues', 'league_type');
    });

    await step('transfer_commissioner: grants unchanged (service_role only), definer, search_path pinned', async () => {
      const s = await fnState('transfer_commissioner');
      assertEquals(s.acl, '{postgres=X/postgres,service_role=X/postgres}');
      assertEquals(s.prosecdef, true);
      assert(String(s.cfg).includes('search_path=public, pg_temp'), s.cfg);
      const [p] = await q(`select
          has_function_privilege('anon', 'public.transfer_commissioner(uuid,text,text)', 'EXECUTE') anon,
          has_function_privilege('authenticated', 'public.transfer_commissioner(uuid,text,text)', 'EXECUTE') auth,
          has_function_privilege('service_role', 'public.transfer_commissioner(uuid,text,text)', 'EXECUTE') svc`);
      assertEquals([p.anon, p.auth, p.svc], [false, false, true]);
    });

    await step('transfer to a member who LEFT (hidden): target_invalid, nothing written', async () => {
      const l = await finishedLeague([C, A, B]);
      assertEquals((await leave(l.id, A)).status, 'hidden');
      const before = await membersState(l.id);
      const r = await transfer(l.id, C, A);
      assertEquals(r, { status: 'refused', reason: 'target_invalid' }, 'the same answer as a bot or an outsider');
      assertEquals(await membersState(l.id), before, 'a refused transfer writes nothing');
    });

    await step('transfer to a CURRENT member still works, after the season and before the draft', async () => {
      const l = await finishedLeague([C, A, B]);
      await leave(l.id, A);
      const r = await transfer(l.id, C, B);
      assertEquals([r.status, r.window, r.notify_user_id], ['transferred', 'after_season', B]);
      assertEquals((await q(`select commissioner_id from leagues where id=$1`, [l.id]))[0].commissioner_id, B);
      assertEquals((await q(`select role from league_members where league_id=$1 and user_id=$2`, [l.id, B]))[0].role, 'commissioner');

      const pre = await mkLeague([C, A, B]);
      const r2 = await transfer(pre.id, C, A);
      assertEquals([r2.status, r2.window], ['transferred', 'before_draft']);
    });

    await step('a leaver who un-hides is a current member again, and can take the title', async () => {
      const l = await finishedLeague([C, A, B]);
      await leave(l.id, A);
      assertEquals((await transfer(l.id, C, A)).reason, 'target_invalid');
      assertEquals((await unhide(l.id, A)).status, 'shown');
      assertEquals((await transfer(l.id, C, A)).status, 'transferred');
    });

    await step('the other refusals are unchanged (bot, outsider, self, null, non-commissioner)', async () => {
      const l = await finishedLeague([C, A, B]);
      for (const to of ['bot-1', '00000000-0000-4000-8000-0000000000ff', C, null]) {
        assertEquals((await transfer(l.id, C, to)).reason, 'target_invalid', String(to));
      }
      assertEquals((await transfer(l.id, A, B)).reason, 'not_commissioner');
    });

    await step('insert_self: the creator self-inserting with hidden_at set is refused (42501), nothing written', async () => {
      const [n] = await q(`insert into leagues (name, commissioner_id, league_type) values ('New', $1, 'matchup') returning id`, [C]);
      const code = await selfInsert(C, { league_id: n.id, user_id: C, role: 'commissioner', hidden_at: new Date().toISOString() });
      assertEquals(code, '42501');
      assertEquals(await q(`select user_id from league_members where league_id=$1`, [n.id]), []);
    });

    await step('insert_self: the normal create-league self-insert still works (and the rest of the predicate still binds)', async () => {
      const [n] = await q(`insert into leagues (name, commissioner_id, league_type) values ('New', $1, 'matchup') returning id`, [C]);
      assertEquals(await selfInsert(C, { league_id: n.id, user_id: C, role: 'commissioner' }), 'ok');
      assertEquals((await q(`select hidden_at from league_members where league_id=$1 and user_id=$2`, [n.id, C]))[0].hidden_at, null);
      // An explicit NULL is the same row the clients send.
      const [n2] = await q(`insert into leagues (name, commissioner_id, league_type) values ('New', $1, 'matchup') returning id`, [C]);
      assertEquals(await selfInsert(C, { league_id: n2.id, user_id: C, role: 'commissioner', hidden_at: null }), 'ok');
      // Superset: 20261001000000's three conditions still refuse on their own.
      const [n3] = await q(`insert into leagues (name, commissioner_id, league_type) values ('New', $1, 'matchup') returning id`, [C]);
      assertEquals(await selfInsert(A, { league_id: n3.id, user_id: A, role: 'commissioner' }), '42501', 'not the commissioner');
      assertEquals(await selfInsert(C, { league_id: n3.id, user_id: C, role: 'member' }), '42501', "role 'member'");
      await raw(`update leagues set draft_status='in_progress', draft_started_at=now() where id=$1`, [n3.id]);
      assertEquals(await selfInsert(C, { league_id: n3.id, user_id: C, role: 'commissioner' }), '42501', 'draft started');
    });

    await step('insert_self policy: one policy, authenticated INSERT, WITH CHECK carries hidden_at IS NULL', async () => {
      const ps = await q(`select roles::text r, cmd, with_check w from pg_policies
        where tablename='league_members' and policyname='league_members_insert_self'`);
      assertEquals(ps.length, 1);
      assertEquals([ps[0].r, ps[0].cmd], ['{authenticated}', 'INSERT']);
      assert(/hidden_at IS NULL/.test(ps[0].w), ps[0].w);
    });

    await step('effect test (the SQL-editor script) passes and rolls back', async () => {
      const before = (await q(`select count(*)::int n from leagues`))[0].n;
      const err = await assertRejects(async () => { await db.exec(await Deno.readTextFile(EFFECT_TEST)); });
      const msg = String((err as Error).message);
      assert(msg.includes('LEAVER GAPS EFFECT TEST RESULTS'), msg);
      assert(!msg.includes('FAIL'), msg);
      assertEquals(msg.match(/PASS/g)?.length, 6, msg); // G1 G2 T1 T2 P1 P2; I1 is INFO
      assert(/I1 .*INFO/.test(msg), msg);
      assertEquals((await q(`select count(*)::int n from leagues`))[0].n, before, 'fixture rolled back');
    });

    await db.close();
  },
});
