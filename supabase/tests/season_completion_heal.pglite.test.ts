/**
 * complete_league_season's guard (20261015000000) + the TS heal
 * (healUncompletedSeasons / completeLeagueSeason, process-week-results/
 * season-completion.ts) against REAL Postgres (PGlite = Postgres 16 in WASM).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite. Run
 * instructions: supabase/tests/README.md.
 *
 * THE BUG THIS PROVES HEALED: completeSeasonFromPlayoffs used to call
 * complete_league_season and only log its `{ error }` (never throws --
 * CLAUDE.md "Success signals" #5). Nothing retried it, so ONE failed call
 * stranded a league at season_status='playoffs' with its final already
 * scored -- permanently, since a scored final never re-enters the
 * pending-matchup query. This file drives that exact scenario against a real
 * Postgres instance: a completion whose rpc call fails on "run 1" (the same
 * root cause seen in prod, 20260926000000's header: current_season_id NULL),
 * then verifies "run 2" heals it once the underlying data is fixed, using the
 * REAL healUncompletedSeasons / completeLeagueSeason (not a re-implementation).
 *
 * What is loaded VERBATIM (never retyped), in the SAME chronological order
 * prod applied them:
 *   - complete_league_season sliced out of 20260125000000 (its original body,
 *     as league_standings_ranked.pglite.test.ts also loads it) with its
 *     lockdown grants (20260718000002) and search_path pin (20260724000002);
 *   - league_standings_ranked (20261011000000);
 *   - complete_league_season replaced by the unified-rank version
 *     (20261011000002);
 *   - the flexible-playoffs bracket-address columns + CHECK constraint
 *     (20261012000000);
 *   - THIS BRANCH'S migration under test (20261015000000).
 * The schema (leagues/league_members/matchups/league_standings/league_seasons)
 * is the union of what league_standings_ranked.pglite.test.ts and
 * flexible_playoffs.pglite.test.ts already establish is sufficient for these
 * exact migrations.
 *
 * The bracket itself is built with the REAL buildPlayoffBracket
 * (season-transition.ts) and advanced with the REAL planAdvance
 * (playoff-progression.ts) -- the same address math process-week-results uses
 * -- rather than hand-picked addresses, so a change to that math would show up
 * here too.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { buildPlayoffBracket, type PlayoffBracketRow } from '../functions/process-week-results/season-transition.ts';
import { planAdvance } from '../functions/process-week-results/playoff-progression.ts';
import { playoffShape } from '../functions/_shared/playoff-bracket.ts';
import { completeLeagueSeason, healUncompletedSeasons } from '../functions/process-week-results/season-completion.ts';

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
const linesWith = (src: string, needle: string) =>
  src.split('\n').filter((l) => l.includes(needle) && !l.trimStart().startsWith('--')).join('\n');

// The prod shape these migrations meet: same tables league_standings_ranked's
// test builds, plus the pre-flexible-playoffs matchups columns
// (team1_seed/team2_seed, the old 3-value round CHECK) flexible_playoffs's
// test builds, since 20261012000000 alters both.
const SCHEMA = `
create role anon; create role authenticated; create role service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table leagues (
  id uuid primary key default gen_random_uuid(), name text, commissioner_id text,
  draft_status text default 'completed', created_at timestamptz not null default now(),
  league_type text not null default 'matchup', num_weeks int, current_week int default 1,
  league_start_date timestamptz, league_end_date timestamptz, playoff_teams int,
  season_status text default 'active',
  constraint valid_playoff_teams check (playoff_teams is null or playoff_teams in (2, 4, 8)));
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, role text not null default 'member',
  joined_at timestamptz not null default now(), primary key (league_id, user_id));
create table matchups (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, week_number int not null,
  team1_user_id text, team2_user_id text, team1_gain numeric, team2_gain numeric, winner_user_id text,
  week_start timestamptz, week_end timestamptz, is_playoff boolean default false, playoff_round text,
  team1_seed int, team2_seed int, is_tie boolean default false,
  unique(league_id, week_number, team1_user_id), unique(league_id, week_number, team2_user_id),
  constraint valid_playoff_round check (playoff_round is null or playoff_round in ('quarter', 'semi', 'finals')));
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
grant select on leagues, league_members, matchups, league_standings, league_seasons
  to authenticated, service_role;
`;

// deno-lint-ignore no-explicit-any
type Row = any;

/** A minimal supabase-js-shaped adapter over a real PGlite instance: only the
 * chains season-completion.ts actually issues (`.from(t).select().eq().eq()`
 * and `.rpc(name, args)`), backed by real SQL against real Postgres -- not a
 * re-implementation of the decision logic, which is the whole point: this
 * exercises the ACTUAL healUncompletedSeasons / completeLeagueSeason. */
