/**
 * Leave league (20261107000000-04) against REAL Postgres (PGlite).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * Loads the five migrations VERBATIM on top of the real objects they meet in
 * prod, also verbatim: PR #9's leagues column guard, the pick clock, flexible
 * playoffs, the draft-order chain (whose member trigger closes the order gap
 * on a leave), the display-name + Home RPCs and the ranking they read, and
 * join_league_by_code (rejoin). Supabase's default anon/authenticated/
 * service_role grants are simulated, so the proacl assertions prove the
 * explicit revokes work. Run it back (PR #94, unmerged) is exercised on a
 * second database from a verbatim fixture of its membership triggers.
 *
 * Every q() is its own transaction, so now() is fresh per statement; the leave
 * window is tested with draft_date relative to now().
 *
 * NOT covered (PGlite has one connection): two truly concurrent transactions.
 * The serialization rests on every path locking the leagues row first.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const mig = (name: string) => Deno.readTextFile(new URL(`supabase/migrations/${name}`, ROOT));

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
];
const OURS = [
  '20261107000000_leave_league_schema.sql',
  '20261107000001_leave_league_rpc.sql',
  '20261107000002_confirm_league_roster_rpc.sql',
  '20261107000003_get_home_summary_skip_hidden.sql',
  '20261107000004_drop_I5_league_members_delete_self.sql',
  '20261107000005_join_clears_invite_reconfirm.sql',
  '20261107000006_draft_waits_for_roster_reconfirm.sql',
];
const EFFECT_TEST = new URL('docs/security/leave-league-effect-test.sql', ROOT);
const RIB_FIXTURE = new URL('supabase/tests/fixtures/run_it_back_398da84_membership.sql', ROOT);

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
  league_type text not null default 'matchup', num_weeks int, current_week int default 1,
  season_status text default 'active', playoff_teams int default 4,
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
create policy lm_select on league_members for select using (is_member(league_id) or user_id = auth.uid()::text);
create policy lm_insert_bot on league_members for insert to authenticated with check (user_id like 'bot-%' and is_member(league_id));
-- [I5], VERBATIM name from 20260712000002 -- 20261107000004 must drop it.
create policy "league_members_delete_self" on league_members for delete to authenticated using (user_id = auth.uid()::text);
create policy matchups_select_members on matchups for select to authenticated using (is_member(league_id));
create policy league_standings_select_members on league_standings for select to authenticated using (is_member(league_id));
`;

const C = '00000000-0000-4000-8000-00000000000c'; // commissioner
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const D = '00000000-0000-4000-8000-00000000000d';
const E = '00000000-0000-4000-8000-00000000000e';
const X = '00000000-0000-4000-8000-0000000000ff'; // outsider

// deno-lint-ignore no-explicit-any
type Row = any;

async function boot(withRunItBack: boolean) {
  const db = new PGlite();
  const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
  await db.exec(SCHEMA);
  for (const f of PRIOR) await db.exec(await mig(f));
  if (withRunItBack) await db.exec(await Deno.readTextFile(RIB_FIXTURE));
  return { db, q };
}

Deno.test({
  name: 'leave league on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const { db, q } = await boot(false);
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

    const fnState = async (name: string) =>
      (await q(`select proacl::text acl, prosecdef, proconfig::text cfg from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and proname=$1`, [name]))[0];
    const homeBefore = await fnState('get_home_summary');

    // A pre-existing pending notice, so the CHECK rewrite is proven to keep old kinds valid.
    const [old] = await q(`insert into leagues (name, commissioner_id) values ('old', $1) returning id`, [C]);
    await q(`insert into league_notifications (league_id, user_id, kind) values ($1, $2, 'draft_order_set')`, [old.id, C]);

    for (const f of OURS) await db.exec(await mig(f));

    const inHours = async (h: number) => (await q(`select now() + make_interval(secs => $1::float8 * 3600) t`, [h]))[0].t;
    const members = async (id: string) =>
      (await q(`select user_id from league_members where league_id=$1 order by user_id`, [id])).map((r: Row) => r.user_id);
    const order = async (id: string) =>
      (await q(`select user_id from league_draft_order where league_id=$1 order by position`, [id])).map((r: Row) => r.user_id);
    const positions = async (id: string) =>
      (await q(`select position from league_draft_order where league_id=$1 order by position`, [id])).map((r: Row) => r.position);
    const meta = async (id: string) => (await q(`select * from league_draft_order_meta where league_id=$1`, [id]))[0];
    const lg = async (id: string) => (await q(`select * from leagues where id=$1`, [id]))[0];
    const reconfirm = async (id: string) => (await q(`select * from league_roster_reconfirm where league_id=$1`, [id]))[0];
    const ids = (rc: Row) => rc.departed.map((e: Row) => e.user_id);
    const leftNotices = async (id: string) =>
      (await q(`select user_id from league_notifications where league_id=$1 and kind='member_left' order by created_at`, [id]))
        .map((r: Row) => r.user_id);
    const snapshot = async (id: string) => JSON.stringify({
      m: await q(`select user_id, role, hidden_at from league_members where league_id=$1 order by user_id`, [id]),
      o: await order(id),
      l: await q(`select commissioner_id, playoff_teams, draft_status from leagues where id=$1`, [id]),
      r: await q(`select departed, members_before from league_roster_reconfirm where league_id=$1`, [id]),
      n: await q(`select user_id, kind from league_notifications where league_id=$1 order by created_at`, [id]),
    });
    // The edge function's call: service role, verified user id.
    const leave = async (id: string, uid: string, successor: string | null = null) => {
      await asRole('service_role');
      try { return (await q(`select leave_league($1, $2, $3) r`, [id, uid, successor]))[0].r; } finally { await asRole(null); }
    };
    const unhide = async (id: string, uid: string) => {
      await asRole('service_role');
      try { return (await q(`select unhide_league($1, $2) r`, [id, uid]))[0].r; } finally { await asRole(null); }
    };
    const confirm = async (id: string, uid: string, p: number | null = null, choice = 'move_forward') => {
      await asRole('service_role');
      try { return (await q(`select confirm_league_roster($1, $2, $3, $4) r`, [id, uid, choice, p]))[0].r; } finally { await asRole(null); }
    };
    const invite = (id: string, uid: string) => confirm(id, uid, null, 'invite');
    const join = async (code: string, uid: string) => {
      await asRole('service_role');
      try { return (await q(`select join_league_by_code($1, $2) r`, [code, uid]))[0].r; } finally { await asRole(null); }
    };
    const notifyDue = async () => (await q(`select draft_order_notify_due() d`))[0].d;
    async function mkLeague(ids: string[], extra: Record<string, unknown> = {}) {
      const row: Record<string, unknown> = { name: 'Test League', commissioner_id: ids[0], ...extra };
      const cols = Object.keys(row);
      const [l] = await q(
        `insert into leagues (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`,
        Object.values(row),
      );
      for (const m of ids) {
        await q(`insert into league_members (league_id, user_id, role) values ($1,$2,$3)`,
          [l.id, m, m === ids[0] ? 'commissioner' : 'member']);
      }
      return l;
    }
    const getOrder = async (uid: string, id: string) => {
      await asRole('authenticated', uid);
      try { return (await q(`select get_draft_order($1) r`, [id]))[0].r; } finally { await asRole(null); }
    };

    await step('grants: service_role only on all three RPCs; search_path pinned; table grants exact', async () => {
      for (const f of ['leave_league', 'unhide_league', 'confirm_league_roster']) {
        const s = await fnState(f);
        assertEquals(s.acl, '{postgres=X/postgres,service_role=X/postgres}', f);
        assertEquals(s.prosecdef, true, f);
        assert(String(s.cfg).includes('search_path=public, pg_temp'), `${f}: ${s.cfg}`);
      }
      for (const role of ['anon', 'authenticated']) {
        await asRole(role as 'anon' | 'authenticated', role === 'authenticated' ? A : null);
        for (const call of [
          `select leave_league(gen_random_uuid(), 'x')`,
          `select unhide_league(gen_random_uuid(), 'x')`,
          `select confirm_league_roster(gen_random_uuid(), 'x', 'invite')`,
        ]) {
          let code = '';
          try { await q(call); } catch (e) { code = (e as { code?: string }).code ?? 'err'; }
          assertEquals(code, '42501', `${role}: ${call}`);
        }
        await asRole(null);
      }
      const [r] = await q(`select relacl::text a, relrowsecurity rls from pg_class where relname='league_roster_reconfirm'`);
      assertEquals(r.rls, true);
      // The owner's own bits differ by version (PG17 adds MAINTAIN 'm'); the API roles are what matter.
      assert(/^\{postgres=[a-zA-Z]+\/postgres,authenticated=r\/postgres,service_role=r\/postgres\}$/.test(r.a), r.a);
    });

    await step('[I5] is gone: no DELETE policy, a client DELETE removes nothing', async () => {
      assertEquals(await q(`select policyname from pg_policies where tablename='league_members' and cmd='DELETE'`), []);
      const l = await mkLeague([C, A, B], { draft_date: await inHours(48) });
      await asRole('authenticated', A);
      await q(`delete from league_members where league_id=$1 and user_id=$2`, [l.id, A]);
      await asRole(null);
      assertEquals(await members(l.id), [A, B, C].sort());
    });

    await step('Home: get_home_summary ACL / definer / search_path byte-identical', async () => {
      assertEquals(await fnState('get_home_summary'), homeBefore);
    });

    await step('the CHECK rewrite keeps old kinds and adds member_left', async () => {
      assertEquals((await q(`select count(*)::int n from league_notifications where league_id=$1`, [old.id]))[0].n, 1);
      let code = '';
      try { await q(`insert into league_notifications (league_id, user_id, kind) values ($1,$2,'nope')`, [old.id, C]); } catch (e) {
        code = (e as { code?: string }).code ?? '';
      }
      assertEquals(code, '23514');
    });

    await step('pre-draft leave, random mode before the reveal: row gone, reconfirm owed, commissioner notified', async () => {
      await q(`insert into user_profiles (id, username) values ($1, 'Alice') on conflict do nothing`, [A]);
      const l = await mkLeague([C, A, B, D, 'bot-1'], { draft_date: await inHours(48) });
      assertEquals(await meta(l.id), undefined, 'precondition: no order yet');
      const r = await leave(l.id, A);
      assertEquals([r.status, r.reconfirm_required, r.made_commissioner, r.members_before, r.members_after],
        ['left', true, false, 5, 4]);
      assertEquals([r.notify_user_id, r.league_name], [C, 'Test League']);
      assert(typeof r.notice_id === 'string');
      assertEquals(await members(l.id), [B, C, D, 'bot-1'].sort());
      const rc = await reconfirm(l.id);
      assertEquals([ids(rc), rc.members_before], [[A], 5]);
      assertEquals([rc.departed[0].name, r.leaver_name], ['Alice', 'Alice'], 'name snapshotted at the leave');
      assert(typeof rc.departed[0].left_at === 'string');
      assertEquals(await leftNotices(l.id), [C]);
      const [n] = await q(`select push_status from league_notifications where id=$1`, [r.notice_id]);
      assertEquals(n.push_status, 'pending');
    });

    await step('a second leave appends and keeps members_before; a rejoin-then-leave does not duplicate', async () => {
      const l = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48), invite_code: 'RJN01' });
      await leave(l.id, A);
      await leave(l.id, B);
      let rc = await reconfirm(l.id);
      assertEquals([ids(rc), rc.members_before], [[A, B], 5]);
      // Rejoin with the invite code (the row is gone, the draft has not started).
      await asRole('service_role');
      const j = (await q(`select join_league_by_code('RJN01', $1) r`, [A]))[0].r;
      await asRole(null);
      assertEquals(j.ok, true);
      assertEquals(ids(await reconfirm(l.id)), [A, B], 'a join never clears it');
      await leave(l.id, A);
      rc = await reconfirm(l.id);
      assertEquals([ids(rc), rc.members_before], [[A, B], 5]);
      assertEquals(await leftNotices(l.id), [C, C], 'the repeat leave sends no second notice (loop spam)');
    });

    await step('manual order (open): the trigger closes the gap', async () => {
      const l = await mkLeague([C, A, B, D], { draft_order_mode: 'manual', draft_date: await inHours(48) });
      await getOrder(C, l.id); // seeds the open order
      assertEquals((await meta(l.id)).state, 'open');
      const before = await order(l.id);
      await leave(l.id, B);
      assertEquals(await order(l.id), before.filter((u: string) => u !== B));
      assertEquals(await positions(l.id), [1, 2, 3]);
    });

    await step('locked in: inside the hour (time, before the cron flips state)', async () => {
      const l = await mkLeague([C, A, B, D], { draft_order_mode: 'manual', draft_date: await inHours(48) });
      await getOrder(C, l.id);
      await raw(`update leagues set draft_date = now() + interval '30 minutes' where id=$1`, [l.id]);
      assertEquals((await meta(l.id)).state, 'open', 'precondition: state not flipped yet');
      const before = await snapshot(l.id);
      const r = await leave(l.id, A);
      assertEquals([r.status, r.reason, r.window], ['refused', 'locked_in', 'order_set']);
      assertEquals(await snapshot(l.id), before, 'a refusal writes nothing');
    });

    await step('locked in: finalized, then draft_date moved LATER (state, not time)', async () => {
      const l = await mkLeague([C, A, B, D], { draft_order_mode: 'manual', draft_date: await inHours(48) });
      await getOrder(C, l.id);
      await raw(`update leagues set draft_date = now() + interval '30 minutes' where id=$1`, [l.id]);
      await asRole('authenticated', C);
      await q(`update leagues set draft_date = now() + interval '3 days' where id=$1`, [l.id]);
      await asRole(null);
      assertEquals((await meta(l.id)).state, 'finalized', 'precondition: finalized, date now far away');
      const r = await leave(l.id, A);
      assertEquals([r.status, r.reason, r.window], ['refused', 'locked_in', 'order_set']);
      assertEquals(await members(l.id), [A, B, C, D].sort());
    });

    await step('locked in: draft in progress, and mid-season', async () => {
      for (const ds of ['in_progress', 'completed']) {
        const l = await mkLeague([C, A, B, D], { draft_date: await inHours(48) });
        await raw(`update leagues set draft_status=$2, draft_started_at=now() where id=$1`, [l.id, ds]);
        const before = await snapshot(l.id);
        const r = await leave(l.id, A);
        assertEquals([r.status, r.reason, r.window], ['refused', 'locked_in', 'season'], ds);
        assertEquals(await snapshot(l.id), before);
      }
    });

    await step('TBD draft date: leaving is allowed', async () => {
      const l = await mkLeague([C, A, B, D]);
      assertEquals((await leave(l.id, D)).status, 'left');
    });

    await step('commissioner: successor required / invalid / sole manager; refusals write nothing', async () => {
      const l = await mkLeague([C, A, B, 'bot-1'], { draft_date: await inHours(48) });
      const before = await snapshot(l.id);
      assertEquals((await leave(l.id, C)).reason, 'successor_required');
      assertEquals((await leave(l.id, C, 'bot-1')).reason, 'successor_invalid');
      assertEquals((await leave(l.id, C, X)).reason, 'successor_invalid');
      assertEquals((await leave(l.id, C, C)).reason, 'successor_invalid');
      assertEquals((await leave(l.id, A, B)).reason, 'successor_not_allowed');
      assertEquals(await snapshot(l.id), before);

      const solo = await mkLeague([C, 'bot-1', 'bot-2', 'bot-3'], { draft_date: await inHours(48) });
      assertEquals((await leave(solo.id, C)).reason, 'sole_manager');
      assertEquals((await leave(solo.id, C, 'bot-1')).reason, 'sole_manager');
    });

    await step('commissioner hands over in one transaction; the NEW commissioner is notified and confirms', async () => {
      const l = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48) });
      const r = await leave(l.id, C, B);
      assertEquals([r.status, r.made_commissioner, r.notify_user_id, r.reconfirm_required], ['left', true, B, true]);
      assertEquals((await lg(l.id)).commissioner_id, B);
      assertEquals(
        await q(`select user_id, role from league_members where league_id=$1 order by user_id`, [l.id]),
        [{ user_id: A, role: 'member' }, { user_id: B, role: 'commissioner' }, { user_id: D, role: 'member' }, { user_id: E, role: 'member' }],
      );
      assertEquals(await leftNotices(l.id), [B]);
      assertEquals((await confirm(l.id, C)).reason, 'not_commissioner', 'the old commissioner cannot confirm');
      assertEquals((await confirm(l.id, B)).status, 'confirmed');
    });

    await step('not a member / unknown league / a bot id: uniform not_member', async () => {
      const l = await mkLeague([C, A, B, 'bot-1'], { draft_date: await inHours(48) });
      assertEquals((await leave(l.id, X)).reason, 'not_member');
      assertEquals((await leave(l.id, 'bot-1')).reason, 'not_member');
      const [u] = await q(`select gen_random_uuid() id`);
      assertEquals((await leave(u.id, A)).reason, 'not_member');
    });

    await step('confirm: P above members refused, P written in the same call, nothing_to_confirm, idempotent', async () => {
      const l = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48), playoff_teams: 4 });
      await leave(l.id, A);
      await leave(l.id, B); // 3 members, P = 4
      const before = await snapshot(l.id);
      const r1 = await confirm(l.id, C);
      assertEquals([r1.status, r1.reason, r1.playoff_teams, r1.members], ['refused', 'playoff_teams_exceeds_members', 4, 3]);
      assertEquals((await confirm(l.id, C, 4)).reason, 'invalid_playoff_teams');
      assertEquals((await confirm(l.id, C, 1)).reason, 'invalid_playoff_teams');
      assertEquals((await confirm(l.id, D)).reason, 'not_commissioner');
      assertEquals(await snapshot(l.id), before, 'refusals write nothing');
      const r2 = await confirm(l.id, C, 3);
      assertEquals([r2.status, r2.playoff_teams, r2.members], ['confirmed', 3, 3]);
      assertEquals((await lg(l.id)).playoff_teams, 3);
      assertEquals(await reconfirm(l.id), undefined);
      assertEquals([(await confirm(l.id, C)).status, (await confirm(l.id, C)).reason], ['unchanged', 'nothing_to_confirm']);
    });

    await step('confirm: P already fits -> no P needed; duration league ignores P; refused after the draft', async () => {
      const l = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48), playoff_teams: 2 });
      await leave(l.id, E);
      assertEquals((await confirm(l.id, C)).status, 'confirmed');
      assertEquals((await lg(l.id)).playoff_teams, 2);

      const dur = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48), league_type: 'duration', playoff_teams: null });
      await leave(dur.id, E);
      assertEquals((await confirm(dur.id, C, 2)).reason, 'playoff_teams_not_applicable');
      assertEquals((await confirm(dur.id, C)).status, 'confirmed');

      const st = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48) });
      await leave(st.id, E);
      await raw(`update leagues set draft_status='in_progress', draft_started_at=now() where id=$1`, [st.id]);
      assertEquals((await confirm(st.id, C)).reason, 'draft_started');
    });

    await step('invite: the commissioner chooses; a HUMAN join clears it; a bot never does', async () => {
      const l = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48), invite_code: 'INV01', playoff_teams: 4 });
      await leave(l.id, A); // 4 members, P = 4
      assertEquals((await invite(l.id, D)).reason, 'not_commissioner');
      assertEquals((await confirm(l.id, C, 3, 'invite')).reason, 'playoff_teams_not_applicable');
      const r = await invite(l.id, C);
      assertEquals([r.status, r.already], ['inviting', false]);
      const rc = await reconfirm(l.id);
      assertEquals([rc.choice, rc.chosen_by, rc.chosen_at !== null], ['invite', C, true]);
      assertEquals((await invite(l.id, C)).already, true);
      // A bot through the service role (draft-control add_bots) does NOT clear it.
      await asRole('service_role');
      await q(`insert into league_members (league_id, user_id) values ($1, 'bot-1')`, [l.id]);
      await asRole(null);
      assertEquals((await reconfirm(l.id)).choice, 'invite', 'add_bots never clears');
      await q(`delete from league_members where league_id=$1 and user_id='bot-1'`, [l.id]);
      // A human join through join_league_by_code clears it.
      assertEquals((await join('INV01', X)).ok, true);
      assertEquals(await reconfirm(l.id), undefined, 'cleared on its own');
    });

    await step('invite: a join never clears a PENDING row, or one whose P would still exceed members', async () => {
      const l = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48), invite_code: 'INV02', playoff_teams: 4 });
      await leave(l.id, A);
      await leave(l.id, B); // 3 members, P = 4
      assertEquals((await join('INV02', X)).ok, true); // 4 members, still 'pending'
      assertEquals((await reconfirm(l.id)).choice, 'pending', 'a join is not a choice');
      await leave(l.id, X); // 3 members
      await invite(l.id, C);
      assertEquals((await join('INV02', X)).ok, true); // 4 members: P = 4 fits -> clears
      assertEquals(await reconfirm(l.id), undefined);

      const m = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48), invite_code: 'INV03', playoff_teams: 4 });
      await leave(m.id, A);
      await leave(m.id, B);
      await leave(m.id, D); // 2 members, P = 4
      await invite(m.id, C);
      assertEquals((await join('INV03', X)).ok, true); // 3 < P = 4: keeps waiting
      assertEquals((await reconfirm(m.id)).choice, 'invite');
      assertEquals((await confirm(m.id, C, 3)).status, 'confirmed', 'switch to Move forward any time, lowering P');
    });

    await step('a NEW departure re-opens the choice; the commissioner must choose again', async () => {
      const l = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48), playoff_teams: 2 });
      await leave(l.id, A);
      await invite(l.id, C);
      await leave(l.id, B);
      const rc = await reconfirm(l.id);
      assertEquals([rc.choice, rc.chosen_by, rc.chosen_at, ids(rc)], ['pending', null, null, [A, B]]);
      assertEquals(await leftNotices(l.id), [C, C]);
    });

    await step('a second hand-over still notifies the NEW commissioner (dedupe is not keyed on the leaver there)', async () => {
      const l = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48), invite_code: 'HND01', playoff_teams: 2 });
      await leave(l.id, C, A);                     // departed [C], commissioner A
      assertEquals((await join('HND01', C)).ok, true);
      await leave(l.id, A, B);                     // A hands over to B
      await leave(l.id, C);                        // C leaves again: a plain repeat, no notice
      assertEquals(await leftNotices(l.id), [A, B], 'B was told; the repeat was not');
    });

    await step('the order WAITS past T-1h while a reconfirmation is owed, and is set the moment it clears', async () => {
      const l = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48), playoff_teams: 2 });
      await leave(l.id, E);
      await raw(`update leagues set draft_date = now() + interval '30 minutes' where id=$1`, [l.id]); // T-1h passes
      const r = await getOrder(A, l.id); // a lazy read would normally finalize here
      assertEquals([r.finalized, r.revealed], [false, false], 'not set: the teams are not confirmed');
      assertEquals(await meta(l.id), undefined);
      await asRole('service_role');
      const n = (await q(`select finalize_due_draft_orders() n`))[0].n;
      await asRole(null);
      assertEquals(await meta(l.id), undefined, `the cron's finalize skips it (finalized ${n} others)`);
      assertEquals((await leave(l.id, D)).reason, 'locked_in', 'leaving is still closed at T-1h, by time');
      assertEquals((await confirm(l.id, C)).status, 'confirmed');
      assertEquals((await meta(l.id)).state, 'finalized', 'set as soon as the teams are confirmed');
      assertEquals(
        (await q(`select user_id from league_notifications where league_id=$1 and kind='draft_order_set' order by user_id`, [l.id]))
          .map((x: Row) => x.user_id),
        [A, B, C, D].sort(),
        'everyone gets the "order is set" notice',
      );
    });

    await step('an invite cleared by a join past T-1h sets the order too', async () => {
      const l = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48), invite_code: 'INV04', playoff_teams: 2 });
      await leave(l.id, E);
      await invite(l.id, C);
      await raw(`update leagues set draft_date = now() + interval '30 minutes' where id=$1`, [l.id]);
      assertEquals((await join('INV04', X)).ok, true, 'joining after T-1h is still a normal join');
      assertEquals((await meta(l.id)).state, 'finalized');
      assert((await order(l.id)).includes(X));
    });

    await step('the start gate binds every role while a reconfirmation is owed', async () => {
      const l = await mkLeague([C, A, B, D, E], { draft_date: await inHours(48), playoff_teams: 2 });
      await leave(l.id, E);
      for (const who of ['commissioner', 'service_role']) {
        if (who === 'commissioner') await asRole('authenticated', C);
        else await asRole('service_role');
        let msg = '';
        try {
          await q(`update leagues set draft_status='in_progress', draft_started_at=now() where id=$1`, [l.id]);
        } catch (e) { msg = String((e as Error).message); }
        await asRole(null);
        assert(msg.startsWith('roster_reconfirm_required'), `${who}: ${msg}`);
      }
      assertEquals((await lg(l.id)).draft_status, 'not_started');
      await confirm(l.id, C);
      await asRole('service_role');
      await q(`update leagues set draft_status='in_progress', draft_started_at=now() where id=$1`, [l.id]);
      await asRole(null);
      assertEquals((await lg(l.id)).draft_status, 'in_progress', 'confirmed: the start goes through');
    });

    await step('member_left is never the cron\'s: a stranded one does not keep draft_order_notify_due true', async () => {
      await raw(`update league_notifications set push_status='sent' where push_status in ('pending','sending')`);
      // Any league still due + open with no reconfirm would make the predicate true: finalize them first.
      await asRole('service_role');
      await q(`select finalize_due_draft_orders()`);
      await asRole(null);
      await raw(`update league_notifications set push_status='sent' where push_status in ('pending','sending')`);
      assertEquals(await notifyDue(), false, 'precondition: nothing to do');
      await q(`insert into league_notifications (league_id, user_id, kind) values ($1,$2,'member_left')`, [old.id, C]);
      await q(`insert into league_notifications (league_id, user_id, kind, push_status, push_attempted_at)
               values ($1,$2,'member_left','sending', now() - interval '1 hour')`, [old.id, A]);
      assertEquals(await notifyDue(), false, 'stranded member_left rows are ignored');
      await raw(`update league_notifications set push_status='pending' where league_id=$1 and kind='draft_order_set'`, [old.id]);
      assertEquals(await notifyDue(), true, 'other kinds still count');
      await raw(`update league_notifications set push_status='sent' where league_id=$1`, [old.id]);
    });

    await step('after the season: hide (history kept), Home skips it, unhide restores, idempotent', async () => {
      const l = await mkLeague([C, A, B, D], { draft_date: await inHours(-400) });
      await raw(`update leagues set draft_status='completed', season_status='completed' where id=$1`, [l.id]);
      await q(`insert into league_standings (league_id, user_id, wins) values ($1,$2,3),($1,$3,1),($1,$4,0),($1,$5,2)`,
        [l.id, C, A, B, D]);
      const home = async (uid: string) => {
        await asRole('authenticated', uid);
        try { return (await q(`select league_id from get_home_summary()`)).map((r: Row) => r.league_id); } finally { await asRole(null); }
      };
      assert((await home(A)).includes(l.id));
      const r = await leave(l.id, A);
      assertEquals([r.status, r.already_hidden], ['hidden', false]);
      assertEquals(await members(l.id), [A, B, C, D].sort(), 'membership kept');
      assertEquals((await q(`select count(*)::int n from league_standings where league_id=$1`, [l.id]))[0].n, 4);
      assert(!(await home(A)).includes(l.id), 'Home skips the hidden league');
      assert((await home(B)).includes(l.id), 'other members unaffected');
      await asRole('authenticated', A);
      assertEquals((await q(`select count(*)::int n from league_standings where league_id=$1`, [l.id]))[0].n, 4,
        'the hider still reads the history');
      await asRole(null);
      assertEquals((await leave(l.id, A)).already_hidden, true);
      assertEquals(await reconfirm(l.id), undefined, 'hiding never writes a reconfirm row');
      assertEquals(await leftNotices(l.id), [], 'hiding never notifies');
      assertEquals((await leave(l.id, C, A)).reason, 'successor_not_allowed');
      const u = await unhide(l.id, A);
      assertEquals([u.status, u.already_shown], ['shown', false]);
      assert((await home(A)).includes(l.id));
      assertEquals((await unhide(l.id, A)).already_shown, true);
      assertEquals((await unhide(l.id, X)).reason, 'not_member');
    });

    await step('every function body runs (late binding): invalid_arguments raises 22023', async () => {
      await asRole('service_role');
      for (const call of [
        `select leave_league(null, 'x')`, `select unhide_league(null, 'x')`,
        `select confirm_league_roster(null, 'x', 'invite')`,
        `select confirm_league_roster(gen_random_uuid(), 'x', 'nope')`,
      ]) {
        let code = '';
        try { await q(call); } catch (e) { code = (e as { code?: string }).code ?? ''; }
        assertEquals(code, '22023', call);
      }
      await asRole(null);
    });

    await step('effect test (the SQL-editor script) passes and rolls back', async () => {
      const before = (await q(`select count(*)::int n from leagues`))[0].n;
      const err = await assertRejects(async () => { await db.exec(await Deno.readTextFile(EFFECT_TEST)); });
      const msg = String((err as Error).message);
      assert(msg.includes('LEAVE LEAGUE EFFECT TEST RESULTS'), msg);
      assert(!msg.includes('FAIL'), msg);
      assertEquals(msg.match(/PASS/g)?.length, 20, msg); // one per case in the file's EXPECTED OUTPUT
      assertEquals((await q(`select count(*)::int n from leagues`))[0].n, before, 'fixture rolled back');
    });

    await db.close();
  },
});

Deno.test({
  name: 'leave league x Run it back (#94 fixture) on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const { db, q } = await boot(true);
    for (const f of OURS) await db.exec(await mig(f));
    const leave = async (id: string, uid: string, successor: string | null = null) => {
      await db.exec(`set role service_role`);
      try { return (await q(`select leave_league($1, $2, $3) r`, [id, uid, successor]))[0].r; } finally { await db.exec(`reset role`); }
    };
    const [s1] = await q(`insert into leagues (name, commissioner_id, draft_status, season_status) values ('S1',$1,'completed','completed') returning id`, [C]);
    const [s2] = await q(`insert into leagues (name, commissioner_id, previous_league_id, draft_date) values ('S2',$1,$2, now() + interval '3 days') returning id`, [C, s1.id]);
    for (const [u, role] of [[C, 'commissioner'], [A, 'member'], [B, 'member'], [E, 'member']]) {
      await q(`insert into league_members (league_id, user_id, role) values ($1,$2,$3)`, [s2.id, u, role]);
    }
    // C (commissioner) is 'in'; A replied 'in'; B is pending (not a member yet); E is a newcomer (no row).
    await q(`insert into league_renewal_responses (league_id, user_id, status, decided_by, responded_at) values ($1,$2,'in','player',now())`, [s2.id, C]);
    await q(`insert into league_renewal_responses (league_id, user_id, status) values ($1,$2,'pending'),($1,$3,'pending')`, [s2.id, A, B]);
    await q(`update league_renewal_responses set status='in', decided_by='player', responded_at=now() where league_id=$1 and user_id=$2`, [s2.id, A]);
    await q(`delete from league_members where league_id=$1 and user_id=$2`, [s2.id, B]); // B pending: not a member

    await t.step("the renewal commissioner cannot leave (respond_to_renewal's rule)", async () => {
      assertEquals((await leave(s2.id, C, A)).reason, 'commissioner_cannot_opt_out');
    });

    await t.step("an invitee's leave IS an 'out' reply: reply flipped, NO reconfirm row, commissioner notified", async () => {
      const r = await leave(s2.id, A);
      assertEquals([r.status, r.reconfirm_required], ['left', false]);
      const [resp] = await q(`select status, decided_by from league_renewal_responses where league_id=$1 and user_id=$2`, [s2.id, A]);
      assertEquals([resp.status, resp.decided_by], ['out', 'player']);
      assertEquals((await q(`select count(*)::int n from league_roster_reconfirm where league_id=$1`, [s2.id]))[0].n, 0);
      assertEquals((await q(`select user_id from league_notifications where league_id=$1 and kind='member_left'`, [s2.id]))
        .map((x: Row) => x.user_id), [C]);
      // #94's pending blocker counts PENDING rows only: still exactly B, the leave added none.
      assertEquals((await q(`select count(*)::int n from league_renewal_responses where league_id=$1 and status='pending'`, [s2.id]))[0].n, 1);
    });

    await t.step('a newcomer in a renewal league leaves like anyone else: reconfirm row', async () => {
      const r = await leave(s2.id, E);
      assertEquals([r.status, r.reconfirm_required], ['left', true]);
      assertEquals((await q(`select departed from league_roster_reconfirm where league_id=$1`, [s2.id]))[0].departed.map((e: Row) => e.user_id), [E]);
    });

    await db.close();
  },
});
