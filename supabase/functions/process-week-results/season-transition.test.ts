import { assertEquals } from 'jsr:@std/assert';
import {
  decidePlayoffSeeds,
  decidePodium,
  needsRegularSeasonTransition,
  readRanking,
  buildPlayoffBracket,
  readPlayoffStart,
} from './season-transition.ts';

const rows = (...ids: string[]) => ids.map((user_id, i) => ({ user_id, rank: i + 1 }));
const ok = (data: unknown) => ({ data, error: null });

// ---------------------------------------------------------------------------
// readRanking — the rpc result is validated BEFORE anything is written
// ---------------------------------------------------------------------------

Deno.test('readRanking: an rpc error refuses (supabase-js resolves, it does not throw)', () => {
  const r = readRanking({ data: null, error: { message: 'boom' } });
  assertEquals(r, { ok: false, reason: 'standings_rank_refused: rpc error: boom' });
});

Deno.test('readRanking: null / non-array / empty data refuses — never an unranked fallback', () => {
  for (const data of [null, undefined, {}, 'x', []]) {
    assertEquals(readRanking(ok(data)).ok, false, JSON.stringify(data));
  }
});

Deno.test('readRanking: ranks must be exactly 1..N, unique ids, well-typed', () => {
  const bad = [
    [{ user_id: 'a', rank: 1 }, { user_id: 'b', rank: 3 }], // gap
    [{ user_id: 'a', rank: 1 }, { user_id: 'b', rank: 1 }], // shared rank
    [{ user_id: 'a', rank: 1 }, { user_id: 'a', rank: 2 }], // duplicate id
    [{ user_id: 'a', rank: 0 }], // not 1-based
    [{ user_id: 'a', rank: 1.5 }],
    [{ user_id: '', rank: 1 }],
    [{ user_id: null, rank: 1 }],
    [{ rank: 1 }],
  ];
  for (const data of bad) assertEquals(readRanking(ok(data)).ok, false, JSON.stringify(data));
});

Deno.test('readRanking: returns rows sorted by rank regardless of wire order', () => {
  const r = readRanking(ok([{ user_id: 'b', rank: 2 }, { user_id: 'a', rank: 1 }]));
  assertEquals(r, { ok: true, ranked: [{ user_id: 'a', rank: 1 }, { user_id: 'b', rank: 2 }] });
});

// ---------------------------------------------------------------------------
// decidePlayoffSeeds — seed == rank, top N taken AFTER ranking (not before)
// ---------------------------------------------------------------------------

Deno.test('decidePlayoffSeeds: seeds are the top N ranks, in rank order', () => {
  const r = decidePlayoffSeeds(ok(rows('a', 'b', 'c', 'd', 'e')), 4);
  assertEquals(r, {
    ok: true,
    seeds: [
      { user_id: 'a', seed: 1 },
      { user_id: 'b', seed: 2 },
      { user_id: 'c', seed: 3 },
      { user_id: 'd', seed: 4 },
    ],
  });
});

Deno.test('decidePlayoffSeeds: fewer ranked managers than playoff spots refuses', () => {
  assertEquals(decidePlayoffSeeds(ok(rows('a', 'b', 'c')), 4), {
    ok: false,
    reason: 'standings_rank_refused: 3 ranked managers for 4 playoff spots',
  });
});

Deno.test('decidePlayoffSeeds: an rpc error refuses before any seed exists', () => {
  assertEquals(decidePlayoffSeeds({ data: null, error: { message: 'x' } }, 4).ok, false);
});

// ---------------------------------------------------------------------------
// decidePodium — non-playoff completion
// ---------------------------------------------------------------------------

Deno.test('decidePodium: rank 1 is champion, rank 2 runner-up', () => {
  assertEquals(decidePodium(ok([{ user_id: 'b', rank: 2 }, { user_id: 'a', rank: 1 }])), {
    ok: true,
    champion: 'a',
    runnerUp: 'b',
  });
});

Deno.test('decidePodium: fewer than two ranked managers refuses', () => {
  assertEquals(decidePodium(ok(rows('a'))).ok, false);
  assertEquals(decidePodium({ data: null, error: { message: 'x' } }).ok, false);
});

// ---------------------------------------------------------------------------
// needsRegularSeasonTransition — the heal pass for a refused transition
// ---------------------------------------------------------------------------

const league = {
  league_type: 'matchup',
  season_status: 'active',
  draft_status: 'completed',
  current_week: 3,
  num_weeks: 3,
};
const done = { regularTotal: 6, regularUnscored: 0, playoffTotal: 0 };

Deno.test('heal: a finished, fully-scored regular season with no bracket needs the transition', () => {
  assertEquals(needsRegularSeasonTransition(league, done), true);
  assertEquals(needsRegularSeasonTransition({ ...league, current_week: 4 }, done), true);
});