function supabaseOverPGlite(db: PGlite) {
  const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push([col, val]); return builder; },
        then(resolve: (v: unknown) => void) {
          (async () => {
            const where = filters.length ? filters.map(([c], i) => `${c} = $${i + 1}`).join(' and ') : 'true';
            const params = filters.map(([, v]) => v);
            try {
              const rows = await q(`select * from ${table} where ${where}`, params);
              resolve({ data: rows, error: null });
            } catch (e) {
              resolve({ data: null, error: { message: (e as Error).message ?? String(e) } });
            }
          })();
        },
      };
      return builder;
    },
    // deno-lint-ignore no-explicit-any
    async rpc(name: string, args: Record<string, any>) {
      try {
        await q(`select ${name}($1, $2, $3)`, [args.p_league_id, args.p_champion_user_id, args.p_runner_up_user_id]);
        return { data: null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message ?? String(e) } };
      }
    },
  };
}

Deno.test({
  name: 'complete_league_season guard + season-completion heal on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    const sb = supabaseOverPGlite(db);

    // ---- prior state, verbatim, in the SAME order prod applied it -------------
    await db.exec(SCHEMA);
    const seasons = await mig('20260125000000_add_league_seasons.sql');
    await db.exec(slice(seasons, 'CREATE OR REPLACE FUNCTION complete_league_season(', '$$ LANGUAGE plpgsql SECURITY DEFINER;'));
    await db.exec(linesWith(await mig('20260718000002_lockdown_remaining_definer_functions.sql'),
      'FUNCTION complete_league_season(uuid, text, text)'));
    await db.exec(linesWith(await mig('20260724000002_harden_definer_search_path.sql'),
      'ALTER FUNCTION complete_league_season(uuid, text, text)'));
    await db.exec(await mig('20261011000000_league_standings_ranked.sql'));
    await db.exec(await mig('20261011000002_complete_league_season_unified_rank.sql'));
    await db.exec(await mig('20261012000000_flexible_playoffs_schema.sql'));

    const fnState = async () =>
      (await q(`select proacl::text acl, prosecdef, proconfig::text cfg from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and proname='complete_league_season'`))[0];
    const before = await fnState();

    // ---- THE MIGRATION UNDER TEST -----------------------------------------
    await db.exec(await mig('20261015000000_complete_league_season_guarded.sql'));

    await t.step('grants/security unchanged from 20261011000002: service_role only, SECURITY DEFINER, search_path pinned', async () => {
      const after = await fnState();
      assertEquals(after, before);
      assertEquals(after.prosecdef, true);
      assert(/service_role=X/.test(after.acl), after.acl);
      assert(!/anon=|authenticated=/.test(after.acl), after.acl);
      assert(!/(^|[{,])=X/.test(after.acl), `PUBLIC still has EXECUTE: ${after.acl}`);
      assert(after.cfg.includes('search_path=public'), after.cfg);
    });

    // ---- fixtures ---------------------------------------------------------
    let seq = 0;
    const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
    const START = new Date('2026-10-13T21:00:00Z'); // a Tuesday-after-regular-season date

    /** A P=4 matchup league with its regular season already finished, still
     * missing the one thing that made prod's completion call fail: a season
     * row / current_season_id. Returns the league id and the 4 member ids. */
    async function unstartedSeasonLeague() {
      const [l] = await q(
        `insert into leagues (name, league_type, num_weeks, current_week, playoff_teams, season_status)
         values ('t', 'matchup', 3, 5, 4, 'playoffs') returning id`);
      const members = [uid(), uid(), uid(), uid()];
      for (const m of members) {
        await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [l.id, m]);
        // league_standings_ranked (called by complete_league_season's snapshot)
        // reads this table; without a row per member, final_standings would
        // json_agg over zero rows and come back NULL.
        await q(`insert into league_standings (league_id, user_id, wins, losses, ties, points_for) values ($1,$2,0,0,0,0)`, [l.id, m]);
      }
      return { leagueId: l.id as string, members };
    }

    /** Insert a bracket (real buildPlayoffBracket) and drive it to a scored
     * final via the real planAdvance addressing, exactly as
     * flexible_playoffs.pglite.test.ts's tournament step does. The lower seed
     * number wins every game, so seed 1 (members[0]) always wins the whole
     * bracket. Returns { championUserId, runnerUpUserId }. */
    async function scoreToFinal(leagueId: string, members: string[]) {
      const bracket: PlayoffBracketRow[] = buildPlayoffBracket(members.map((user_id) => ({ user_id })), START, 4);
      for (const r of bracket) {
        await q(
          `insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_seed, team2_seed,
             week_start, week_end, is_playoff, playoff_round, playoff_round_number, bracket_position)
           values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11)`,
          [leagueId, r.week_number, r.team1_user_id, r.team2_user_id, r.team1_seed, r.team2_seed,
            r.week_start, r.week_end, r.playoff_round, r.playoff_round_number, r.bracket_position]);
      }
      const { weeks } = playoffShape(members.length);
      let champion = '';
      for (let round = 1; round <= weeks; round++) {
        const games = await q(
          `select id, bracket_position pos, team1_user_id t1, team2_user_id t2, team1_seed s1, team2_seed s2
           from matchups where league_id=$1 and is_playoff and playoff_round_number=$2 order by pos`,
          [leagueId, round]);
        for (const g of games) {
          // Lower seed number wins every game (P=4 and P=8 here have zero byes,
          // so s1/s2 are always both non-null): the top seed (members[0]) wins
          // the whole bracket, all the way through the final.
          const winner = g.s1 < g.s2 ? g.t1 : g.t2;
          await q(`update matchups set team1_gain=10, team2_gain=0, winner_user_id=$2 where id=$1`, [g.id, winner]);
          const plan = planAdvance(
            { roundNumber: round, position: g.pos, team1UserId: g.t1, team2UserId: g.t2, team1Seed: g.s1, team2Seed: g.s2 },
            winner, weeks);
          if (plan.kind === 'final') { champion = winner; continue; }
          const col = plan.slot === 'team1' ? 'team1_user_id' : 'team2_user_id';
          const seedCol = plan.slot === 'team1' ? 'team1_seed' : 'team2_seed';
          await q(`update matchups set ${col}=$1, ${seedCol}=$2 where league_id=$3 and is_playoff
            and playoff_round_number=$4 and bracket_position=$5 and ${col} is null`,
            [winner, plan.seed, leagueId, plan.round, plan.position]);
        }
      }
      const runnerUp = members.find((m) => m !== champion)!;
      return { championUserId: champion, runnerUpUserId: runnerUp };
    }

    // =========================================================================
    // Guard refusals -- each writes nothing (league_seasons / leagues unchanged)
    // =========================================================================

    await t.step('refuses a league with no current_season_id (the exact prod cause, 20260926000000)', async () => {
      const { leagueId, members } = await unstartedSeasonLeague();
      const { championUserId, runnerUpUserId } = await scoreToFinal(leagueId, members);
      await assertRejects(
        () => q(`select complete_league_season($1,$2,$3)`, [leagueId, championUserId, runnerUpUserId]),
        Error, 'League has no active season',
      );
      const [l] = await q(`select season_status from leagues where id=$1`, [leagueId]);
      assertEquals(l.season_status, 'playoffs'); // unchanged: the refusal wrote nothing
    });

    async function seasonedLeague(seasonStatus = 'playoffs') {
      const { leagueId, members } = await unstartedSeasonLeague();
      await q(`update leagues set season_status=$2 where id=$1`, [leagueId, seasonStatus]);
      const [s] = await q(`insert into league_seasons (league_id, season_number) values ($1,1) returning id`, [leagueId]);
      await q(`update leagues set current_season_id=$2 where id=$1`, [leagueId, s.id]);
      return { leagueId, members, seasonId: s.id as string };
    }

    await t.step('refuses a league not in season_status=playoffs (e.g. still active)', async () => {
      const { leagueId, members } = await seasonedLeague('active');
      const { championUserId, runnerUpUserId } = await scoreToFinal(leagueId, members);
      await assertRejects(
        () => q(`select complete_league_season($1,$2,$3)`, [leagueId, championUserId, runnerUpUserId]),
        Error, 'is not in playoffs',
      );
    });

    await t.step('refuses a final that is not scored yet', async () => {
      const { leagueId, members } = await seasonedLeague();
      const bracket = buildPlayoffBracket(members.map((user_id) => ({ user_id })), START, 4);
      for (const r of bracket) {
        await q(
          `insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_seed, team2_seed,
             week_start, week_end, is_playoff, playoff_round, playoff_round_number, bracket_position)
           values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11)`,
          [leagueId, r.week_number, r.team1_user_id, r.team2_user_id, r.team1_seed, r.team2_seed,
            r.week_start, r.week_end, r.playoff_round, r.playoff_round_number, r.bracket_position]);
      }
      await assertRejects(
        () => q(`select complete_league_season($1,$2,$3)`, [leagueId, members[0], members[1]]),
        Error, 'is not scored yet',
      );
    });

    await t.step('refuses a champion that does not match the scored final winner', async () => {
      const { leagueId, members } = await seasonedLeague();
      const { runnerUpUserId } = await scoreToFinal(leagueId, members);
      await assertRejects(
        () => q(`select complete_league_season($1,$2,$3)`, [leagueId, 'not-the-winner', runnerUpUserId]),
        Error, 'does not match the scored final winner',
      );
    });

    await t.step('refuses a runner-up that does not match the scored final loser', async () => {
      const { leagueId, members } = await seasonedLeague();
      const { championUserId } = await scoreToFinal(leagueId, members);
      await assertRejects(
        () => q(`select complete_league_season($1,$2,$3)`, [leagueId, championUserId, 'not-the-loser']),
        Error, 'does not match the scored final loser',
      );
    });

    await t.step('refuses a NULL champion/runner-up parameter (security review: <> vs NULL is UNKNOWN, never a silent pass)', async () => {
      // p_champion_user_id/p_runner_up_user_id are caller-supplied, unlike
      // v_final.winner_user_id (verified above via explicit IS NULL checks
      // before <>). A plain `<>` against a NULL PARAMETER evaluates to
      // NULL/UNKNOWN, which an IF treats as not-true -- the guard must use
      // IS DISTINCT FROM here, or a NULL champion/runner-up would slip past
      // the refusal and get written into league_seasons.
      const { leagueId, members } = await seasonedLeague();
      const { championUserId, runnerUpUserId } = await scoreToFinal(leagueId, members);
      await assertRejects(
        () => q(`select complete_league_season($1,$2,$3)`, [leagueId, null, runnerUpUserId]),
        Error, 'does not match the scored final winner',
      );
      await assertRejects(
        () => q(`select complete_league_season($1,$2,$3)`, [leagueId, championUserId, null]),
        Error, 'does not match the scored final loser',
      );
      const [l] = await q(`select season_status from leagues where id=$1`, [leagueId]);
      assertEquals(l.season_status, 'playoffs'); // neither call wrote anything
    });

    await t.step('idempotent: a re-call with the SAME champion/runner-up on an already-completed season is a no-op success', async () => {
      const { leagueId, members } = await seasonedLeague();
      const { championUserId, runnerUpUserId } = await scoreToFinal(leagueId, members);
      await q(`select complete_league_season($1,$2,$3)`, [leagueId, championUserId, runnerUpUserId]);
      const [before] = await q(`select completed_at, final_standings from league_seasons where league_id=$1`, [leagueId]);
      assert(before.completed_at, 'expected the first call to complete the season');
      await q(`select complete_league_season($1,$2,$3)`, [leagueId, championUserId, runnerUpUserId]); // re-call
      const [after] = await q(`select completed_at, final_standings from league_seasons where league_id=$1`, [leagueId]);
      assertEquals(after.completed_at, before.completed_at); // untouched by the retry
      assertEquals(after.final_standings, before.final_standings);
    });

    await t.step('a re-call with a DIFFERENT champion on an already-completed season refuses, never silently overwrites', async () => {
      const { leagueId, members } = await seasonedLeague();
      const { championUserId, runnerUpUserId } = await scoreToFinal(leagueId, members);
      await q(`select complete_league_season($1,$2,$3)`, [leagueId, championUserId, runnerUpUserId]);
      await assertRejects(
        () => q(`select complete_league_season($1,$2,$3)`, [leagueId, runnerUpUserId, championUserId]),
        Error, 'already completed with a different result',
      );
    });

    // =========================================================================
    // THE HEAL, end-to-end, through the REAL healUncompletedSeasons /
    // completeLeagueSeason (season-completion.ts) -- not a re-implementation.
    // =========================================================================

    await t.step('E2E: run 1 fails (no season row) and is reported; the league stays healable, never stranded silently', async () => {
      const { leagueId, members } = await unstartedSeasonLeague(); // no current_season_id -- the prod cause
      await scoreToFinal(leagueId, members);

      const refusals = await healUncompletedSeasons(sb, null);
      const mine = refusals.filter((r: Row) => r.league_id === leagueId);
      assertEquals(mine.length, 1);
      assert(mine[0].reason.includes('complete_league_season_failed'), mine[0].reason);
      assert(mine[0].reason.includes('League has no active season'), mine[0].reason);

      const [l] = await q(`select season_status from leagues where id=$1`, [leagueId]);
      assertEquals(l.season_status, 'playoffs'); // still healable next run -- NOT stranded

      // ---- fix the underlying data (what a human/other migration would do) ----
      const [s] = await q(`insert into league_seasons (league_id, season_number) values ($1,1) returning id`, [leagueId]);
      await q(`update leagues set current_season_id=$2 where id=$1`, [leagueId, s.id]);

      // ---- run 2: the SAME heal, now succeeds ----
      const refusals2 = await healUncompletedSeasons(sb, null);
      assertEquals(refusals2.filter((r: Row) => r.league_id === leagueId), []);

      const [l2] = await q(`select season_status from leagues where id=$1`, [leagueId]);
      assertEquals(l2.season_status, 'completed');
      const [season] = await q(`select champion_user_id, runner_up_user_id, completed_at, final_standings
        from league_seasons where id=$1`, [s.id]);
      assertEquals(season.champion_user_id, members[0]); // seed 1 won every game in scoreToFinal
      assert(season.completed_at);
      assert(season.final_standings); // json_agg from league_standings_ranked, non-null

      // ---- run 3: the league is no longer 'playoffs', so the heal leaves it
      // alone -- no repeat rpc call, no refusal, no change.
      const before3 = season.completed_at;
      const refusals3 = await healUncompletedSeasons(sb, null);
      assertEquals(refusals3.filter((r: Row) => r.league_id === leagueId), []);
      const [l3] = await q(`select season_status from leagues where id=$1`, [leagueId]);
      const [season3] = await q(`select completed_at from league_seasons where id=$1`, [s.id]);
      assertEquals(l3.season_status, 'completed');
      assertEquals(season3.completed_at, before3);
    });

    // MUTATION CHECK: if healUncompletedSeasons (or its wiring to
    // completeLeagueSeason's rpc check) were removed/no-opped, this league
    // would never leave season_status='playoffs' -- reproduce that directly by
    // calling the RPC in the old "log and ignore" style the bug used, and show
    // it does NOT reach 'completed' on its own without the heal's retry.
    await t.step('MUTATION CHECK: without the heal, a failed completion truly never recovers on its own', async () => {
      const { leagueId, members } = await unstartedSeasonLeague();
      const { championUserId, runnerUpUserId } = await scoreToFinal(leagueId, members);
      // The OLD bug: call the rpc once, ignore the error (exactly what
      // completeSeasonFromPlayoffs used to do), and never retry.
      try {
        await q(`select complete_league_season($1,$2,$3)`, [leagueId, championUserId, runnerUpUserId]);
      } catch { /* old code: caught and only logged */ }
      const [l] = await q(`select season_status from leagues where id=$1`, [leagueId]);
      assertEquals(l.season_status, 'playoffs'); // confirms the failure mode this migration/heal fixes
      // Now show the REAL fix recovers it: fix the data, then heal.
      const [s] = await q(`insert into league_seasons (league_id, season_number) values ($1,1) returning id`, [leagueId]);
      await q(`update leagues set current_season_id=$2 where id=$1`, [leagueId, s.id]);
      const refusals = await healUncompletedSeasons(sb, null);
      assertEquals(refusals.filter((r: Row) => r.league_id === leagueId), []);
      const [l2] = await q(`select season_status from leagues where id=$1`, [leagueId]);
      assertEquals(l2.season_status, 'completed');
    });

    await t.step('completeLeagueSeason (the TS wrapper) surfaces the same rpc error the heal reads', async () => {
      const { leagueId, members } = await unstartedSeasonLeague();
      const { championUserId, runnerUpUserId } = await scoreToFinal(leagueId, members);
      const res = await completeLeagueSeason(sb, leagueId, championUserId, runnerUpUserId);
      assertEquals(res.ok, false);
      if (!res.ok) assert(res.reason.includes('League has no active season'), res.reason);
    });

    await t.step('P=8 sweep through the real heal (bigger bracket, more rounds)', async () => {
      const [l] = await q(
        `insert into leagues (name, league_type, num_weeks, current_week, playoff_teams, season_status)
         values ('t8', 'matchup', 3, 6, 8, 'playoffs') returning id`);
      const members = Array.from({ length: 8 }, () => uid());
      for (const m of members) {
        await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [l.id, m]);
        await q(`insert into league_standings (league_id, user_id, wins, losses, ties, points_for) values ($1,$2,0,0,0,0)`, [l.id, m]);
      }
      const [s] = await q(`insert into league_seasons (league_id, season_number) values ($1,1) returning id`, [l.id]);
      await q(`update leagues set current_season_id=$2 where id=$1`, [l.id, s.id]);
      await scoreToFinal(l.id, members);

      const refusals = await healUncompletedSeasons(sb, l.id);
      assertEquals(refusals, []);
      const [after] = await q(`select season_status from leagues where id=$1`, [l.id]);
      assertEquals(after.season_status, 'completed');
      const [season] = await q(`select champion_user_id, final_standings from league_seasons where id=$1`, [s.id]);
      assertEquals(season.champion_user_id, members[0]);
      assert(season.final_standings);
    });
  },
});
