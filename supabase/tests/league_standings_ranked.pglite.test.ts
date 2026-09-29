/**
 * league_standings_ranked (+ the get_home_summary / complete_league_season
 * re-creates) against REAL Postgres (PGlite = Postgres 16 in WASM).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * What is loaded VERBATIM (never retyped):
 *   - the three 20261011* migrations under test;
 *   - the pre-existing state they replace, so "unchanged grants" is measured
 *     against the real prior definitions: 20261004000000 + 20261004000001 whole,
 *     and complete_league_season sliced out of 20260125000000 with its lockdown
 *     grants (20260718000002) and search_path pin (20260724000002);
 *   - the is_member() RLS helper sliced out of 20260712000000.
 * Supabase's default anon/authenticated/service_role EXECUTE grants are
 * simulated, so the proacl assertions prove the explicit revokes work.
 *
 * The ranking rule under test (see the 20261011000000 header):
 *   win% = (W + 0.5*T) / (W+L+T), byes excluded -> balanced mini-league H2H (recursive) -> points_for
 *   -> joined_at -> user_id; ranks strictly 1..N.
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
/** Every line of `src` containing `needle`, verbatim. */
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
  team1_user_id text, team2_user_id text, team1_gain numeric, team2_gain numeric, winner_user_id text,
  week_start timestamptz, week_end timestamptz, is_playoff boolean default false, playoff_round text,
  is_tie boolean default false);
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
grant select on leagues, league_members, matchups, league_standings, league_seasons, user_profiles
  to authenticated, service_role;
`;

// The prod SELECT policies on the three tables the ranking reads
// (20260712000004/5, 20260811000005). All league-wide for members.
const RLS = `
alter table league_standings enable row level security;
alter table matchups enable row level security;
alter table league_members enable row level security;
create policy league_standings_select_members on league_standings for select to authenticated using (is_member(league_id));
create policy matchups_select_members on matchups for select to authenticated using (is_member(league_id));
create policy league_members_select_members on league_members for select
  using (is_member(league_id) or user_id = (auth.uid())::text);
