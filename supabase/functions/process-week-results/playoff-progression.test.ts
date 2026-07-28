/**
 * Hermetic tests for ./playoff-progression.ts.
 *
 *   deno test supabase/functions/process-week-results/playoff-progression.test.ts
 *
 * No DB, no Alpaca, no secrets, no --allow-* flags. Same pattern as
 * grouping.test.ts and scoring-eligibility.test.ts.
 *
 * The DEFECT 1 and DEFECT 2 groups were CHARACTERIZATION tests pinning the broken
 * behaviour so it could be proven real before anything changed. Both defects are
 * now FIXED, and those tests have been inverted in the same commit as the fix —
 * they now assert the correct behaviour and would fail if either defect returned.
 * The `FIXED` prefix marks them as regression guards, not endorsements.
 */

import { assertEquals } from 'jsr:@std/assert';
import {
  decideMatchupOutcome,
  willAdvanceWinner,
  nextRoundOf,
  winnerSeedForAdvance,
  resolveBySeed,
  type PlayoffMatchup,
  type TeamScore,
} from './playoff-progression.ts';

const withPositions = (dollarGain: number, percentGain = 0): TeamScore =>
  ({ dollarGain, percentGain, hasPositions: true });
const empty: TeamScore = { dollarGain: 0, percentGain: 0, hasPositions: false };

const semi = (over: Partial<PlayoffMatchup> = {}): PlayoffMatchup => ({
  team1UserId: 'alice', team2UserId: 'bot-1',
  team1Seed: 1, team2Seed: 4,
  isPlayoff: true, playoffRound: 'semi',
  ...over,
});
const regular = (over: Partial<PlayoffMatchup> = {}): PlayoffMatchup => ({
  team1UserId: 'alice', team2UserId: 'bob',
  team1Seed: null, team2Seed: null,
  isPlayoff: false, playoffRound: null,
  ...over,
});

// ===========================================================================
// The question that prompted this file: does a tied semifinal stop the finals?
// ===========================================================================

Deno.test('a playoff double-tie on dollar AND percent still names a winner (seed breaks it)', () => {
  // This is the tie shape the hypothesis suspected. It is NOT the problem: the
  // seed tiebreaker at index.ts:1231 resolves it and the winner advances.
  const m = semi({ team1Seed: 2, team2Seed: 3 });
  const outcome = decideMatchupOutcome(m, withPositions(0, 0), withPositions(0, 0));

  assertEquals(outcome.reason, 'playoff_seed_tiebreak');
  assertEquals(outcome.winnerId, 'alice'); // seed 2 beats seed 3
  assertEquals(outcome.isTie, false);
  assertEquals(willAdvanceWinner(m, outcome), true, 'progression is NOT blocked by a scored tie');
});

Deno.test('seed tiebreak sends the higher seed through regardless of team order', () => {
  const m = semi({ team1UserId: 'alice', team2UserId: 'bob', team1Seed: 4, team2Seed: 1 });
  const outcome = decideMatchupOutcome(m, withPositions(5, 1), withPositions(5, 1));
  assertEquals(outcome.winnerId, 'bob'); // seed 1 < seed 4
  assertEquals(willAdvanceWinner(m, outcome), true);
});

Deno.test('a null seed is treated as 999, so a seeded team beats an unseeded one', () => {
  // index.ts:1233 — `matchup.team1_seed || 999`.
  const m = semi({ team1Seed: null, team2Seed: 3 });
  const outcome = decideMatchupOutcome(m, withPositions(1, 1), withPositions(1, 1));
  assertEquals(outcome.winnerId, 'bot-1');
  assertEquals(willAdvanceWinner(m, outcome), true);
});

// ===========================================================================
// DEFECT 1 — the both-empty playoff tie. THIS is what blocks the finals.
// ===========================================================================

Deno.test('FIXED 1: a playoff matchup where BOTH teams are empty resolves by seed', () => {
  // Was: reason 'both_empty_tie', winnerId null, isTie true — the only playoff
  // path that left no winner. Now shares resolveBySeed with the double-tie branch.
  const m = semi();
  const outcome = decideMatchupOutcome(m, empty, empty);

  assertEquals(outcome.reason, 'both_empty_playoff_seed_tiebreak');
  assertEquals(outcome.winnerId, 'alice'); // seed 1 beats seed 4
  assertEquals(outcome.isTie, false);
  assertEquals(outcome.team1Won, true);
});

Deno.test('FIXED 1: that outcome now advances, so the finals placeholder gets filled', () => {
  // The impact chain, inverted. willAdvanceWinner mirrors `isPlayoff && winnerId`.
  // True here means advancePlayoffWinner runs, the finals row gets a team, and the
  // pending-matchup query can select it — the season can complete.
  const m = semi();
  const outcome = decideMatchupOutcome(m, empty, empty);
  assertEquals(willAdvanceWinner(m, outcome), true, 'the finals gets populated');
});

Deno.test('one empty side still auto-loses, unchanged by the fix', () => {
  const m = semi();
  const t1Only = decideMatchupOutcome(m, withPositions(10, 5), empty);
  assertEquals(t1Only.reason, 'team2_empty_auto_loss');
  assertEquals(t1Only.winnerId, 'alice');
  assertEquals(willAdvanceWinner(m, t1Only), true);

  const t2Only = decideMatchupOutcome(m, empty, withPositions(10, 5));
  assertEquals(t2Only.reason, 'team1_empty_auto_loss');
  assertEquals(t2Only.winnerId, 'bot-1');
  assertEquals(willAdvanceWinner(m, t2Only), true);
});

