/**
 * get_season_result (20261014000000) + the league_seasons commissioner-write
 * drop (20261014000001) against REAL Postgres (PGlite = Postgres 16 in WASM).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * Loaded VERBATIM (never retyped):
 *   - both migrations under test;
 *   - what they read or depend on: is_member() (sliced from 20260712000000),
 *     participant_display_name (20261004000000 whole), league_standings_ranked
 *     (20261011000000), complete_league_season (20261011000002), and
 *     start_new_league_season (sliced from 20260718000000, for the archived case);
 *   - the two prod league_seasons policies (sliced from 20260125000000), so the
 *     drop is measured against the real FOR ALL policy.
 * Every season's final_standings is written by the REAL complete_league_season,
 * never hand-typed, so final_rank is the unified ranking's output.
 * Supabase's default grants (EXECUTE on functions, ALL on tables, to
 * anon/authenticated/service_role) are simulated, so the proacl and
 * table-grant assertions prove the explicit revokes work.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const mig = (name: string) => Deno.readTextFile(new URL(`supabase/migrations/${name}`, ROOT));

/** The exact text from `start` up to and including the first `end` after it. */
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`slice start not found: ${start}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`slice end not found: ${end}`);
  return src.slice(i, j + end.length);
}
/** Every non-comment line of `src` containing `needle`, verbatim. */
const linesWith = (src: string, needle: string) =>
  src.split('\n').filter((l) => l.includes(needle) && !l.trimStart().startsWith('--')).join('\n');

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
  id uuid primary key default gen_random_uuid(), name text, commissioner_id text,
  draft_status text default 'completed', created_at timestamptz not null default now(),
  league_type text not null default 'matchup', num_weeks int, current_week int default 1,
  league_start_date timestamptz, league_end_date timestamptz, playoff_teams int default 4,
  season_status text default 'active');
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, role text not null default 'member',
  joined_at timestamptz not null default now(), primary key (league_id, user_id));
create table matchups (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, week_number int not null,
  team1_user_id text, team2_user_id text, team1_gain numeric(12,2), team2_gain numeric(12,2),
  winner_user_id text, week_start timestamptz, week_end timestamptz, is_playoff boolean default false,
  playoff_round text, team1_seed int, team2_seed int, is_tie boolean default false,
  playoff_round_number smallint, bracket_position smallint);
create table league_standings (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, wins numeric(5,1) not null default 0, losses numeric(5,1) not null default 0,
  ties numeric(5,1) not null default 0, points_for numeric(12,2) not null default 0,
  points_against numeric(12,2) not null default 0, updated_at timestamptz not null default now(),
  primary key (league_id, user_id));
create table league_seasons (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, season_number int not null default 1,
  started_at timestamptz not null default now(), completed_at timestamptz,
  champion_user_id text, runner_up_user_id text, final_standings jsonb,
  created_at timestamptz not null default now(), unique (league_id, season_number));
alter table leagues add column current_season_id uuid references league_seasons(id);
create table user_profiles (id uuid primary key, username text);
grant select on leagues, league_members, matchups, league_standings, user_profiles
  to authenticated, service_role;
-- Supabase grants ALL on new tables to the API roles; RLS is the only barrier.
grant all on league_seasons to anon, authenticated, service_role;
`;

// The prod members-only SELECT policies (20260712000004/5, 20260811000005).
const RLS = `
alter table league_standings enable row level security;
alter table matchups enable row level security;
alter table league_members enable row level security;
create policy league_standings_select_members on league_standings for select to authenticated using (is_member(league_id));
create policy matchups_select_members on matchups for select to authenticated using (is_member(league_id));
create policy league_members_select_members on league_members for select
  using (is_member(league_id) or user_id = (auth.uid())::text);
alter table league_seasons enable row level security;
`;

// deno-lint-ignore no-explicit-any
type Row = any;

