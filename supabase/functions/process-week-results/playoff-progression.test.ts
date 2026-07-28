/**
 * Hermetic tests for ./playoff-progression.ts.
 *
 *   deno test supabase/functions/process-week-results/playoff-progression.test.ts
 *
 * No DB, no Alpaca, no secrets, no --allow-* flags. Same pattern as
 * grouping.test.ts and scoring-eligibility.test.ts.
 *
 * READ THIS BEFORE "FIXING" A FAILING ASSERTION.
 * The tests under "DEFECT 1" and "DEFECT 2" are CHARACTERIZATION tests: they
 * assert what the code does TODAY, not what it should do. They are the evidence
 * that the defects are real. When either defect is fixed, the matching test MUST
 * be inverted — each one says exactly how, inline. Every such test is named with
 * a `DEFECT n:` prefix so nothing here can be mistaken for endorsed behaviour.
 */

import { assertEquals } from 'jsr:@std/assert';
import {
  decideMatchupOutcome,
  willAdvanceWinner,
  nextRoundOf,
  winnerSeedForAdvance,
  correctWinnerSeed,
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

Deno.test('DEFECT 1: a playoff matchup where BOTH teams are empty produces no winner', () => {
  // index.ts:1194 sets isTie without checking isPlayoff, so this is the only
  // playoff path that leaves winnerId null.
  //
  // WHEN FIXED (add an isPlayoff seed tiebreak to the both-empty branch), invert to:
  //   assertEquals(outcome.winnerId, 'alice');   // seed 1 beats seed 4
  //   assertEquals(outcome.isTie, false);
  const m = semi();
  const outcome = decideMatchupOutcome(m, empty, empty);

  assertEquals(outcome.reason, 'both_empty_tie');
  assertEquals(outcome.winnerId, null);
  assertEquals(outcome.isTie, true);
});

Deno.test('DEFECT 1: that outcome blocks advancement, so the finals placeholder is never filled', () => {
  // The whole impact chain in one assertion. willAdvanceWinner mirrors
  // index.ts:1270 `if (isPlayoff && winnerId)`. False here means
  // advancePlayoffWinner is never called, the finals row keeps team1_user_id
  // NULL, and the pending-matchup query (index.ts:874,
  // `.not('team1_user_id','is',null)`) can never select it again.
  //
  // WHEN FIXED: assertEquals(..., true).
  const m = semi();
  const outcome = decideMatchupOutcome(m, empty, empty);
  assertEquals(willAdvanceWinner(m, outcome), false, 'the finals never gets populated');
});

Deno.test('DEFECT 1 is specific to BOTH being empty — one empty side advances fine', () => {
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

Deno.test('DEFECT 1: an unpopulated playoff placeholder is also both-empty', () => {
  // A finals row whose slots were never filled has team2UserId null. It is NOT a
  // bye (index.ts:1166 requires !isPlayoff), so it falls through to the
  // both-empty branch and cannot resolve — the failure is self-sustaining.
  const m = semi({ playoffRound: 'finals', team2UserId: null, team2Seed: null });
  const outcome = decideMatchupOutcome(m, empty, empty);
  assertEquals(outcome.winnerId, null);
  assertEquals(willAdvanceWinner(m, outcome), false);
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

Deno.test('DEFECT 2: the advancing winner always carries team2_seed, even when team1 won', () => {
  // index.ts:689 compares matchup.winner_user_id, which is absent from the
  // pending-matchup select list (index.ts:857-871) and is only written later by
  // the UPDATE at index.ts:1254. So it is undefined at read time and the strict
  // comparison never holds.
  //
  // WHEN FIXED (compare against the winnerId argument, or add winner_user_id to
  // the select), invert to: assertEquals(winnerSeedForAdvance(row), 1).
  const row = { team1UserId: 'alice', team2UserId: 'bot-1', team1Seed: 1, team2Seed: 4 };

  assertEquals(winnerSeedForAdvance(row), 4, 'wrong: alice is seed 1');
  assertEquals(correctWinnerSeed(row, 'alice'), 1, 'what it should be');
});

Deno.test('DEFECT 2 is invisible when team2 happens to win', () => {
  // Why it went unnoticed: half of all advancements are accidentally right.
  const row = { team1UserId: 'alice', team2UserId: 'bot-1', team1Seed: 1, team2Seed: 4 };
  assertEquals(winnerSeedForAdvance(row), correctWinnerSeed(row, 'bot-1'));
});

Deno.test('DEFECT 2 corrupts the seed tiebreaker the next round depends on', () => {
  // Compose the two: a 1-seed advances recorded as a 4, then meets a genuine
  // 2-seed in the finals. On a double tie the seed tiebreaker sends the WRONG
  // team through, because the seed it reads is fabricated.
  const semiRow = { team1UserId: 'alice', team2UserId: 'bot-1', team1Seed: 1, team2Seed: 4 };
  const recordedSeed = winnerSeedForAdvance(semiRow);   // 4, should be 1
  const trueSeed = correctWinnerSeed(semiRow, 'alice'); // 1

  const finalsAsRecorded = decideMatchupOutcome(
    { team1UserId: 'alice', team2UserId: 'carol', team1Seed: recordedSeed, team2Seed: 2, isPlayoff: true, playoffRound: 'finals' },
    withPositions(7, 3), withPositions(7, 3),
  );
  const finalsAsShouldBe = decideMatchupOutcome(
    { team1UserId: 'alice', team2UserId: 'carol', team1Seed: trueSeed, team2Seed: 2, isPlayoff: true, playoffRound: 'finals' },
    withPositions(7, 3), withPositions(7, 3),
  );

  assertEquals(finalsAsRecorded.winnerId, 'carol', 'wrong champion, from the fabricated seed');
  assertEquals(finalsAsShouldBe.winnerId, 'alice', 'correct champion');
});