`;

const FNS = ['league_standings_ranked', 'get_home_summary', 'complete_league_season'];

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'league_standings_ranked on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];

    // ---- prior state, verbatim ------------------------------------------------
    await db.exec(SCHEMA);
    const helpers = await mig('20260712000000_rls_b1_00_helpers.sql');
    await db.exec(slice(helpers, 'create or replace function public.is_member(', '$$;'));
    await db.exec(RLS);
    await db.exec(await mig('20261004000000_participant_display_names.sql'));
    await db.exec(await mig('20261004000001_get_home_summary_rpc.sql'));
    const seasons = await mig('20260125000000_add_league_seasons.sql');
    await db.exec(slice(seasons, 'CREATE OR REPLACE FUNCTION complete_league_season(', '$$ LANGUAGE plpgsql SECURITY DEFINER;'));
    await db.exec(linesWith(await mig('20260718000002_lockdown_remaining_definer_functions.sql'),
      'FUNCTION complete_league_season(uuid, text, text)'));
    await db.exec(linesWith(await mig('20260724000002_harden_definer_search_path.sql'),
      'ALTER FUNCTION complete_league_season(uuid, text, text)'));

    const fnState = async (name: string) =>
      (await q(`select proacl::text acl, prosecdef, proconfig::text cfg from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and proname=$1`, [name]))[0];

    // ---- fixtures -------------------------------------------------------------
    let seq = 0;
    const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
    /** members: [id, pointsFor, wins, losses, ties]; joined in array order. */
    async function league(members: Array<[string, number, number, number, number?]>, extra: Record<string, unknown> = {}) {
      const cols = ['name', ...Object.keys(extra)];
      const [l] = await q(`insert into leagues (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`,
        ['t', ...Object.values(extra)]);
      let i = 0;
      for (const [u, pf, w, lo, ti] of members) {
        await q(`insert into league_members (league_id, user_id, joined_at) values ($1,$2, '2026-09-01T00:00Z'::timestamptz + ($3 || ' minutes')::interval)`,
          [l.id, u, String(i++)]);
        await q(`insert into league_standings (league_id, user_id, wins, losses, ties, points_for) values ($1,$2,$3,$4,$5,$6)`,
          [l.id, u, w, lo, ti ?? 0, pf]);
      }
      return l.id as string;
    }
    /** A scored regular-season game. winner: a user id, or 'tie'. */
    async function game(lg: string, a: string, b: string, winner: string, opts: { playoff?: boolean; scored?: boolean; week?: number } = {}) {
      await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id, is_tie, is_playoff)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [lg, opts.week ?? 1, a, b, opts.scored === false ? null : 1, opts.scored === false ? null : 1,
          winner === 'tie' || opts.scored === false ? null : winner, winner === 'tie', opts.playoff ?? false]);
    }
    /** A scored bye: NO RESULT (winner NULL, is_tie false). `legacy` writes the
     * pre-2026-09-29 bye-as-win shape (winner = the bye manager). */
    async function bye(lg: string, u: string, legacy = false) {
      await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, winner_user_id, is_tie)
        values ($1, 1, $2, null, 5, $3, false)`, [lg, u, legacy ? u : null]);
    }
    const ranked = async (lg: string) =>
      await q(`select user_id, rank, tiebreak, win_points::float8 wp, win_pct::float8 pct, games_played::float8 gp
        from league_standings_ranked($1) order by rank`, [lg]);
    const order = async (lg: string) => (await ranked(lg)).map((r: Row) => r.user_id);
    const labels = async (lg: string) => (await ranked(lg)).map((r: Row) => r.tiebreak);
    const asUser = async <T>(role: string, sub: string | null, fn: () => Promise<T>): Promise<T> => {
      await db.exec(`set role ${role}`);
      await db.exec(`select set_config('request.jwt.claim.sub', '${sub ?? ''}', false)`);
      try { return await fn(); } finally { await db.exec('reset role'); }
    };

    // Motivating scenario, seeded BEFORE the migration so the old get_home_summary
    // rank can be compared with the new one for the same data.
    const A = uid(), B = uid(), C = uid(), D = uid();
    // A and B are both 5-1; A beat B; B has more season gain and so the old
    // win% -> wins -> points_for order put B first. C/D are 1-5.
    const motive = await league([[C, 10, 1, 5], [B, 900, 5, 1], [A, 500, 5, 1], [D, 20, 1, 5]]);
    await game(motive, A, B, A);
    const homeRank = async (who: string) => (await asUser('authenticated', who,
      () => q(`select league_id, standings_rank, standings_count from get_home_summary()`)))
      .find((r: Row) => r.league_id === motive);
    const oldA = await homeRank(A);

    const before: Record<string, Row> = {};
    for (const f of FNS.slice(1)) before[f] = await fnState(f);

    // ---- apply the migrations under test ---------------------------------------
    await db.exec(await mig('20261011000000_league_standings_ranked.sql'));
    await db.exec(await mig('20261011000001_get_home_summary_unified_rank.sql'));
    await db.exec(await mig('20261011000002_complete_league_season_unified_rank.sql'));

    await t.step('grants: league_standings_ranked is INVOKER, authenticated + service_role only, path pinned', async () => {
      const s = await fnState('league_standings_ranked');
      assertEquals(s.prosecdef, false);
      assert(!/anon=/.test(s.acl), s.acl);
      assert(!/(^|[{,])=X/.test(s.acl), `PUBLIC still has EXECUTE: ${s.acl}`);
      assert(/authenticated=X/.test(s.acl) && /service_role=X/.test(s.acl), s.acl);
      assert(s.cfg.includes('search_path=public, pg_temp'), s.cfg);
    });

    await t.step('re-creates keep proacl, prosecdef and proconfig byte-identical', async () => {
      for (const f of FNS.slice(1)) {
        const after = await fnState(f);
        assertEquals(after, before[f], f);
        assertEquals(after.prosecdef, true, f);
      }
      assert(before.complete_league_season.cfg.includes('search_path=public'), before.complete_league_season.cfg);
      assert(/service_role=X/.test(before.complete_league_season.acl), before.complete_league_season.acl);
      assert(!/authenticated=|anon=/.test(before.complete_league_season.acl), before.complete_league_season.acl);
    });

    await t.step('MOTIVATING: 5-1 vs 5-1, H2H winner ranks first although the loser has more season gain', async () => {
      assertEquals(await order(motive), [A, B, D, C]);
      assertEquals(await labels(motive), ['h2h', 'h2h', 'season_gain', 'season_gain']);
      // get_home_summary changed with it: A was 2nd under the old CTE, 1st now.
      assertEquals(oldA.standings_rank, 2);
      const newA = await homeRank(A);
      assertEquals([newA.standings_rank, newA.standings_count], [1, 4]);
      assertEquals((await homeRank(B)).standings_rank, 2);
    });

    await t.step('2-way: H2H split 1-1 falls through to season gain', async () => {
      const [x, y, z] = [uid(), uid(), uid()];
      const lg = await league([[x, 100, 4, 2], [y, 300, 4, 2], [z, 0, 1, 5]]);
      await game(lg, x, y, x, { week: 1 });
      await game(lg, x, y, y, { week: 2 });
      assertEquals(await order(lg), [y, x, z]);
      assertEquals(await labels(lg), ['season_gain', 'season_gain', null]);
    });

    await t.step('ties count half, ranked by win%: 6-3-1 (.650) > 7-4-0 (.636) > 6-4-0 (.600)', async () => {
      // 7-4-0 has more raw wins AND more win points than 6-3-1, but played one
      // more game (the 6-3-1 manager had a bye): win% puts 6-3-1 first.
      const [x, y, z] = [uid(), uid(), uid()];
      const lg = await league([[y, 999, 6, 4, 0], [x, 1, 6, 3, 1], [z, 0, 7, 4, 0]]);
      assertEquals(await order(lg), [x, z, y]);
      assertEquals(await labels(lg), [null, null, null]);
      const r = await ranked(lg);
      assertEquals(r.map((x: Row) => x.wp), [6.5, 7, 6]);
      assertEquals(r.map((x: Row) => x.gp), [10, 11, 10]);
      assertEquals(r.map((x: Row) => x.pct), [0.65, 0.636363636364, 0.6]);
    });

    await t.step('uneven byes: win% beats raw wins (3-1 above 4-2)', async () => {
      const [a, b, c] = [uid(), uid(), uid()];
      // a sat out a bye week (no result, so it is not in a's record).
      const lg = await league([[b, 900, 4, 2], [a, 1, 3, 1], [c, 50, 2, 4]]);
      await bye(lg, a);
      assertEquals(await order(lg), [a, b, c]);
      assertEquals((await ranked(lg)).map((r: Row) => r.gp), [4, 6, 6]);
    });

    await t.step('0 games played counts as win% 0: after any winner, level with the winless, then season gain', async () => {
      const [w, byeOnly, lost] = [uid(), uid(), uid()];
      // Week 1 of a 3-manager league: w beat lost; byeOnly had the bye.
      const lg = await league([[lost, 10, 0, 1], [byeOnly, 50, 0, 0], [w, 20, 1, 0]]);
      await bye(lg, byeOnly);
      await game(lg, w, lost, w);
      assertEquals(await order(lg), [w, byeOnly, lost]);
      assertEquals(await labels(lg), [null, 'season_gain', 'season_gain']);
      assertEquals((await ranked(lg)).map((r: Row) => [r.pct, r.gp]), [[1, 1], [0, 0], [0, 1]]);
    });

    await t.step('a drawn H2H game counts half inside the mini-league', async () => {
      const [x, y] = [uid(), uid()];
      const lg = await league([[y, 500, 3, 1, 1], [x, 1, 3, 1, 1]]);
      await game(lg, x, y, x, { week: 1 });
      await game(lg, x, y, 'tie', { week: 2 });
      assertEquals(await order(lg), [x, y]);
      assertEquals(await labels(lg), ['h2h', 'h2h']);
    });

    await t.step('3-way balanced cycle (A>B>C>A): H2H cannot separate -> season gain', async () => {
      const [a, b, c] = [uid(), uid(), uid()];
      const lg = await league([[a, 10, 3, 2], [b, 30, 3, 2], [c, 20, 3, 2]]);
      await game(lg, a, b, a); await game(lg, b, c, b); await game(lg, c, a, c);
      assertEquals(await order(lg), [b, c, a]);
      assertEquals(await labels(lg), ['season_gain', 'season_gain', 'season_gain']);
    });

    await t.step('3-way: sweeper first, then the rest by DIRECT H2H among themselves', async () => {
      const [a, b, c] = [uid(), uid(), uid()];
      const lg = await league([[a, 1, 3, 2], [b, 90, 3, 2], [c, 50, 3, 2]]);
      await game(lg, a, b, a); await game(lg, a, c, a); await game(lg, c, b, c);
      assertEquals(await order(lg), [a, c, b]);
      assertEquals(await labels(lg), ['h2h', 'h2h', 'h2h']);
    });

    await t.step('4-way recursion: subgroups re-run H2H among only their own members', async () => {
      // Mini-league of 4: a 2 (b,c), b 2 (c,d), c 1 (d), d 1 (a). Season gain is
      // REVERSED (d richest) so it cannot be what decided the order.
      const [a, b, c, d] = [uid(), uid(), uid(), uid()];
      const lg = await league([[a, 1, 4, 3], [b, 2, 4, 3], [c, 3, 4, 3], [d, 4, 4, 3]]);
      await game(lg, a, b, a); await game(lg, a, c, a); await game(lg, d, a, d);
      await game(lg, b, c, b); await game(lg, b, d, b); await game(lg, c, d, c);
      assertEquals(await order(lg), [a, b, c, d]);
      assertEquals(await labels(lg), ['h2h', 'h2h', 'h2h', 'h2h']);
    });

    await t.step('3-way unbalanced (one pair met twice) skips H2H for the whole set', async () => {
      const [a, b, c] = [uid(), uid(), uid()];
      const lg = await league([[a, 1, 3, 3], [b, 3, 3, 3], [c, 2, 3, 3]]);
      await game(lg, a, b, a, { week: 1 }); await game(lg, a, b, a, { week: 2 });
      await game(lg, a, c, a); await game(lg, b, c, c);
      assertEquals(await order(lg), [b, c, a]);
      assertEquals(await labels(lg), ['season_gain', 'season_gain', 'season_gain']);
    });

    await t.step('3-way where two never met: H2H skipped even though a beat b', async () => {
      const [a, b, c] = [uid(), uid(), uid()];
      const lg = await league([[a, 1, 2, 1], [b, 5, 2, 1], [c, 3, 2, 1]]);
      await game(lg, a, b, a); await game(lg, b, c, b);
      assertEquals(await order(lg), [b, c, a]);
    });

    await t.step('byes are ignored by H2H and meeting counts; the recorded W/L/T is used as-is', async () => {
      const [a, b] = [uid(), uid()];
      // a also had a bye (no result, so not in the 3-1); b beat a head to head.
      const lg = await league([[a, 900, 3, 1], [b, 1, 3, 1]]);
      await bye(lg, a);
      await bye(lg, b, true); // a legacy bye-as-win row is ignored by H2H too
      await game(lg, a, b, b);
      assertEquals(await order(lg), [b, a]);
      assertEquals(await labels(lg), ['h2h', 'h2h']);
      assertEquals((await ranked(lg)).map((r: Row) => r.gp), [4, 4]);
    });

    await t.step('unscored and playoff matchups do not count as H2H', async () => {
      const [a, b] = [uid(), uid()];
      const lg = await league([[a, 1, 2, 2], [b, 9, 2, 2]]);
      await game(lg, a, b, a, { scored: false });
      await game(lg, a, b, a, { playoff: true, week: 5 });
      assertEquals(await order(lg), [b, a]);
      assertEquals(await labels(lg), ['season_gain', 'season_gain']);
    });

    await t.step('pre-season (all 0-0-0 at $0): join order, then user id; departed member last; stable', async () => {
      const [c, a, b] = ['zz-commish', 'aa-second', 'mm-third'];
      const lg = await league([[c, 0, 0, 0], [a, 0, 0, 0], [b, 0, 0, 0]]);
      await q(`insert into league_standings (league_id, user_id) values ($1, 'ab-departed')`, [lg]);
      const first = await order(lg);
      assertEquals(first, [c, a, b, 'ab-departed']);
      assertEquals(await labels(lg), ['join_order', 'join_order', 'join_order', 'join_order']);
      for (let i = 0; i < 3; i++) assertEquals(await order(lg), first);
      // Same join instant -> user id decides.
      const lg2 = await league([['p-2', 0, 0, 0], ['p-1', 0, 0, 0]]);
      await q(`update league_members set joined_at = '2026-09-01T00:00Z' where league_id=$1`, [lg2]);
      assertEquals(await order(lg2), ['p-1', 'p-2']);
    });

    await t.step('playoff cutoff: the 4th seed is the H2H winner, not the richer manager', async () => {
      const [s1, s2, s3, s4, s5] = [uid(), uid(), uid(), uid(), uid()];
      const lg = await league([[s1, 9, 5, 0], [s2, 8, 4, 1], [s3, 7, 3, 2], [s5, 999, 2, 3], [s4, 1, 2, 3]]);
      await game(lg, s4, s5, s4);
      assertEquals((await order(lg)).slice(0, 4), [s1, s2, s3, s4]);
    });

    await t.step('ranks are exactly 1..N with one row per standings row', async () => {
      const r = await ranked(motive);
      assertEquals(r.map((x: Row) => x.rank), [1, 2, 3, 4]);
    });

    await t.step('RLS: a member sees the whole league; a non-member gets 0 rows; anon is refused', async () => {
      const memberView = await asUser('authenticated', C, () =>
        q(`select user_id from league_standings_ranked($1) order by rank`, [motive]));
      assertEquals(memberView.map((r: Row) => r.user_id), [A, B, D, C]);
      const outsider = await asUser('authenticated', uid(), () =>
        q(`select * from league_standings_ranked($1)`, [motive]));
      assertEquals(outsider.length, 0);
      await assertRejects(() => asUser('anon', null, () => q(`select * from league_standings_ranked($1)`, [motive])),
        Error, 'permission denied');
      await assertRejects(() => asUser('authenticated', A, () =>
        q(`select complete_league_season($1, $2, $3)`, [motive, A, B])), Error, 'permission denied');
    });

    await t.step('complete_league_season snapshots final_standings in the unified order', async () => {
      const [s] = await q(`insert into league_seasons (league_id) values ($1) returning id`, [motive]);
      await q(`update leagues set current_season_id=$1 where id=$2`, [s.id, motive]);
      await q(`select complete_league_season($1, $2, $3)`, [motive, A, B]);
      const [row] = await q(`select final_standings fs from league_seasons where id=$1`, [s.id]);
      assertEquals(row.fs.map((x: Row) => [x.user_id, x.rank]), [[A, 1], [B, 2], [D, 3], [C, 4]]);
      assertEquals(Object.keys(row.fs[0]).sort(),
        ['losses', 'points_against', 'points_for', 'rank', 'ties', 'user_id', 'wins']);
      assertEquals((await q(`select season_status from leagues where id=$1`, [motive]))[0].season_status, 'completed');
    });
  },
});
