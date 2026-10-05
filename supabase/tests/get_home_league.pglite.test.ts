/**
 * get_home_league (20261024000000 -- renamed from 20261018000000 so it
 * sorts after 20261023000000_start_new_league_season lockdown, which lands
 * on prod first; `supabase db push` refuses a pending file older than the
 * latest applied one) against REAL Postgres (PGlite = Postgres
 * 16 in WASM). NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * Loads VERBATIM (never retyped): the migration under test, plus its two
 * dependencies it calls internally — public.league_standings_ranked
 * (20261011000000) and public.get_league_display_names /
 * public.participant_display_name (20261004000000) — and the is_member RLS
 * helper (sliced from 20260712000000). Every other table's schema is
 * hand-written to its CURRENT shape (these tables are not themselves under
 * test here; league_standings_ranked.pglite.test.ts is their test).
 *
 * Covers the Orchestrator's ask (2026-09-29): member ok, non-member gets
 * nothing, anon 42501, proacl (explicit revoke survives Supabase's default
 * per-role grants), and — the one deliberate narrowing this function makes
 * beyond a member's direct RLS grant — the opponent's PREVIOUS week's
 * trades are absent from the result even though a member's raw `trades`
 * SELECT policy has no such week limit.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const mig = (name: string) => Deno.readTextFile(new URL(`supabase/migrations/${name}`, ROOT));

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Supabase: every new function gets explicit anon/authenticated/service_role EXECUTE.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table leagues (
  id uuid primary key default gen_random_uuid(), name text,
  current_week int default 1
);
create table league_members (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create table matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  week_number int not null, team1_user_id text, team2_user_id text,
  team1_gain numeric, team2_gain numeric,
  week_start timestamptz, week_end timestamptz, is_playoff boolean default false
);
create table league_standings (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, wins numeric(5,1) not null default 0,
  losses numeric(5,1) not null default 0, ties numeric(5,1) not null default 0,
  points_for numeric(12,2) not null default 0, points_against numeric(12,2) not null default 0,
  primary key (league_id, user_id)
);
create table user_profiles (id uuid primary key, username text);
create table drafts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, symbol text not null, entry_price numeric not null,
  quantity numeric not null, created_at timestamptz not null default now()
);
create table trades (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null, symbol text not null,
  action text not null check (action in ('buy','sell')),
  quantity numeric not null, price numeric not null,
  created_at timestamptz not null default now()
);
create table week_snapshots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, week_number int not null, symbol text not null,
  quantity numeric not null, week_start_price numeric not null,
  week_end_price numeric, entered_mid_week boolean not null default false
);
grant select on leagues, league_members, matchups, league_standings, user_profiles, drafts, trades, week_snapshots
  to authenticated, service_role;
`;

// The prod SELECT policies these tables carry today (only asserted
// indirectly here — the point of this test is the RPC's OWN narrowing,
// not re-testing each table's own RLS, which is out of scope).
const RLS = `
alter table league_standings enable row level security;
alter table matchups enable row level security;
alter table league_members enable row level security;
alter table drafts enable row level security;
alter table trades enable row level security;
alter table week_snapshots enable row level security;
create policy league_standings_select_members on league_standings for select to authenticated using (is_member(league_id));
create policy matchups_select_members on matchups for select to authenticated using (is_member(league_id));
create policy league_members_select_members on league_members for select
  using (is_member(league_id) or user_id = (auth.uid())::text);
create policy drafts_select_members on drafts for select using (is_member(league_id));
create policy trades_select_members on trades for select using (is_member(league_id));
create policy week_snapshots_select_members on week_snapshots for select to authenticated using (is_member(league_id));
`;

/** The exact text from `start` up to and including the first `end` after it. */
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`slice start not found: ${start}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`slice end not found: ${end}`);
  return src.slice(i, j + end.length);
}

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'get_home_league on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];

    await db.exec(SCHEMA);
    const helpers = await mig('20260712000000_rls_b1_00_helpers.sql');
    await db.exec(slice(helpers, 'create or replace function public.is_member(', '$$;'));
    await db.exec(RLS);
    await db.exec(await mig('20261011000000_league_standings_ranked.sql'));
    await db.exec(await mig('20261004000000_participant_display_names.sql'));
    await db.exec(await mig('20261024000000_get_home_league_rpc.sql'));

    const MEMBER = '00000000-0000-4000-8000-000000000001';
    const OPPONENT = '00000000-0000-4000-8000-000000000002';
    const OUTSIDER = '00000000-0000-4000-8000-000000000009';

    const [league] = await q(`insert into leagues (name, current_week) values ('t', 6) returning id`);
    const LEAGUE = league.id as string;
    await q(`insert into league_members (league_id, user_id) values ($1,$2), ($1,$3)`, [LEAGUE, MEMBER, OPPONENT]);
    await q(`insert into league_standings (league_id, user_id, wins, losses, points_for) values
      ($1,$2,4,1,129.99), ($1,$3,1,4,-142.35)`, [LEAGUE, MEMBER, OPPONENT]);

    // Current week (6) matchup, plus a PREVIOUS week (5) row for both.
    await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, week_start, week_end)
      values ($1, 6, $2, $3, null, null, '2026-09-21T09:30:00-04', '2026-09-25T16:00:00-04')`, [LEAGUE, MEMBER, OPPONENT]);
    await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, week_start, week_end)
      values ($1, 5, $2, $3, 54.24, -30.1, '2026-09-14T09:30:00-04', '2026-09-18T16:00:00-04')`, [LEAGUE, MEMBER, OPPONENT]);

    await q(`insert into drafts (league_id, user_id, symbol, entry_price, quantity) values ($1,$2,'NVDA',290.1,6.8942)`, [LEAGUE, MEMBER]);
    // The member's own current-week trade (should be returned).
    await q(`insert into trades (league_id, user_id, symbol, action, quantity, price, created_at) values
      ($1,$2,'AAPL','buy',5,200,'2026-09-23T15:00:00-04')`, [LEAGUE, MEMBER]);
    // The member's own trade dated AFTER week 6 ends (e.g. a future week's
    // buy, or current_week having rolled over) — must NOT appear in
    // current_week.my_trades (security-review regression: this field's
    // upper bound was missing before the fix).
    await q(`insert into trades (league_id, user_id, symbol, action, quantity, price, created_at) values
      ($1,$2,'COST','buy',1,918,'2026-10-01T15:00:00-04')`, [LEAGUE, MEMBER]);
    // The opponent's CURRENT-week trade (should be returned, per week_start/week_end).
    await q(`insert into trades (league_id, user_id, symbol, action, quantity, price, created_at) values
      ($1,$2,'DIS','buy',3,101,'2026-09-22T15:00:00-04')`, [LEAGUE, OPPONENT]);
    // The opponent's PREVIOUS-week trade — must NOT be returned.
    await q(`insert into trades (league_id, user_id, symbol, action, quantity, price, created_at) values
      ($1,$2,'KO','sell',10,69,'2026-09-16T15:00:00-04')`, [LEAGUE, OPPONENT]);

    await t.step('member: one row, current week scoped correctly, opponent previous-week trade absent', async () => {
      await db.exec(`SET ROLE authenticated;`);
      await db.exec(`SELECT set_config('request.jwt.claim.sub', '${MEMBER}', false);`);
      const [row] = await q(`select public.get_home_league($1) as result`, [LEAGUE]);
      const result = row.result;
      assert(result, 'expected a jsonb result for a member');
      assertEquals(result.current_week.week_number, 6);
      assertEquals(result.my_ledger.drafts.length, 1);
      assertEquals(result.my_ledger.trades.length, 2); // AAPL + COST -- my_ledger is ALL-TIME, unscoped by week
      assertEquals(result.current_week.my_trades.length, 1); // AAPL only -- the post-week-end COST trade is excluded
      assert(!result.current_week.my_trades.some((t: Row) => t.symbol === 'COST'),
        'my own trade dated after this week ended leaked into current_week.my_trades');
      assertEquals(result.current_week.opponent_trades.length, 1);
      assertEquals(result.current_week.opponent_trades[0].symbol, 'DIS');
      // The opponent's KO sell (week 5) must be absent.
      assert(!result.current_week.opponent_trades.some((t: Row) => t.symbol === 'KO'),
        'opponent PREVIOUS-week trade leaked into current_week.opponent_trades');
      assertEquals(result.matchups.length, 2);
      assertEquals(result.standings.length, 2);
      const mine = result.standings.find((s: Row) => s.user_id === MEMBER);
      assertEquals(Number(mine.points_for), 129.99);
      await db.exec(`RESET ROLE;`);
    });

    await t.step('a bye week (no matchup row for the member this week) degrades to empty arrays, never an error', async () => {
      // A second league where the member has NO row in matchups for the
      // current week at all -- the exact shape a bye, a playoff bye, an
      // eliminated team, or a not-yet-scheduled week produces. This is the
      // case the security review found missing: an untyped `record`
      // v_matchup left unassigned by a 0-row SELECT INTO raises "record ...
      // is not assigned yet" the moment my_trades/opponent_trades reference
      // v_matchup.week_start/week_end -- an ERROR, not the empty-arrays
      // behavior the function's header promises.
      const [byeLeague] = await q(`insert into leagues (name, current_week) values ('bye-league', 3) returning id`);
      const BYE_LEAGUE = byeLeague.id as string;
      await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [BYE_LEAGUE, MEMBER]);
      // No matchups row at all for week 3 -- current_week has no row for
      // this member (schedule not generated that far, or a genuine bye).
      await q(`insert into trades (league_id, user_id, symbol, action, quantity, price, created_at) values
        ($1,$2,'NVDA','buy',1,300,'2026-09-08T15:00:00-04')`, [BYE_LEAGUE, MEMBER]);

      await db.exec(`SET ROLE authenticated;`);
      await db.exec(`SELECT set_config('request.jwt.claim.sub', '${MEMBER}', false);`);
      const [row] = await q(`select public.get_home_league($1) as result`, [BYE_LEAGUE]);
      const result = row.result;
      assert(result, 'expected a jsonb result, not an error, when the caller has no current-week matchup row');
      assertEquals(result.current_week.week_number, 3);
      assertEquals(result.current_week.my_trades, []);
      assertEquals(result.current_week.opponent_trades, []);
      assertEquals(result.current_week.my_snapshots, []);
      assertEquals(result.current_week.opponent_snapshots, []);
      // my_ledger is unaffected by the missing matchup row -- it's ALL-TIME.
      assertEquals(result.my_ledger.trades.length, 1);
      await db.exec(`RESET ROLE;`);
    });

    await t.step('non-member: no row leaks (null result)', async () => {
      await db.exec(`SET ROLE authenticated;`);
      await db.exec(`SELECT set_config('request.jwt.claim.sub', '${OUTSIDER}', false);`);
      const [row] = await q(`select public.get_home_league($1) as result`, [LEAGUE]);
      assertEquals(row.result, null);
      await db.exec(`RESET ROLE;`);
    });

    await t.step('anon: refused with 42501, not authenticated', async () => {
      await db.exec(`SET ROLE anon;`);
      let threw = false;
      try {
        await q(`select public.get_home_league($1)`, [LEAGUE]);
      } catch (e) {
        threw = true;
        assert(String(e).includes('permission denied') || String(e).includes('42501'));
      }
      assert(threw, 'anon call should have been refused');
      await db.exec(`RESET ROLE;`);
    });

    await t.step('proacl: explicit revoke survives Supabase-simulated default grants', async () => {
      const [acl] = await q(`select proacl::text acl, prosecdef, proconfig::text cfg from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and proname='get_home_league'`);
      assert(!acl.acl.includes('anon='), `anon should have no grant: ${acl.acl}`);
      assert(acl.acl.includes('authenticated='), `authenticated should be granted: ${acl.acl}`);
      assertEquals(acl.prosecdef, true);
      assert(acl.cfg.includes('search_path=public, pg_temp'));
    });
  },
});
