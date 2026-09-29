/**
 * Flexible playoffs (20261012000000-03) against REAL Postgres (PGlite).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * Applies the prior definitions (20261011000003 start_league_playoffs,
 * 20261011000004 backstop index) on a replica of the columns and constraints
 * they touch, inserts LEGACY fixtures (brackets and leagues as they exist in
 * prod before this change), then applies the four flexible-playoffs migrations
 * VERBATIM and checks:
 *   - the legacy backfills: bracket addresses (a finished 4-team and an
 *     in-flight 8-team bracket), NULL playoff_teams -> 4 on matchup leagues
 *     only, league_end_date extended by W weeks on live leagues only;
 *   - the new constraints (matchup leagues require P >= 2; playoff rows require
 *     an address; the address index);
 *   - start_league_playoffs accepts the exact bracket for EVERY P from 2 to 16
 *     (built by the real TS builder) and refuses every shape deviation;
 *   - a full tournament for every P, advancing each winner with the same
 *     conditional, addressed UPDATE advancePlayoffWinner issues, computed by the
 *     real planAdvance: the TS address math and the SQL bracket agree end to end;
 *   - the playoff_teams freeze trigger, including the designed Start-draft order
 *     (lower P while not_started, then start).
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { buildPlayoffBracket } from '../functions/process-week-results/season-transition.ts';
import { planAdvance } from '../functions/process-week-results/playoff-progression.ts';
import { playoffShape } from '../functions/_shared/playoff-bracket.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (f: string) => Deno.readTextFile(new URL(`supabase/migrations/${f}`, ROOT));
const PRIOR = ['20261011000003_start_league_playoffs.sql', '20261011000004_playoff_bracket_unique_backstop.sql'];
const FLEXIBLE = [
  '20261012000000_flexible_playoffs_schema.sql',
  '20261012000001_start_league_playoffs_flexible.sql',
  '20261012000002_freeze_playoff_teams_after_draft_start.sql',
  '20261012000003_backfill_league_end_date_playoff_weeks.sql',
];

// The prod shape these migrations meet: the old IN (2,4,8) CHECK, the old
// 3-value round CHECK, nullable team ids, the two per-week unique keys.
const SCHEMA = `
create role anon; create role authenticated; create role service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table leagues (
  id uuid primary key default gen_random_uuid(), name text, league_type text not null default 'matchup',
  num_weeks int, current_week int default 1, season_status text default 'active',
  draft_status text default 'completed', playoff_teams int default 4, league_end_date timestamptz,
  constraint valid_playoff_teams check (playoff_teams is null or playoff_teams in (2, 4, 8)));
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, primary key (league_id, user_id));
create table matchups (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, week_number int not null,
  team1_user_id text, team2_user_id text, team1_gain numeric(12,2), team2_gain numeric(12,2),
  winner_user_id text, week_start timestamptz, week_end timestamptz, is_playoff boolean default false,
  playoff_round text, team1_seed int, team2_seed int,
  unique(league_id, week_number, team1_user_id), unique(league_id, week_number, team2_user_id),
  constraint valid_playoff_round check (playoff_round is null or playoff_round in ('quarter', 'semi', 'finals')));
`;

const LAST_END = new Date('2026-10-16T21:00:00Z');
const DAY = 24 * 3600 * 1000;
const COMMISH = '11111111-1111-1111-1111-111111111111';
// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'flexible playoffs on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    await db.exec(SCHEMA);
    for (const f of PRIOR) await db.exec(await read(f));

    async function mkLeague(extra: Record<string, unknown>, members: string[]) {
      const row = { name: 't', num_weeks: 3, current_week: 3, ...extra };
      const cols = Object.keys(row);
      const [l] = await q(`insert into leagues (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning id`,
        Object.values(row));
      for (const m of members) await q(`insert into league_members values ($1,$2)`, [l.id, m]);
      return l.id as string;
    }
    async function regularSeason(id: string, lastEnd = LAST_END) {
      await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id, week_end)
        values ($1, 3, 'x1', 'x2', 1, 0, 'x1', $2)`, [id, lastEnd.toISOString()]);
    }
    const legacy = (id: string, week: number, round: string, t1: string | null, t2: string | null, s1: number | null, s2: number | null) =>
      q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_seed, team2_seed, is_playoff, playoff_round)
         values ($1,$2,$3,$4,$5,$6,true,$7)`, [id, week, t1, t2, s1, s2, round]);
    const addresses = async (id: string) =>
      (await q(`select playoff_round_number rn, bracket_position pos, team1_seed s1, team2_seed s2 from matchups
        where league_id=$1 and is_playoff order by rn, pos`, [id])).map((r: Row) => [r.rn, r.pos, r.s1, r.s2]);

    // ---- LEGACY FIXTURES, inserted BEFORE the flexible migrations ----------
    // A finished 4-team bracket.
    const l4 = await mkLeague({ season_status: 'completed', current_week: 5 }, ['c', 'a', 'b', 'd']);
    await legacy(l4, 5, 'finals', 'c', 'b', 1, 3);
    await legacy(l4, 4, 'semi', 'b', 'a', 3, 2);
    await legacy(l4, 4, 'semi', 'c', 'd', 1, 4);
    // An in-flight 8-team bracket: quarters inserted in the OLD builder's order
    // (1v8, 4v5, 2v7, 3v6) but shuffled; semis/final unfilled placeholders.
    const l8 = await mkLeague({ season_status: 'playoffs', current_week: 4, playoff_teams: 8 }, ['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h']);
    await legacy(l8, 4, 'quarter', 'a', 'g', 2, 7);
    await legacy(l8, 4, 'quarter', 'c', 'h', 1, 8);
    await legacy(l8, 4, 'quarter', 'b', 'f', 3, 6);
    await legacy(l8, 4, 'quarter', 'd', 'e', 4, 5);
    await legacy(l8, 5, 'semi', null, null, null, null);
    await legacy(l8, 5, 'semi', null, null, null, null);
    await legacy(l8, 6, 'finals', null, null, null, null);
    // NULL playoff_teams: a matchup league (-> 4) and a duration league (stays NULL).
    const lNull = await mkLeague({ playoff_teams: null, draft_status: 'not_started', season_status: 'active' }, ['c']);
    const lDur = await mkLeague({ playoff_teams: null, league_type: 'duration', num_weeks: null }, ['c']);
    // Live leagues whose end date is the end of the REGULAR season.
    const live4 = await mkLeague({ league_end_date: LAST_END.toISOString() }, ['c', 'a', 'b', 'd']);
    await regularSeason(live4);
    const live8 = await mkLeague({ playoff_teams: 8, season_status: 'playoffs', league_end_date: LAST_END.toISOString() }, ['c']);
    await regularSeason(live8);
    // Not in scope for the end-date backfill.
    const done = await mkLeague({ season_status: 'completed', league_end_date: LAST_END.toISOString() }, ['c']);
    await regularSeason(done);
    const undrafted = await mkLeague({ draft_status: 'not_started', league_end_date: null }, ['c']);

    for (const f of FLEXIBLE) await db.exec(await read(f));

    // ---- BACKFILLS ---------------------------------------------------------
    await t.step('legacy 4-team bracket: addresses match what the new builder would write', async () => {
      assertEquals(await addresses(l4), [[1, 0, 1, 4], [1, 1, 3, 2], [2, 0, 1, 3]]);
    });

    await t.step('legacy in-flight 8-team bracket: quarters get display-order positions, placeholders the rest', async () => {
      // 1v8 -> 0, 4v5 -> 1, 3v6 -> 2, 2v7 -> 3: exactly where planBracket(8) puts them,
      // so advancing this in-flight bracket with the new code is correct.
      assertEquals(await addresses(l8), [
        [1, 0, 1, 8], [1, 1, 4, 5], [1, 2, 3, 6], [1, 3, 2, 7], [2, 0, null, null], [2, 1, null, null], [3, 0, null, null],
      ]);
      const expected = buildPlayoffBracket(['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h'].map((user_id) => ({ user_id })), LAST_END, 4)
        .filter((r) => r.playoff_round_number === 1)
        .map((r) => [r.playoff_round_number, r.bracket_position, r.team1_seed, r.team2_seed]);
      assertEquals((await addresses(l8)).slice(0, 4), expected);
    });

    await t.step('playoff_teams: NULL -> 4 on matchup leagues only; new rules enforced', async () => {
      const p = async (id: string) => (await q(`select playoff_teams from leagues where id=$1`, [id]))[0].playoff_teams;
      assertEquals(await p(lNull), 4);
      assertEquals(await p(lDur), null);
      await assertRejects(() => q(`update leagues set playoff_teams = null where id=$1`, [live4]), Error, 'leagues_matchup_requires_playoff_teams');
      await assertRejects(() => q(`update leagues set playoff_teams = 1 where id=$1`, [lNull]), Error, 'valid_playoff_teams');
      await q(`update leagues set playoff_teams = 6 where id=$1`, [lNull]); // not 2/4/8: now allowed
      await q(`update leagues set playoff_teams = 13 where id=$1`, [lNull]);
    });

    await t.step('league_end_date: live leagues extended by exactly W weeks; others untouched', async () => {
      const end = async (id: string) => {
        const v = (await q(`select league_end_date e from leagues where id=$1`, [id]))[0].e;
        return v === null ? null : new Date(v).toISOString();
      };
      assertEquals(await end(live4), new Date(LAST_END.getTime() + 14 * DAY).toISOString()); // P=4: W=2
      assertEquals(await end(live4), '2026-10-30T21:00:00.000Z');
      assertEquals(await end(live8), new Date(LAST_END.getTime() + 21 * DAY).toISOString()); // P=8: W=3
      assertEquals(await end(done), LAST_END.toISOString());
      assertEquals(await end(undrafted), null);
      // Idempotent: a re-run changes nothing.
      await db.exec(await read(FLEXIBLE[3]));
      assertEquals(await end(live4), '2026-10-30T21:00:00.000Z');
    });

    // ---- START: every P ----------------------------------------------------
    const users = (n: number) => Array.from({ length: n }, (_, i) => `u${i + 1}`);
    async function playoffLeague(p: number, members = p) {
      const id = await mkLeague({ playoff_teams: p }, users(members));
      await regularSeason(id);
      return id;
    }
    const bracketFor = (p: number) => buildPlayoffBracket(users(p).map((user_id) => ({ user_id })), LAST_END, 4);
    const start = async (id: string, b: unknown) =>
      (await q(`select start_league_playoffs($1, 3, $2::jsonb) r`, [id, JSON.stringify(b)]))[0].r;

    await t.step('start: the exact bracket for EVERY P from 2 to 16 is accepted; byes sit in round 2', async () => {
      for (let p = 2; p <= 16; p++) {
        const id = await playoffLeague(p);
        assertEquals(await start(id, bracketFor(p)), { status: 'started', matchups_inserted: p - 1 }, `P=${p}`);
        const rows = await q(`select playoff_round_number rn, team1_seed s1, team2_seed s2, week_number w from matchups
          where league_id=$1 and is_playoff`, [id]);
        const { weeks, byes } = playoffShape(p);
        assertEquals(Math.max(...rows.map((r: Row) => r.rn)), weeks);
        assert(rows.every((r: Row) => r.w === 3 + r.rn), `P=${p}: week = num_weeks + round`);
        const r2Seeds = rows.filter((r: Row) => r.rn === 2).flatMap((r: Row) => [r.s1, r.s2]).filter((s: number | null) => s !== null).sort((a: number, b: number) => a - b);
        assertEquals(r2Seeds, Array.from({ length: byes }, (_, i) => i + 1), `P=${p}: the top ${byes} seeds are pre-placed`);
      }
    });

    await t.step('start: P below the member count works (5 of 7 managers)', async () => {
      const id = await playoffLeague(5, 7);
      assertEquals((await start(id, bracketFor(5))).status, 'started');
    });

    await t.step('start: more than 16 teams has no round code and is refused', async () => {
      const id = await playoffLeague(17);
      assertEquals(await start(id, [{ any: 1 }]), { status: 'refused', reason: 'bracket_too_large' });
    });

    // ---- START: shape refusals (P = 6: 4v5 #1, 3v6 #2; 1 -> R2#0.t1, 2 -> R2#1.t2)
    const six = () => bracketFor(6).map((r) => ({ ...r }));
    const idx = (b: Row[], rn: number, pos: number) => b.findIndex((r) => r.playoff_round_number === rn && r.bracket_position === pos);
    const refusals: Array<[string, (b: Row[]) => unknown, string, number?]> = [
      ['round-1 pairings swapped across positions', (b) => {
        const a = idx(b, 1, 1), c = idx(b, 1, 2);
        [b[a].team1_user_id, b[c].team1_user_id] = [b[c].team1_user_id, b[a].team1_user_id];
        [b[a].team1_seed, b[c].team1_seed] = [b[c].team1_seed, b[a].team1_seed];
        return b;
      }, 'bracket_shape_mismatch'],
      ['bye seed in the wrong slot', (b) => {
        const i = idx(b, 2, 1);
        b[i] = { ...b[i], team1_user_id: b[i].team2_user_id, team1_seed: b[i].team2_seed, team2_user_id: null, team2_seed: null };
        return b;
      }, 'bracket_shape_mismatch'],
      ['bye seed missing (NOT pre-placed)', (b) => {
        const i = idx(b, 2, 0);
        b[i] = { ...b[i], team1_user_id: null, team1_seed: null };
        return b;
      }, 'bracket_shape_mismatch'],
      ['a bye turned into a round-1 game', (b) => [...b.filter((_, i) => i !== idx(b, 3, 0)),
        { ...b[idx(b, 1, 1)], bracket_position: 0, team1_user_id: 'u1', team1_seed: 1, team2_user_id: 'u6', team2_seed: 6 }], 'bracket_shape_mismatch'],
      ['a later round pre-filled', (b) => {
        const i = idx(b, 3, 0);
        b[i] = { ...b[i], team1_user_id: 'u1', team1_seed: 1 };
        return b;
      }, 'bracket_shape_mismatch'],
      ['one row too many', (b) => [...b, { ...b[idx(b, 3, 0)], bracket_position: 1 }], 'bracket_bad_position'],
      ['one row too few', (b) => b.filter((_, i) => i !== idx(b, 3, 0)), 'bracket_bad_size'],
      ['two rows at one address', (b) => b.map((r, i) => i === idx(b, 2, 1) ? { ...r, bracket_position: 0 } : r), 'bracket_duplicate_address'],
      ['position out of range', (b) => b.map((r, i) => i === idx(b, 3, 0) ? { ...r, bracket_position: 1 } : r), 'bracket_bad_position'],
      ['negative position', (b) => b.map((r, i) => i === 0 ? { ...r, bracket_position: -1 } : r), 'bracket_bad_position'],
      ['fractional position', (b) => b.map((r, i) => i === 0 ? { ...r, bracket_position: 0.5 } : r), 'bracket_bad_position'],
      ['missing position', (b) => b.map((r, i) => i === 0 ? { ...r, bracket_position: undefined } : r), 'bracket_bad_position'],
      ['round beyond W', (b) => b.map((r, i) => i === idx(b, 3, 0) ? { ...r, playoff_round_number: 4, week_number: 7 } : r), 'bracket_bad_round'],
      ['round code does not match its distance from the final', (b) => b.map((r, i) => i === 0 ? { ...r, playoff_round: 'semi' } : r), 'bracket_bad_round'],
      ['week not num_weeks + round', (b) => b.map((r, i) => i === idx(b, 2, 0) ? { ...r, week_number: 4 } : r), 'bracket_bad_week'],
      ['seed beyond P', (b) => b.map((r, i) => i === 0 ? { ...r, team2_seed: 7 } : r), 'bracket_bad_seed'],
      ['seed on an empty slot', (b) => b.map((r, i) => i === idx(b, 3, 0) ? { ...r, team1_seed: 1 } : r), 'bracket_bad_seed'],
      ['string seed', (b) => b.map((r, i) => i === 0 ? { ...r, team1_seed: '4' } : r), 'bracket_bad_seed'],
      ['one user in two slots', (b) => b.map((r, i) => i === idx(b, 2, 1) ? { ...r, team2_user_id: 'u1' } : r), 'bracket_duplicate_team'],
      ['a 6-team bracket for an 8-team league', (b) => b, 'bracket_bad_size', 8],
    ];
    for (const [label, mk, reason, leagueP] of refusals) {
      await t.step(`refusal writes nothing: ${label}`, async () => {
        const id = await playoffLeague(leagueP ?? 6);
        assertEquals(await start(id, mk(six())), { status: 'refused', reason });
        const [{ n }] = await q(`select count(*)::int n from matchups where league_id=$1 and is_playoff`, [id]);
        const [l] = await q(`select season_status s, current_week w from leagues where id=$1`, [id]);
        assertEquals([n, l.s, l.w], [0, 'active', 3]);
      });
    }

    // ---- A FULL TOURNAMENT PER P, advanced exactly as advancePlayoffWinner does
    await t.step('tournament: every P plays out to one champion via addressed, conditional advances', async () => {
      for (let p = 2; p <= 16; p++) {
        const id = await playoffLeague(p);
        await start(id, bracketFor(p));
        const { weeks } = playoffShape(p);
        let champion: string | null = null;
        for (let r = 1; r <= weeks; r++) {
          const games = await q(`select id, bracket_position pos, team1_user_id t1, team2_user_id t2, team1_seed s1, team2_seed s2
            from matchups where league_id=$1 and is_playoff and playoff_round_number=$2 order by pos`, [id, r]);
          assertEquals(games.length, playoffShape(p).gamesPerRound[r - 1], `P=${p} round ${r}`);
          const inWeek: string[] = [];
          for (const g of games) {
            assert(g.t1 && g.t2, `P=${p} round ${r} pos ${g.pos}: both slots filled when its week starts`);
            inWeek.push(g.t1, g.t2);
            // Lower seed wins, so upsets are exercised too.
            const winner = g.s1 > g.s2 ? g.t1 : g.t2;
            await q(`update matchups set team1_gain=0, team2_gain=0, winner_user_id=$2 where id=$1`, [g.id, winner]);
            const plan = planAdvance({ roundNumber: r, position: g.pos, team1UserId: g.t1, team2UserId: g.t2, team1Seed: g.s1, team2Seed: g.s2 }, winner, weeks);
            if (plan.kind === 'final') {
              champion = winner;
              continue;
            }
            const col = plan.slot === 'team1' ? 'team1_user_id' : 'team2_user_id';
            const seedCol = plan.slot === 'team1' ? 'team1_seed' : 'team2_seed';
            const written = await q(`update matchups set ${col}=$1, ${seedCol}=$2 where league_id=$3 and is_playoff
              and playoff_round_number=$4 and bracket_position=$5 and ${col} is null returning id`,
              [winner, plan.seed, id, plan.round, plan.position]);
            assertEquals(written.length, 1, `P=${p}: the target slot was empty and addressable`);
            // A retry is a no-op (the conditional write finds the slot filled).
            const again = await q(`update matchups set ${col}=$1 where league_id=$2 and is_playoff
              and playoff_round_number=$3 and bracket_position=$4 and ${col} is null returning id`, [winner, id, plan.round, plan.position]);
            assertEquals(again.length, 0);
          }
          assertEquals(new Set(inWeek).size, inWeek.length, `P=${p} round ${r}: nobody plays twice in a week`);
        }
        assertEquals(champion, `u${p}`, `P=${p}: the lowest seed that played round 1 won every game`);
      }
    });

    // ---- FREEZE ------------------------------------------------------------
    const asUser = async <T>(fn: () => Promise<T>) => {
      await db.exec(`set request.jwt.claim.sub = '${COMMISH}'`);
      try {
        return await fn();
      } finally {
        await db.exec(`reset request.jwt.claim.sub`);
      }
    };
    const pOf = async (id: string) => (await q(`select playoff_teams from leagues where id=$1`, [id]))[0].playoff_teams;

    await t.step('freeze: the designed Start-draft order works — lower P while not_started, then start', async () => {
      const id = await mkLeague({ draft_status: 'not_started', playoff_teams: 8 }, users(6));
      await asUser(() => q(`update leagues set playoff_teams = 6 where id=$1`, [id])); // inline lower on the confirm sheet
      await q(`update leagues set draft_status = 'in_progress' where id=$1`, [id]); // draft-control (service role)
      assertEquals(await pOf(id), 6);
      await assertRejects(() => asUser(() => q(`update leagues set playoff_teams = 4 where id=$1`, [id])), Error, 'playoff_teams_locked');
      assertEquals(await pOf(id), 6);
    });

    await t.step('freeze: one UPDATE that lowers P and starts is judged on OLD (not_started) and allowed', async () => {
      const id = await mkLeague({ draft_status: 'not_started', playoff_teams: 8 }, users(6));
      await asUser(() => q(`update leagues set playoff_teams = 5, draft_status = 'in_progress' where id=$1`, [id]));
      assertEquals(await pOf(id), 5);
    });

    await t.step('freeze: completed drafts are locked; other columns and the service role are unaffected', async () => {
      const id = await mkLeague({ draft_status: 'completed', playoff_teams: 4 }, users(4));
      await assertRejects(() => asUser(() => q(`update leagues set playoff_teams = 2 where id=$1`, [id])), Error, 'playoff_teams_locked');
      await asUser(() => q(`update leagues set name = 'renamed', playoff_teams = 4 where id=$1`, [id])); // unchanged P: fine
      await q(`update leagues set playoff_teams = 2 where id=$1`, [id]); // no JWT: service role / migration
      assertEquals(await pOf(id), 2);
    });

    await t.step('freeze: trigger function has no anon/authenticated EXECUTE', async () => {
      const [r] = await q(`select proacl::text a from pg_proc where proname='enforce_playoff_teams_frozen_after_draft_start'`);
      assert(!/anon=|authenticated=/.test(r.a ?? ''), r.a);
      const [tg] = await q(`select tgenabled e from pg_trigger where tgname='trg_leagues_freeze_playoff_teams'`);
      assertEquals(tg.e, 'O');
    });

    await t.step('grants: start_league_playoffs is still service_role only after the replace', async () => {
      const [r] = await q(`select proacl::text a, prosecdef d, proconfig::text c from pg_proc where proname='start_league_playoffs'`);
      assertEquals(r.d, true);
      assert(!/anon=|authenticated=/.test(r.a), r.a);
      assert(!/(^|[{,])=X/.test(r.a), `PUBLIC still has EXECUTE: ${r.a}`);
      assert(/service_role=X/.test(r.a), r.a);
      assert(r.c.includes('search_path=public, pg_temp'), r.c);
      const [{ n }] = await q(`select count(*)::int n from pg_proc where proname='start_league_playoffs'`);
      assertEquals(n, 1, 'no stray overload');
    });
  },
});