Deno.test('FIXED 1: a half-populated playoff placeholder awards to the present team', () => {
  // A finals row with only one slot filled has team2UserId null. It is NOT a bye
  // (a bye requires !isPlayoff), so it reaches the both-empty branch. Without the
  // null-opponent guard in resolveBySeed this would "resolve" to a null winner and
  // recreate DEFECT 1 inside its own fix — 999 vs 999 falls to the team2 side.
  const m = semi({ playoffRound: 'finals', team2UserId: null, team2Seed: null });
  const outcome = decideMatchupOutcome(m, empty, empty);
  assertEquals(outcome.reason, 'playoff_no_opponent');
  assertEquals(outcome.winnerId, 'alice');
  assertEquals(willAdvanceWinner(m, outcome), true);
});

Deno.test('FIXED 1: resolveBySeed never returns a null winner', () => {
  // Guarding the guard: the shared helper is the single point both tie branches
  // depend on, so a null winner escaping it would resurrect the defect silently.
  for (const t2 of [null, 'bob']) {
    for (const [s1, s2] of [[1, 4], [4, 1], [null, null], [null, 2], [3, null]]) {
      const out = resolveBySeed(
        { team1UserId: 'alice', team2UserId: t2, team1Seed: s1, team2Seed: s2, isPlayoff: true },
        'playoff_seed_tiebreak',
      );
      assertEquals(typeof out.winnerId, 'string');
      assertEquals(out.isTie, false);
    }
  }
});

// ===========================================================================
// Regular season keeps its true tie — the fix must not touch this
// ===========================================================================

Deno.test('a regular-season double tie stays a tie and names no winner', () => {
  const m = regular();
  const outcome = decideMatchupOutcome(m, withPositions(3, 2), withPositions(3, 2));
  assertEquals(outcome.reason, 'regular_season_true_tie');
  assertEquals(outcome.winnerId, null);
  assertEquals(outcome.isTie, true);
  assertEquals(willAdvanceWinner(m, outcome), false, 'never advances — not a playoff');
});

Deno.test('a regular-season bye is an automatic win', () => {
  const m = regular({ team2UserId: null });
  const outcome = decideMatchupOutcome(m, empty, empty);
  assertEquals(outcome.reason, 'bye');
  assertEquals(outcome.winnerId, 'alice');
});

Deno.test('both-empty in the REGULAR season is a tie, which is correct there', () => {
  const m = regular();
  const outcome = decideMatchupOutcome(m, empty, empty);
  assertEquals(outcome.reason, 'both_empty_tie');
  assertEquals(outcome.isTie, true);
  // Correct: regular-season ties are a real outcome (0.5 wins each). Only the
  // PLAYOFF case is a defect, which is why the fix must gate on isPlayoff.
});

// ===========================================================================
// Ordinary scoring still works
// ===========================================================================

Deno.test('higher dollar gain wins before percentage is consulted', () => {
  const m = semi();
  const outcome = decideMatchupOutcome(m, withPositions(100, 1), withPositions(50, 99));
  assertEquals(outcome.reason, 'dollar_gain');
  assertEquals(outcome.winnerId, 'alice');
});

Deno.test('percentage breaks an exact dollar tie', () => {
  const m = semi();
  const outcome = decideMatchupOutcome(m, withPositions(50, 2), withPositions(50, 9));
  assertEquals(outcome.reason, 'percent_tiebreak');
  assertEquals(outcome.winnerId, 'bot-1');
});

Deno.test('negative gains compare correctly — losing least wins', () => {
  const m = semi();
  const outcome = decideMatchupOutcome(m, withPositions(-5, -1), withPositions(-50, -20));
  assertEquals(outcome.winnerId, 'alice');
});

// ===========================================================================
// Round chaining
// ===========================================================================

Deno.test('rounds chain quarter -> semi -> finals, and finals terminates', () => {
  assertEquals(nextRoundOf('quarter'), 'semi');
  assertEquals(nextRoundOf('semi'), 'finals');
  assertEquals(nextRoundOf('finals'), null);
  assertEquals(nextRoundOf(null), null);
  assertEquals(nextRoundOf(undefined), null);
});

// ===========================================================================
// DEFECT 2 — the advancing seed is always team2's
// ===========================================================================

Deno.test('FIXED 2: the advancing winner carries its OWN seed', () => {
  // Was: always team2Seed, because the comparison read winner_user_id — a column
  // absent from the select list and written only later. The winner is now passed
  // in explicitly, so there is no unselected field to misread.
  const row = { team1UserId: 'alice', team2UserId: 'bot-1', team1Seed: 1, team2Seed: 4 };

  assertEquals(winnerSeedForAdvance(row, 'alice'), 1);
  assertEquals(winnerSeedForAdvance(row, 'bot-1'), 4);
});

Deno.test('FIXED 2: the seed tiebreaker the next round depends on is no longer corrupted', () => {
  // The composed regression: a 1-seed advancing recorded as a 4, meeting a genuine
  // 2-seed in the finals, used to hand the title to the wrong player on a tie.
  const semiRow = { team1UserId: 'alice', team2UserId: 'bot-1', team1Seed: 1, team2Seed: 4 };
  const advancedSeed = winnerSeedForAdvance(semiRow, 'alice'); // now 1, was 4

  const finals = decideMatchupOutcome(
    { team1UserId: 'alice', team2UserId: 'carol', team1Seed: advancedSeed, team2Seed: 2, isPlayoff: true, playoffRound: 'finals' },
    withPositions(7, 3), withPositions(7, 3),
  );

  assertEquals(advancedSeed, 1);
  assertEquals(finals.winnerId, 'alice', 'correct champion');
});
