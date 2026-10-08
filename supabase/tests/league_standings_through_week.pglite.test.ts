/**
 * league_standings_ranked(p_league_id, p_through_week) against REAL Postgres
 * (PGlite). NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * Loaded VERBATIM: the 1-arg ranking (20261011000000) and the through-week
 * overload (20261112000000). Standings are DERIVED from matchups in this test
 * the way process-week-results writes them (bye = points_for only; playoff
 * rows add nothing), so the one-arg and through-latest answers must agree by
 * construction, and this checks the algorithm, not hand-typed numbers.
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

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
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

// The prod SELECT policies the ranking runs under (20260712000004/5,
// 20260811000005): league-wide for members, nothing for anyone else.
const RLS = `
alter table league_standings enable row level security;
alter table matchups enable row level security;
alter table league_members enable row level security;
create policy league_standings_select_members on league_standings for select to authenticated using (is_member(league_id));
create policy matchups_select_members on matchups for select to authenticated using (is_member(league_id));
create policy league_members_select_members on league_members for select
  using (is_member(league_id) or user_id = (auth.uid())::text);
`;

// deno-lint-ignore no-explicit-any
type Row = any;

// auth.uid() is a uuid in production, so members get uuid ids. The letters
// below are only labels; `letter` maps results back for readable assertions.
const UID: Record<string, string> = {
  A: '00000000-0000-4000-8000-00000000000a',
  B: '00000000-0000-4000-8000-00000000000b',
  C: '00000000-0000-4000-8000-00000000000c',
  D: '00000000-0000-4000-8000-00000000000d',
  Z: '00000000-0000-4000-8000-00000000000f',
};
const letter = (id: string) => Object.keys(UID).find((k) => UID[k] === id) ?? id;

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
    const helpers = await mig('20260712000000_rls_b1_00_helpers.sql');
    await db.exec(slice(helpers, 'create or replace function public.is_member(', '$$;'));
    await db.exec(await mig('20261011000000_league_standings_ranked.sql'));
    const oneArgAclBefore = (await q(`select proacl::text acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and proname = 'league_standings_ranked'`))[0].acl;
    await db.exec(await mig('20261112000000_league_standings_ranked_through_week.sql'));
    await db.exec(RLS);

    const [{ id: lg }] = await q(`insert into leagues (name) values ('t') returning id`);
    for (const [i, u] of ['A', 'B', 'C', 'D'].entries()) {
      await q(`insert into league_members (league_id, user_id, joined_at) values ($1,$2, '2026-09-01T00:00Z'::timestamptz + ($3 || ' minutes')::interval)`, [lg, UID[u], String(i)]);
    }
    const id = (x: string | null) => (x === null ? null : UID[x]);
    for (const [week, t1, t2, g1, g2, winner, tie, playoff] of GAMES) {
      await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id, is_tie, is_playoff)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [lg, week, id(t1), id(t2), g1, g2, id(winner), tie, playoff]);
    }
    // Derive league_standings from matchups, as the server writes it: regular
    // season only; a bye adds points_for only; a scored game adds W/L/T.
    for (const u of ['A', 'B', 'C', 'D']) {
      const uid = UID[u];
      const rows = await q(`
        select
          count(*) filter (where team2_user_id is not null and winner_user_id = $2) w,
          count(*) filter (where team2_user_id is not null and winner_user_id is not null and winner_user_id <> $2) l,
          count(*) filter (where team2_user_id is not null and is_tie) t,
          coalesce(sum(case when team1_user_id = $2 then team1_gain else team2_gain end), 0) pf,
          coalesce(sum(case when team1_user_id = $2 then coalesce(team2_gain, 0) else team1_gain end), 0) pa
        from matchups where league_id = $1 and not is_playoff and team1_gain is not null
          and ($2 in (team1_user_id, team2_user_id))`, [lg, uid]);
      const r = rows[0];
      await q(`insert into league_standings (league_id, user_id, wins, losses, ties, points_for, points_against) values ($1,$2,$3,$4,$5,$6,$7)`,
        [lg, uid, r.w, r.l, r.t, r.pf, r.pa]);
    }

    // numeric columns come back as strings from PGlite; normalise so the
    // comparisons check values, not their text.
    const num = (rows: Row[]) => rows.map((r) => ({
      ...r, user_id: letter(r.user_id), wins: Number(r.wins), losses: Number(r.losses), ties: Number(r.ties),
      games_played: Number(r.games_played), points_for: Number(r.points_for), points_against: Number(r.points_against),
    }));
    const ranked = async (week: number | null) => num(week === null
      ? await q(`select user_id, rank, wins, losses, ties, games_played, points_for, points_against from league_standings_ranked($1) order by rank`, [lg])
      : await q(`select user_id, rank, wins, losses, ties, games_played, points_for, points_against from league_standings_ranked($1, $2) order by rank`, [lg, week]));

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

    await t.step('as of week 1 the order is the week-1 standings (C and D tie on 0.5 with equal season gain: join order decides)', async () => {
      const w1 = await ranked(1);
      assertEquals(w1.map((r: Row) => r.user_id), ['A', 'C', 'D', 'B']);
      assertEquals(w1.map((r: Row) => r.rank), [1, 2, 3, 4]);
    });

    await t.step('as of week 2 the order and values are exact (the bye counts for points only)', async () => {
      // A 2-0 (1.0, pf 14); D 0-0-1 + 0 (0.5, pf 3); C 0-1-1 (0.25, pf 2); B 0-1, bye (0, pf 2).
      const w2 = await ranked(2);
      assertEquals(w2.map((r: Row) => r.user_id), ['A', 'D', 'C', 'B']);
      assertEquals(w2.map((r: Row) => Number(r.points_for)), [14, 3, 2, 2]);
      // points_against = the opponent's gain: A -5 (wk1) + -1 (wk2); D 3; C 3 + 4; B 10 (wk1), 0 (bye).
      assertEquals(w2.map((r: Row) => Number(r.points_against)), [-6, 3, 7, 10]);
    });

    await t.step('ranks are strictly 1..N at every week', async () => {
      for (const week of [1, 2, 3]) {
        const r = await ranked(week);
        assertEquals(r.map((x: Row) => x.rank), [1, 2, 3, 4]);
      }
    });

    await t.step('the 1-arg ranking ACL is unchanged by the migration', async () => {
      const after = (await q(`select proacl::text acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname = 'league_standings_ranked' and pronargs = 1`))[0].acl;
      assertEquals(after, oneArgAclBefore);
    });

    await t.step('grants: no anon, no PUBLIC, on either overload; the private core is not anon-callable', async () => {
      const acl = await q(`select pg_get_function_identity_arguments(p.oid) args, proacl::text acl from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname = 'league_standings_ranked'`);
      assertEquals(acl.length, 2);
      for (const row of acl) {
        assert(!row.acl.includes('anon='), `anon grant on ${row.args}: ${row.acl}`);
        assert(!/(^|[{,])=/.test(row.acl), `PUBLIC grant on ${row.args}: ${row.acl}`);
        // Positive: the two roles that should call it, and only they.
        assert(row.acl.includes('authenticated=X'), `authenticated not granted on ${row.args}: ${row.acl}`);
        assert(row.acl.includes('service_role=X'), `service_role not granted on ${row.args}: ${row.acl}`);
      }
      const core = await q(`select proacl::text acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname = '_league_standings_rank_core'`);
      assert(core.length === 1 && !core[0].acl.includes('anon='), 'core must not be anon-callable');
      assert(!/(^|[{,])=/.test(core[0].acl), 'core must not be PUBLIC-callable');
    });

    // Call-time checks: ACL text can say "no anon" and still be wrong, so the
    // functions are actually invoked as each role.
    const asRole = async (role: 'anon' | 'authenticated', sub: string | null) => {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ''}', false)`);
      await db.exec(`set role ${role}`);
    };
    const callAs = async (role: 'anon' | 'authenticated', sub: string | null, week: number) => {
      await asRole(role, sub === null ? null : UID[sub] ?? sub);
      try {
        return num(await q(`select user_id, rank from league_standings_ranked($1, $2) order by rank`, [lg, week]));
      } finally {
        await db.exec('reset role');
      }
    };

    await t.step('a member gets the full through-week ranking', async () => {
      // Through week 3: A 2-0 (1.0); D 1-0-1 (0.75); C 0-1-1 (0.25); B 0-2 (0), bye ignored.
      const rows = await callAs('authenticated', 'A', 3);
      assertEquals(rows.map((r: Row) => r.user_id), ['A', 'D', 'C', 'B']);
    });

    await t.step('a non-member gets zero rows from the overload (RLS, not an error)', async () => {
      assertEquals((await callAs('authenticated', 'Z', 3)).length, 0);
    });

    await t.step('anon is refused at the grant (42501), not given an empty table', async () => {
      await asRole('anon', null);
      try {
        await assertRejects(() => q(`select * from league_standings_ranked($1, $2)`, [lg, 3]), 'permission denied');
      } finally {
        await db.exec('reset role');
      }
    });

    await t.step('a NULL or negative week is refused, never an all-zero table', async () => {
      await asRole('authenticated', UID.A);
      try {
        await assertRejects(() => q(`select * from league_standings_ranked($1, null::int)`, [lg]), 'p_through_week must be >= 0');
        await assertRejects(() => q(`select * from league_standings_ranked($1, -1)`, [lg]), 'p_through_week must be >= 0');
      } finally {
        await db.exec('reset role');
      }
    });
  },
});

// ---------------------------------------------------------------------------
// The order-sensitive branches of the core (F4, Orchestrator 2026-10-05):
// (1) head-to-head SEPARATES a win-% tie, and a join order / season gain
//     fixture would put the other manager first;
// (2) an UNBALANCED set (not every pair met the same number of times) skips
//     head-to-head and falls through to season gain.
// Both assert through-latest == 1-arg, so the overload matches the ranking.
// ---------------------------------------------------------------------------

type Game = [number, string, string | null, number, number | null, string | null, boolean];

/** A fresh database with the 1-arg and the through-week overload loaded verbatim. */
async function freshDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(await mig('20261011000000_league_standings_ranked.sql'));
  await db.exec(await mig('20261112000000_league_standings_ranked_through_week.sql'));
  return db;
}