Deno.test('heal: any unscored regular-season matchup (incl. a refused one) blocks it', () => {
  assertEquals(needsRegularSeasonTransition(league, { ...done, regularUnscored: 1 }), false);
});

Deno.test('heal: an existing playoff row means it already transitioned', () => {
  assertEquals(needsRegularSeasonTransition(league, { ...done, playoffTotal: 1 }), false);
});

Deno.test('heal: mid-season, non-active, undrafted, duration, or no schedule never transition', () => {
  const cases = [
    { ...league, current_week: 2 },
    { ...league, season_status: 'playoffs' },
    { ...league, season_status: 'completed' },
    { ...league, season_status: null },
    { ...league, draft_status: 'in_progress' },
    { ...league, league_type: 'duration' },
    { ...league, num_weeks: 0 },
    { ...league, num_weeks: null },
    { ...league, current_week: null },
  ];
  for (const l of cases) assertEquals(needsRegularSeasonTransition(l, done), false, JSON.stringify(l));
  assertEquals(needsRegularSeasonTransition(league, { ...done, regularTotal: 0 }), false);
});

// ---------------------------------------------------------------------------
// buildPlayoffBracket / readPlayoffStart
// ---------------------------------------------------------------------------

const seedsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ user_id: `s${i + 1}` }));
// Fri 2026-10-16 21:00Z, the last regular week_end of the test leagues.
const LAST_END = new Date('2026-10-16T21:00:00Z');

Deno.test('bracket (4): 1v4 and 2v3 semis the next Tuesday, finals placeholder a week later', () => {
  const b = buildPlayoffBracket(seedsOf(4), LAST_END, 4);
  assertEquals(b.map((r) => [r.week_number, r.playoff_round, r.team1_user_id, r.team2_user_id, r.team1_seed, r.team2_seed]), [
    [4, 'semi', 's1', 's4', 1, 4],
    [4, 'semi', 's2', 's3', 2, 3],
    [5, 'finals', null, null, null, null],
  ]);
  assertEquals([b[0].week_start, b[0].week_end], ['2026-10-20T14:30:00.000Z', '2026-10-23T21:00:00.000Z']);
  assertEquals(b[2].week_start, '2026-10-27T14:30:00.000Z');
});

Deno.test('bracket (2): finals only; (8): 1v8, 4v5, 2v7, 3v6 then placeholders', () => {
  const two = buildPlayoffBracket(seedsOf(2), LAST_END, 4);
  assertEquals(two.map((r) => [r.playoff_round, r.team1_seed, r.team2_seed]), [['finals', 1, 2]]);
  const eight = buildPlayoffBracket(seedsOf(8), LAST_END, 8);
  assertEquals(eight.map((r) => [r.week_number, r.playoff_round, r.team1_seed, r.team2_seed]), [
    [8, 'quarter', 1, 8], [8, 'quarter', 4, 5], [8, 'quarter', 2, 7], [8, 'quarter', 3, 6],
    [9, 'semi', null, null], [9, 'semi', null, null], [10, 'finals', null, null],
  ]);
});

Deno.test('bracket: a Tuesday end date rolls a full week; unsupported size builds nothing', () => {
  const tue = buildPlayoffBracket(seedsOf(2), new Date('2026-10-20T21:00:00Z'), 4);
  assertEquals(tue[0].week_start, '2026-10-27T14:30:00.000Z');
  assertEquals(buildPlayoffBracket(seedsOf(3), LAST_END, 4), []);
});

Deno.test('readPlayoffStart: started and already_transitioned are success; everything else refuses', () => {
  assertEquals(readPlayoffStart(ok({ status: 'started', matchups_inserted: 3 })), { ok: true, claimed: true });
  assertEquals(readPlayoffStart(ok({ status: 'not_eligible', current_week: 4, expected_week: 3 })), {
    ok: false,
    reason: 'start_league_playoffs not_eligible: current_week 4 != expected 3',
  });
  assertEquals(readPlayoffStart(ok({ status: 'claimed' })).ok, false, 'the old status name is not accepted');
  assertEquals(readPlayoffStart(ok({ status: 'already_transitioned', season_status: 'playoffs' })), { ok: true, claimed: false });
  assertEquals(readPlayoffStart(ok({ status: 'refused', reason: 'bracket_non_member' })),
    { ok: false, reason: 'start_league_playoffs refused: bracket_non_member' });
  assertEquals(readPlayoffStart({ data: null, error: { message: 'duplicate key' } }).ok, false);
  assertEquals(readPlayoffStart(ok(null)).ok, false);
  assertEquals(readPlayoffStart(ok({ status: 'weird' })).ok, false);
});
