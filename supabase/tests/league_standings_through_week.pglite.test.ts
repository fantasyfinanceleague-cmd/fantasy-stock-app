/**
 * league_standings_ranked(p_league_id, p_through_week) against REAL Postgres
 * (PGlite). NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * Loaded VERBATIM: the 1-arg ranking (20261011000000) and the through-week
 * overload (20261030000000). Standings are DERIVED from matchups in this test
 * the way process-week-results writes them (bye = points_for only; playoff
 * rows add nothing), so the one-arg and through-latest answers must agree by
 * construction, and this checks the algorithm, not hand-typed numbers.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const mig = (name: string) => Deno.readTextFile(new URL(`supabase/migrations/${name}`, ROOT));

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create table leagues (id uuid primary key default gen_random_uuid(), name text);
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, role text not null default 'member',
  joined_at timestamptz not null default now(), primary key (league_id, user_id));
create table matchups (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, week_number int not null,
  team1_user_id text, team2_user_id text, team1_gain numeric, team2_gain numeric, winner_user_id text,
  is_tie boolean default false, is_playoff boolean default false, playoff_round text);
create table league_standings (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, wins numeric(5,1) not null default 0, losses numeric(5,1) not null default 0,
  ties numeric(5,1) not null default 0, points_for numeric(12,2) not null default 0,
  points_against numeric(12,2) not null default 0, updated_at timestamptz not null default now(),
  primary key (league_id, user_id));
grant select on leagues, league_members, matchups, league_standings to authenticated, service_role;
`;

// deno-lint-ignore no-explicit-any
type Row = any;

// Four managers, joined A, B, C, D. Regular-season games in weeks 1-3, one
// bye (B, week 2), a tie (C v D, week 1), and a playoff row (week 4) that must
// never count.
const GAMES: Array<[number, string, string | null, number, number | null, string | null, boolean, boolean]> = [
  // week, team1, team2, team1_gain, team2_gain, winner, is_tie, is_playoff
  [1, 'A', 'B', 10, -5, 'A', false, false],
  [1, 'C', 'D', 3, 3, null, true, false],
  [2, 'A', 'C', 4, -1, 'A', false, false],
  [2, 'B', null, 7, null, null, false, false], // bye: a result, no W/L/T
  [3, 'B', 'D', 2, 8, 'D', false, false],
  [4, 'A', 'D', 100, -100, 'A', false, true], // playoff: never in standings
];

Deno.test({
  name: 'league_standings_ranked through-week on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    await db.exec(SCHEMA);
    await db.exec(await mig('20261011000000_league_standings_ranked.sql'));
    await db.exec(await mig('20261030000000_league_standings_ranked_through_week.sql'));

    const [{ id: lg }] = await q(`insert into leagues (name) values ('t') returning id`);
    for (const [i, u] of ['A', 'B', 'C', 'D'].entries()) {
      await q(`insert into league_members (league_id, user_id, joined_at) values ($1,$2, '2026-09-01T00:00Z'::timestamptz + ($3 || ' minutes')::interval)`, [lg, u, String(i)]);
    }
    for (const [week, t1, t2, g1, g2, winner, tie, playoff] of GAMES) {
      await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id, is_tie, is_playoff)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [lg, week, t1, t2, g1, g2, winner, tie, playoff]);
    }
    // Derive league_standings from matchups, as the server writes it: regular
    // season only; a bye adds points_for only; a scored game adds W/L/T.
    for (const u of ['A', 'B', 'C', 'D']) {
      const rows = await q(`
        select
          count(*) filter (where team2_user_id is not null and winner_user_id = $2) w,
          count(*) filter (where team2_user_id is not null and winner_user_id is not null and winner_user_id <> $2) l,
          count(*) filter (where team2_user_id is not null and is_tie) t,
          coalesce(sum(case when team1_user_id = $2 then team1_gain else team2_gain end), 0) pf
        from matchups where league_id = $1 and not is_playoff and team1_gain is not null
          and ($2 in (team1_user_id, team2_user_id))`, [lg, u]);
      const r = rows[0];
      await q(`insert into league_standings (league_id, user_id, wins, losses, ties, points_for) values ($1,$2,$3,$4,$5,$6)`,
        [lg, u, r.w, r.l, r.t, r.pf]);
    }

    // numeric columns come back as strings from PGlite; normalise so the
    // comparisons check values, not their text.
    const num = (rows: Row[]) => rows.map((r) => ({
      ...r, wins: Number(r.wins), losses: Number(r.losses), ties: Number(r.ties),
      games_played: Number(r.games_played), points_for: Number(r.points_for),
    }));
    const ranked = async (week: number | null) => num(week === null
      ? await q(`select user_id, rank, wins, losses, ties, games_played, points_for from league_standings_ranked($1) order by rank`, [lg])
      : await q(`select user_id, rank, wins, losses, ties, games_played, points_for from league_standings_ranked($1, $2) order by rank`, [lg, week]));

    await t.step('through the latest scored regular-season week equals the one-arg ranking', async () => {
      const latest = await ranked(3);
      const oneArg = await ranked(null);
      assertEquals(latest, oneArg);
      // Playoff week 4 is excluded even when asked for.
      assertEquals(await ranked(4), oneArg);
    });

    await t.step('a bye adds points only: no W/L/T and no games played', async () => {
      const b = (await ranked(2)).find((r: Row) => r.user_id === 'B')!;
      assertEquals([b.wins, b.losses, b.ties, b.games_played], [0, 1, 0, 1]); // only week 1's loss
      assertEquals(Number(b.points_for), -5 + 7); // week 1 loss + the week-2 bye gain
    });

    await t.step('as of week 1 the order is the week-1 standings (tie on 0.5 broken by season gain, then join order)', async () => {
      const w1 = await ranked(1);
      assertEquals(w1.map((r: Row) => r.user_id), ['A', 'C', 'D', 'B']);
      assertEquals(w1.map((r: Row) => r.rank), [1, 2, 3, 4]);
    });

    await t.step('ranks are strictly 1..N at every week', async () => {
      for (const week of [1, 2, 3]) {
        const r = await ranked(week);
        assertEquals(r.map((x: Row) => x.rank), [1, 2, 3, 4]);
      }
    });

    await t.step('grants: no anon, no PUBLIC, on either overload; the private core is not callable by anon', async () => {
      const acl = await q(`select pg_get_function_identity_arguments(p.oid) args, proacl::text acl from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname = 'league_standings_ranked'`);
      assertEquals(acl.length, 2);
      for (const row of acl) {
        assert(!row.acl.includes('anon='), `anon grant on ${row.args}: ${row.acl}`);
        assert(!/(^|[{,])=/.test(row.acl), `PUBLIC grant on ${row.args}: ${row.acl}`);
      }
      const core = await q(`select proacl::text acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname = '_league_standings_rank_core'`);
      assert(core.length === 1 && !core[0].acl.includes('anon='), 'core must not be anon-callable');
    });
  },
});