/** [week, team1, team2 (null = bye), team1 gain, team2 gain] */
type Reg = [number, string, string | null, number, number?];
/** [round, position, week, team1, team2, team1 gain, team2 gain]; higher gain wins */
type Po = [number, number, number, string, string, number, number];

Deno.test({
  name: 'get_season_result + league_seasons write lockdown on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    const asUser = async <T>(role: string, sub: string | null, fn: () => Promise<T>): Promise<T> => {
      await db.exec(`set role ${role}`);
      await db.exec(`select set_config('request.jwt.claim.sub', '${sub ?? ''}', false)`);
      try {
        return await fn();
      } finally {
        // Inside an aborted scratch() transaction this reset itself fails; the
        // rollback that follows reverts the SET ROLE anyway (SET is transactional),
        // so swallow it rather than mask the error that aborted the transaction.
        await db.exec('reset role').catch(() => {});
      }
    };
    /** Run fn in a transaction that is always rolled back. */
    const scratch = async <T>(fn: () => Promise<T>): Promise<T> => {
      await db.exec('begin');
      try { return await fn(); } finally { await db.exec('rollback'); }
    };

    // ---- prior state, verbatim ------------------------------------------------
    await db.exec(SCHEMA);
    const helpers = await mig('20260712000000_rls_b1_00_helpers.sql');
    await db.exec(slice(helpers, 'create or replace function public.is_member(', '$$;'));
    await db.exec(RLS);
    const seasons = await mig('20260125000000_add_league_seasons.sql');
    await db.exec(slice(seasons, 'CREATE POLICY "Users can view league seasons for their leagues"', '\n  );'));
    await db.exec(slice(seasons, 'CREATE POLICY "Commissioners can manage league seasons"', '\n  );'));
    await db.exec(await mig('20261004000000_participant_display_names.sql'));
    await db.exec(await mig('20261011000000_league_standings_ranked.sql'));
    await db.exec(await mig('20261011000002_complete_league_season_unified_rank.sql'));
    const lockdown = await mig('20260718000000_lockdown_start_new_league_season.sql');
    await db.exec(slice(lockdown, 'CREATE OR REPLACE FUNCTION start_new_league_season(', '$$;'));
    await db.exec(linesWith(lockdown, 'ON FUNCTION start_new_league_season(uuid)'));

    // ---- fixtures -------------------------------------------------------------
    let seq = 0;
    const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

    /**
     * A league with one season: regular rows, standings computed the way
     * process-week-results writes them (a bye adds its gain to points_for and
     * NO W/L/T; a draw is a tie), playoff rows, and -- if `complete` -- the
     * REAL complete_league_season run as service_role.
     */
    async function build(o: {
      members: string[]; commissioner?: string; numWeeks: number; playoffTeams: number;
      regular: Reg[]; playoffs?: Po[]; complete?: [string, string];
    }) {
      const [l] = await q(`insert into leagues (name, commissioner_id, num_weeks, playoff_teams, current_week)
        values ('t', $1, $2, $3, $2) returning id`, [o.commissioner ?? o.members[0], o.numWeeks, o.playoffTeams]);
      const lg = l.id as string;
      const [s] = await q(`insert into league_seasons (league_id, season_number) values ($1, 1) returning id`, [lg]);
      await q(`update leagues set current_season_id = $1 where id = $2`, [s.id, lg]);
      const st: Record<string, { w: number; l: number; t: number; pf: number; pa: number }> = {};
      let i = 0;
      for (const u of o.members) {
        await q(`insert into league_members (league_id, user_id, joined_at)
          values ($1, $2, '2026-09-01T00:00Z'::timestamptz + ($3 || ' minutes')::interval)`, [lg, u, String(i++)]);
        st[u] = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
      }
      for (const [week, a, b, ga, gb] of o.regular) {
        if (b === null) {
          st[a].pf += ga;
          await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, winner_user_id, is_tie)
            values ($1, $2, $3, null, $4, null, false)`, [lg, week, a, ga]);
          continue;
        }
        const winner = ga > gb! ? a : gb! > ga ? b : null;
        st[a].pf += ga; st[a].pa += gb!; st[b].pf += gb!; st[b].pa += ga;
        if (winner === a) { st[a].w++; st[b].l++; } else if (winner === b) { st[b].w++; st[a].l++; } else { st[a].t++; st[b].t++; }
        await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id, is_tie)
          values ($1, $2, $3, $4, $5, $6, $7, $8)`, [lg, week, a, b, ga, gb, winner, winner === null]);
      }
      for (const u of o.members) {
        await q(`insert into league_standings (league_id, user_id, wins, losses, ties, points_for, points_against)
          values ($1, $2, $3, $4, $5, $6, $7)`, [lg, u, st[u].w, st[u].l, st[u].t, st[u].pf, st[u].pa]);
      }
      for (const [round, pos, week, a, b, ga, gb] of o.playoffs ?? []) {
        assert(ga !== gb, 'a playoff game always names a winner');
        await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain,
            winner_user_id, is_playoff, playoff_round_number, bracket_position)
          values ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)`, [lg, week, a, b, ga, gb, ga > gb ? a : b, round, pos]);
      }
      if (o.complete) {
        await asUser('service_role', null, () =>
          q(`select complete_league_season($1, $2, $3)`, [lg, o.complete![0], o.complete![1]]));
      }
      return { lg, season: s.id as string };
    }

    const COLS = `season_id, season_number, status, reason, detail_scope, completed_at is not null as completed,
      standings_count, champion_user_id, champion_display_name, runner_up_user_id, runner_up_display_name,
      caller_participated, final_rank, wins::float8 wins, losses::float8 losses, ties::float8 ties,
      points_for::float8 points_for, playoff_teams, playoff_weeks, playoff_wins, playoff_losses,
      playoff_result, playoff_exit_round, best_week_number, best_week_gain::float8 best_week_gain`;
    const result = async (who: string | null, lg: string, season: string | null = null) =>
      await asUser('authenticated', who, () => q(`select ${COLS} from get_season_result($1, $2)`, [lg, season]));
    const one = async (who: string, lg: string, season: string | null = null) => {
      const rows = await result(who, lg, season);
      assertEquals(rows.length, 1, `expected one row, got ${rows.length}`);
      return rows[0];
    };

    // ---- 4-team league, P=4 (W=2: Semifinals, Final), 3-week round robin ------
    //   records: A 3-0 pf275 | D 1-2 pf180 | B 1-2 pf150 | C 1-2 pf70
    //   B/C/D are a balanced H2H cycle -> no separation -> points_for.
    //   Seeds A1 D2 B3 C4. Semis: A beats C, B beats D. Final: B beats A.
    const [A, B, C, D] = [uid(), uid(), uid(), uid()];
    await q(`insert into user_profiles (id, username) values ($1, 'bea'), ($2, 'al')`, [B, A]);
    const four = await build({
      members: [A, B, C, D], commissioner: A, numWeeks: 3, playoffTeams: 4,
      regular: [
        [1, A, B, 100, 50], [1, C, D, 30, 20],
        [2, A, C, 80, 10], [2, B, D, 60, 70],
        [3, A, D, 95, 90], [3, B, C, 40, 30],
      ],
      playoffs: [[1, 0, 4, A, C, 50, 10], [1, 1, 4, D, B, 20, 70], [2, 0, 5, A, B, 30, 90]],
      complete: [B, A],
    });

    await t.step('pre-migration: the FOR ALL policy lets a commissioner forge the podium (the hole)', async () => {
      const rows = await scratch(() => asUser('authenticated', A, () =>
        q(`update league_seasons set champion_user_id = $1 where league_id = $2 returning id`, [A, four.lg])));
      assertEquals(rows.length, 1, 'the harness must reproduce the prod hole, or the post-drop test proves nothing');
    });

    // ---- apply the migrations under test ---------------------------------------
    await db.exec(await mig('20261014000000_get_season_result_rpc.sql'));
    await db.exec(await mig('20261014000001_drop_league_seasons_commissioner_write.sql'));

    await t.step('grants: DEFINER, authenticated only, search_path pinned', async () => {
      const [s] = await q(`select proacl::text acl, prosecdef, proconfig::text cfg from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname = 'get_season_result'`);
      assertEquals(s.prosecdef, true);
      assert(/authenticated=X/.test(s.acl), s.acl);
      assert(!/anon=/.test(s.acl), `anon still has EXECUTE: ${s.acl}`);
      assert(!/service_role=/.test(s.acl), `service_role has EXECUTE: ${s.acl}`);
      assert(!/(^|[{,])=X/.test(s.acl), `PUBLIC still has EXECUTE: ${s.acl}`);
      assert(s.cfg.includes('search_path=public, pg_temp'), s.cfg);
    });

    await t.step('policies: only the members SELECT policy remains on league_seasons', async () => {
      const pols = await q(`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'league_seasons'`);
      assertEquals(pols, [{ policyname: 'Users can view league seasons for their leagues', cmd: 'SELECT' }]);
      const grants = await q(`select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'league_seasons' and grantee in ('anon', 'authenticated')
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`);
      assertEquals(grants, [], 'client roles keep no write privilege');
    });

    await t.step('a commissioner can no longer UPDATE / INSERT / DELETE league_seasons', async () => {
      for (const sql of [
        [`update league_seasons set champion_user_id = $1 where league_id = $2`, [A, four.lg]],
        [`update league_seasons set final_standings = '[]'::jsonb where league_id = $2 and $1::text is not null`, [A, four.lg]],
        [`insert into league_seasons (league_id, season_number, champion_user_id) values ($2, 9, $1)`, [A, four.lg]],
        [`delete from league_seasons where league_id = $2 and $1::text is not null`, [A, four.lg]],
      ] as const) {
        const err = await assertRejects(() => scratch(() => asUser('authenticated', A, () => q(sql[0], [...sql[1]]))));
        assert(/permission denied for table league_seasons/.test((err as Error).message), (err as Error).message);
      }
      // ...and a member still reads their league's seasons.
      const seen = await asUser('authenticated', C, () => q(`select id from league_seasons where league_id = $1`, [four.lg]));
      assertEquals(seen.length, 1);
    });

    await t.step('4-team: champion, runner-up and an eliminated semifinalist', async () => {
      const b = await one(B, four.lg);
      assertEquals([b.status, b.reason, b.detail_scope, b.completed, b.standings_count], ['complete', null, 'full', true, 4]);
      assertEquals([b.champion_user_id, b.champion_display_name, b.runner_up_user_id, b.runner_up_display_name], [B, 'bea', A, 'al']);
      assertEquals([b.caller_participated, b.final_rank, b.wins, b.losses, b.ties, b.points_for], [true, 3, 1, 2, 0, 150]);
      assertEquals([b.playoff_teams, b.playoff_weeks, b.playoff_wins, b.playoff_losses, b.playoff_result, b.playoff_exit_round],
        [4, 2, 2, 0, 'champion', 2]);
      assertEquals([b.best_week_number, b.best_week_gain], [2, 60]);

      const a = await one(A, four.lg);
      assertEquals([a.final_rank, a.wins, a.losses, a.points_for], [1, 3, 0, 275]);
      assertEquals([a.playoff_wins, a.playoff_losses, a.playoff_result, a.playoff_exit_round], [1, 1, 'runner_up', 2]);
      assertEquals([a.best_week_number, a.best_week_gain], [1, 100]);

      const c = await one(C, four.lg);
      assertEquals([c.final_rank, c.points_for], [4, 70]);
      assertEquals([c.playoff_wins, c.playoff_losses, c.playoff_result, c.playoff_exit_round], [0, 1, 'eliminated', 1]);
      assertEquals([c.best_week_number, c.best_week_gain], [1, 30]);

      const d = await one(D, four.lg);
      assertEquals([d.final_rank, d.playoff_result, d.playoff_exit_round, d.best_week_number], [2, 'eliminated', 1, 3]);

      // final_rank is the stored unified rank, never re-derived.
      const [fs] = await q(`select final_standings from league_seasons where id = $1`, [four.season]);
      for (const [who, r] of [[A, a], [B, b], [C, c], [D, d]] as const) {
        assertEquals(r.final_rank, fs.final_standings.find((e: Row) => e.user_id === who).rank);
      }
    });

    await t.step('explicit p_season_id equals the default, and a season of another league is 0 rows', async () => {
      assertEquals(await one(C, four.lg, four.season), await one(C, four.lg));
      const other = await build({ members: [uid(), uid()], numWeeks: 1, playoffTeams: 2, regular: [] });
      assertEquals(await result(C, four.lg, other.season), []);
    });

    await t.step('non-member: 0 rows; anon / no-sub / service_role: denied', async () => {
      assertEquals(await result(uid(), four.lg), []);
      assertEquals(await result(C, '00000000-0000-4000-8000-ffffffffffff'), [], 'unknown league looks like non-member');
      const anonErr = await assertRejects(() => asUser('anon', null, () => q(`select * from get_season_result($1)`, [four.lg])));
      assert(/permission denied for function get_season_result/.test((anonErr as Error).message), (anonErr as Error).message);
      const noSub = await assertRejects(() => result(null, four.lg));
      assert(/not authenticated/.test((noSub as Error).message), (noSub as Error).message);
      const svc = await assertRejects(() => asUser('service_role', null, () => q(`select * from get_season_result($1)`, [four.lg])));
      assert(/permission denied for function get_season_result/.test((svc as Error).message), (svc as Error).message);
    });

    await t.step('partial state refuses: inconsistent, with every derived field NULL', async () => {
      const cases: Array<[string, string, unknown[]]> = [
        ['champion_mismatch', `update league_seasons set champion_user_id = $1 where id = $2`, [C, four.season]],
        ['champion_mismatch', `update league_seasons set runner_up_user_id = $1 where id = $2`, [D, four.season]],
        ['weeks_unscored', `update matchups set team1_gain = null, team2_gain = null
           where league_id = $2 and week_number = 2 and team1_user_id = $1`, [A, four.lg]],
        ['weeks_unscored', `delete from matchups where league_id = $2 and week_number = 3 and team1_user_id = $1`, [B, four.lg]],
        // A scored week the standings write missed (updateUserStandings only logs).
        ['points_for_mismatch', `update matchups set team2_gain = team2_gain + 1
           where league_id = $2 and week_number = 1 and team1_user_id = $1`, [C, four.lg]],
        ['playoffs_unscored', `update matchups set team1_gain = null
           where league_id = $2 and is_playoff and playoff_round_number = 1 and team1_user_id = $1`, [A, four.lg]],
        ['playoffs_unscored', `delete from matchups where league_id = $2 and is_playoff and $1::text is not null`, [A, four.lg]],
        ['playoff_final_unresolved', `update matchups set winner_user_id = null
           where league_id = $2 and is_playoff and playoff_round_number = 2 and $1::text is not null`, [A, four.lg]],
        ['playoff_shape_mismatch', `update leagues set playoff_teams = 8 where id = $2 and $1::text is not null`, [A, four.lg]],
        ['standings_missing_participant', `update league_seasons set final_standings =
           (select jsonb_agg(e) from jsonb_array_elements(final_standings) e where e ->> 'user_id' <> $1) where id = $2`,
          [D, four.season]],
        ['final_standings_missing', `update league_seasons set final_standings = null where id = $2 and $1::text is not null`,
          [A, four.season]],
        ['season_status_mismatch', `update leagues set season_status = 'playoffs' where id = $2 and $1::text is not null`,
          [A, four.lg]],
      ];
      for (const [reason, sql, params] of cases) {
        // Checked from C's seat: a gap in SOMEONE ELSE's record still refuses,
        // because the caller's rank depends on everyone's.
        const r = await scratch(async () => { await q(sql, params); return await one(C, four.lg); });
        assertEquals([r.status, r.reason], ['inconsistent', reason], sql);
        assertEquals([r.champion_user_id, r.final_rank, r.points_for, r.playoff_result, r.best_week_number, r.detail_scope],
          [null, null, null, null, null, null], `${reason}: nothing fabricated`);
      }
      assertEquals((await one(C, four.lg)).status, 'complete', 'every case rolled back');
    });

    await t.step('not complete: no podium, and the default falls back to the current season', async () => {
      const [P1, P2] = [uid(), uid()];
      const live = await build({ members: [P1, P2], numWeeks: 1, playoffTeams: 2, regular: [[1, P1, P2, 10, 5]],
        playoffs: [[1, 0, 2, P1, P2, 30, 20]] }); // final scored, completion never ran (F-B shape)
      const r = await one(P1, live.lg);
      assertEquals([r.season_id, r.status, r.reason, r.champion_user_id, r.final_rank, r.detail_scope],
        [live.season, 'not_complete', 'season_in_progress', null, null, null]);
      const [bare] = await q(`insert into leagues (name, num_weeks) values ('pre-draft', 1) returning id`);
      await q(`insert into league_members (league_id, user_id) values ($1, $2)`, [bare.id, P1]);
      const n = await one(P1, bare.id);
      assertEquals([n.season_id, n.status, n.reason], [null, 'not_complete', 'no_season']);
    });

    await t.step('6-team, P=6 with byes (W=3: Wild card, Semifinals, Final)', async () => {
      //   records U1 2-0 | U2..U5 1-1 (unbalanced H2H -> points_for 130/100/80/75) | U6 0-2
      //   R1 (wild card): U4 beats U5, U3 beats U6. Byes: U1 -> R2#0.t1, U2 -> R2#1.t2.
      //   R2: U4 beats U1 (the bye seed loses its first game), U3 beats U2.
      //   Final: U3 beats U4.
      const U = [uid(), uid(), uid(), uid(), uid(), uid()];
      const six = await build({
        members: U, numWeeks: 2, playoffTeams: 6,
        regular: [
          [1, U[0], U[1], 100, 90], [1, U[2], U[3], 80, 10], [1, U[4], U[5], 50, 5],
          [2, U[0], U[2], 60, 20], [2, U[1], U[4], 40, 25], [2, U[3], U[5], 70, 1],
        ],
        playoffs: [
          [1, 1, 3, U[3], U[4], 40, 10], [1, 2, 3, U[2], U[5], 40, 10],
          [2, 0, 4, U[0], U[3], 10, 40], [2, 1, 4, U[2], U[1], 40, 10],
          [3, 0, 5, U[2], U[3], 40, 10],
        ],
        complete: [U[2], U[3]], // completion via the DEFINER path still works after the policy drop
      });
      const ranks: number[] = []; // sequential: PGlite is one connection and asUser switches roles
      for (const u of U) ranks.push((await one(u, six.lg)).final_rank);
      assertEquals(ranks, [1, 2, 3, 4, 5, 6]);

      const s1 = await one(U[0], six.lg);
      assertEquals([s1.status, s1.playoff_teams, s1.playoff_weeks], ['complete', 6, 3]);
      assertEquals([s1.playoff_wins, s1.playoff_losses, s1.playoff_result, s1.playoff_exit_round], [0, 1, 'eliminated', 2],
        'a bye is not a game: seed 1 is 0-1, out in round 2 (Semifinals)');
      const s3 = await one(U[2], six.lg);
      assertEquals([s3.playoff_wins, s3.playoff_losses, s3.playoff_result, s3.playoff_exit_round], [3, 0, 'champion', 3]);
      const s4 = await one(U[3], six.lg);
      assertEquals([s4.playoff_wins, s4.playoff_losses, s4.playoff_result, s4.playoff_exit_round], [2, 1, 'runner_up', 3]);
      const s5 = await one(U[4], six.lg);
      assertEquals([s5.playoff_wins, s5.playoff_losses, s5.playoff_result, s5.playoff_exit_round], [0, 1, 'eliminated', 1],
        'out in round 1 = the Wild card round');
    });

    await t.step('5-team odd roster: a bye is no result, but its gain is a scored week', async () => {
      //   W1: V1 50 v V2 40, V3 30 v V4 20, V5 bye (+500). W2: V1 20 v V3 10, V2 60 v V5 5, V4 bye (+1).
      //   V1 2-0 pf70 | V2 1-1 pf100 | V3 1-1 pf40 (never met V2 -> points_for) | V5 0-1 pf505 | V4 0-1 pf21.
      //   P=2: seed 2 V2 upsets seed 1 V1 in the final.
      const V = [uid(), uid(), uid(), uid(), uid()];
      const five = await build({
        members: V, numWeeks: 2, playoffTeams: 2,
        regular: [
          [1, V[0], V[1], 50, 40], [1, V[2], V[3], 30, 20], [1, V[4], null, 500],
          [2, V[0], V[2], 20, 10], [2, V[1], V[4], 60, 5], [2, V[3], null, 1],
        ],
        playoffs: [[1, 0, 3, V[0], V[1], 10, 40]],
        complete: [V[1], V[0]],
      });
      const v5 = await one(V[4], five.lg);
      assertEquals([v5.status, v5.final_rank, v5.wins, v5.losses, v5.ties, v5.points_for], ['complete', 4, 0, 1, 0, 505],
        'the bye added no W/L/T');
      assertEquals([v5.best_week_number, v5.best_week_gain], [1, 500], 'the bye week is the best week');
      assertEquals([v5.playoff_wins, v5.playoff_losses, v5.playoff_result, v5.playoff_exit_round], [0, 0, 'missed', null]);
      const v2 = await one(V[1], five.lg);
      assertEquals([v2.final_rank, v2.playoff_teams, v2.playoff_weeks, v2.playoff_result, v2.playoff_exit_round],
        [2, 2, 1, 'champion', 1]);
    });

    await t.step('archived season after start_new_league_season: standings_only, never guessed', async () => {
      const newSeason = (await asUser('authenticated', A, () =>
        q(`select start_new_league_season($1) as id`, [four.lg])))[0].id; // DEFINER INSERT still works
      assertEquals((await q(`select count(*)::int n from matchups where league_id = $1`, [four.lg]))[0].n, 0,
        'the reset deleted every matchup: only final_standings survives');
      const late = uid();
      await q(`insert into league_members (league_id, user_id) values ($1, $2)`, [four.lg, late]);

      const b = await one(B, four.lg); // default = the latest COMPLETED season, not the new active one
      assertEquals([b.season_id, b.status, b.detail_scope], [four.season, 'complete', 'standings_only']);
      assertEquals([b.final_rank, b.wins, b.losses, b.points_for, b.champion_user_id, b.runner_up_user_id],
        [3, 1, 2, 150, B, A]);
      assertEquals([b.playoff_result, b.playoff_teams, b.playoff_wins, b.playoff_exit_round, b.best_week_number],
        ['champion', null, null, null, null]);
      assertEquals((await one(A, four.lg)).playoff_result, 'runner_up');
      assertEquals((await one(C, four.lg)).playoff_result, null, 'eliminated vs missed is unknowable: NULL, not guessed');

      const l = await one(late, four.lg);
      assertEquals([l.status, l.caller_participated, l.champion_user_id, l.final_rank], ['complete', false, B, null],
        'joined after the season: the podium, no caller record');

      const cur = await one(B, four.lg, newSeason);
      assertEquals([cur.season_number, cur.status, cur.champion_user_id], [2, 'not_complete', null]);
    });
  },
});