/** A league whose standings are derived from its matchups, as the server
 * writes them. `members` is the join order. Returns the league id. */
async function derivedLeague(db: PGlite, members: string[], games: Game[]): Promise<string> {
  const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
  const uid = (name: string) => `00000000-0000-4000-8000-${name.charCodeAt(0).toString(16).padStart(12, '0')}`;
  const [{ id: lg }] = await q(`insert into leagues (name) values ('t') returning id`);
  for (const [i, m] of members.entries()) {
    await q(`insert into league_members (league_id, user_id, joined_at) values ($1,$2, '2026-09-01T00:00Z'::timestamptz + ($3 || ' minutes')::interval)`,
      [lg, uid(m), String(i)]);
  }
  for (const [week, t1, t2, g1, g2, winner, tie] of games) {
    await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id, is_tie, is_playoff)
      values ($1,$2,$3,$4,$5,$6,$7,$8,false)`,
      [lg, week, uid(t1), t2 === null ? null : uid(t2), g1, g2, winner === null ? null : uid(winner), tie]);
  }
  for (const m of members) {
    const rows = await q(`
      select
        count(*) filter (where team2_user_id is not null and winner_user_id = $2) w,
        count(*) filter (where team2_user_id is not null and winner_user_id is not null and winner_user_id <> $2) l,
        count(*) filter (where team2_user_id is not null and is_tie) t,
        coalesce(sum(case when team1_user_id = $2 then team1_gain else team2_gain end), 0) pf,
        coalesce(sum(case when team1_user_id = $2 then coalesce(team2_gain, 0) else team1_gain end), 0) pa
      from matchups where league_id = $1 and not is_playoff and team1_gain is not null
        and ($2 in (team1_user_id, team2_user_id))`, [lg, uid(m)]);
    const r = rows[0];
    await q(`insert into league_standings (league_id, user_id, wins, losses, ties, points_for, points_against) values ($1,$2,$3,$4,$5,$6,$7)`,
      [lg, uid(m), r.w, r.l, r.t, r.pf, r.pa]);
  }
  return lg;
}

/** Both rankings for a league, as {user letter, rank} rows, plus the check
 * that they are identical. */
async function bothRankings(db: PGlite, lg: string, weeks: number) {
  const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
  const letterOf = (id: string) => String.fromCharCode(parseInt(id.slice(-12), 16));
  const pick = (rows: Row[]) => rows.map((r) => ({ u: letterOf(r.user_id), rank: Number(r.rank), pf: Number(r.points_for), pa: Number(r.points_against), gp: Number(r.games_played) }));
  const oneArg = pick(await q(`select user_id, rank, points_for, points_against, games_played from league_standings_ranked($1) order by rank`, [lg]));
  const through = pick(await q(`select user_id, rank, points_for, points_against, games_played from league_standings_ranked($1, $2) order by rank`, [lg, weeks]));
  return { oneArg, through };
}

Deno.test({
  name: 'league_standings_ranked: head-to-head separates a win-% tie; unbalanced sets fall to season gain',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    // (1) Q and R both finish 1-1 (win % 0.5). Q beat R head-to-head. R joined
    // FIRST and has the bigger season gain, so only head-to-head puts Q ahead.
    await t.step('head-to-head separates a win-% tie, ahead of join order and season gain', async () => {
      const db = await freshDb();
      const lg = await derivedLeague(db, ['P', 'R', 'Q', 'S'], [
        [1, 'Q', 'R', 5, -2, 'Q', false],
        [1, 'P', 'S', 4, -4, 'P', false],
        [2, 'P', 'Q', 3, -1, 'P', false],
        [2, 'R', 'S', 20, -20, 'R', false],
      ]);
      const { oneArg, through } = await bothRankings(db, lg, 2);
      assertEquals(through, oneArg);
      assertEquals(through.map((r) => r.u), ['P', 'Q', 'R', 'S']);
      await db.close();
    });

    // (2) A 4-cycle: each manager 1-1, but only four of the six pairs met, so
    // the set is unbalanced and head-to-head is skipped. Season gain decides:
    // Z 27, W 14, X 5, Y 4 (join order would have been W, X, Y, Z).
    await t.step('an unbalanced tied set skips head-to-head and falls to season gain', async () => {
      const db = await freshDb();
      const lg = await derivedLeague(db, ['W', 'X', 'Y', 'Z'], [
        [1, 'W', 'X', 20, -5, 'W', false],
        [2, 'X', 'Y', 10, -8, 'X', false],
        [3, 'Y', 'Z', 12, -3, 'Y', false],
        [4, 'Z', 'W', 30, -6, 'Z', false],
      ]);
      const { oneArg, through } = await bothRankings(db, lg, 4);
      assertEquals(through, oneArg);
      assertEquals(through.map((r) => r.u), ['Z', 'W', 'X', 'Y']);
      await db.close();
    });
  },
});
