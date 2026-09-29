import { assertEquals } from 'jsr:@std/assert';
import {
  decidePlayoffSeeds,
  decidePodium,
  needsRegularSeasonTransition,
  readRanking,
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
