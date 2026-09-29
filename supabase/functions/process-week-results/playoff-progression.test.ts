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

import { assert, assertEquals, assertThrows } from 'jsr:@std/assert';
import { planBracket, playoffShape } from '../_shared/playoff-bracket.ts';
import {
  decideMatchupOutcome,
  willAdvanceWinner,
  planAdvance,
  isScoreableNow,
  findMissedAdvances,
  type PlayoffRowState,
  winnerSeedForAdvance,
  resolveBySeed,
  standingsIncrements,
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

Deno.test('a regular-season bye is NO RESULT: no winner, not a tie, no W/L/T', () => {
  const m = regular({ team2UserId: null });
  for (const score of [empty, withPositions(500, 5)]) {
    const outcome = decideMatchupOutcome(m, score, empty);
    assertEquals(outcome, { winnerId: null, isTie: false, team1Won: false, team2Won: false, reason: 'bye_no_result' });
    assertEquals(standingsIncrements(outcome), { team1: { wins: 0, losses: 0, ties: 0 }, team2: null });
    assertEquals(willAdvanceWinner(m, outcome), false);
  }
});

Deno.test('standingsIncrements: a win, a loss and a true tie each count exactly one game', () => {
  const m = regular();
  const won = decideMatchupOutcome(m, withPositions(10, 1), withPositions(5, 1));
  assertEquals(standingsIncrements(won), {
    team1: { wins: 1, losses: 0, ties: 0 },
    team2: { wins: 0, losses: 1, ties: 0 },
  });
  const tie = decideMatchupOutcome(m, withPositions(3, 2), withPositions(3, 2));
  assertEquals(standingsIncrements(tie), {
    team1: { wins: 0, losses: 0, ties: 1 },
    team2: { wins: 0, losses: 0, ties: 1 },
  });
  const bothEmpty = decideMatchupOutcome(m, empty, empty);
  assertEquals(standingsIncrements(bothEmpty).team1, { wins: 0, losses: 0, ties: 1 });
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
// DEFECT 3 — advancement by ADDRESS, not "first empty slot"
// ===========================================================================

Deno.test('FIXED 3: a winner goes to (round+1, floor(pos/2)), slot by parity, with its own seed', () => {
  const row = (roundNumber: number, position: number) =>
    ({ roundNumber, position, team1UserId: 'hi', team2UserId: 'lo', team1Seed: 3, team2Seed: 6 });
  assertEquals(planAdvance(row(1, 2), 'hi', 3), { kind: 'advance', round: 2, position: 1, slot: 'team1', userId: 'hi', seed: 3 });
  assertEquals(planAdvance(row(1, 3), 'lo', 3), { kind: 'advance', round: 2, position: 1, slot: 'team2', userId: 'lo', seed: 6 });
  assertEquals(planAdvance(row(2, 1), 'lo', 3), { kind: 'advance', round: 3, position: 0, slot: 'team2', userId: 'lo', seed: 6 });
  assertEquals(planAdvance(row(3, 0), 'hi', 3), { kind: 'final' });
  assertEquals(planAdvance(row(1, 0), 'hi', 1), { kind: 'final' }, 'P=2: round 1 is the final');
  assertThrows(() => planAdvance(row(1, 4), 'hi', 3), RangeError);
});

Deno.test("FIXED 3: P=6 — W(4v5) meets seed 1 and W(3v6) meets seed 2, in whatever order they're scored", () => {
  // The old fill put the first-processed winner into the first empty slot of
  // any semi, so 3v6's winner could meet seed 1. planAdvance has no order input.
  const plan = planBracket(6);
  const r1 = plan.filter((g) => g.round === 1); // #1 4v5, #2 3v6
  const target = (pos: number) => {
    const a = planAdvance({ roundNumber: 1, position: pos, team1UserId: 'x', team2UserId: 'y', team1Seed: 0, team2Seed: 0 }, 'x', 3);
    assert(a.kind === 'advance');
    return [a.round, a.position, a.slot];
  };
  assertEquals(r1.map((g) => g.position), [1, 2]);
  assertEquals(target(1), [2, 0, 'team2']); // semi #0: seed 1 (team1) vs W(4v5)
  assertEquals(target(2), [2, 1, 'team1']); // semi #1: W(3v6) vs seed 2 (team2)
});

// ===========================================================================
// DEFECT 4 — a half-filled playoff row is awaiting, never a walkover
// ===========================================================================

Deno.test('FIXED 4: a playoff row needs both teams to be scored; a regular bye does not', () => {
  assertEquals(isScoreableNow({ is_playoff: true, team1_user_id: 'seed1', team2_user_id: null }), false);
  assertEquals(isScoreableNow({ is_playoff: true, team1_user_id: null, team2_user_id: 'seed2' }), false);
  assertEquals(isScoreableNow({ is_playoff: true, team1_user_id: null, team2_user_id: null }), false);
  assertEquals(isScoreableNow({ is_playoff: true, team1_user_id: 'a', team2_user_id: 'b' }), true);
  assertEquals(isScoreableNow({ is_playoff: false, team1_user_id: 'a', team2_user_id: null }), true, 'regular bye');
  assertEquals(isScoreableNow({ is_playoff: null, team1_user_id: 'a', team2_user_id: 'b' }), true);
  assertEquals(isScoreableNow({ is_playoff: false, team1_user_id: null, team2_user_id: 'b' }), false);
});

// ===========================================================================
// The missed-advance heal
// ===========================================================================

/** A P-team bracket's rows with seed user ids 'sN', as start_league_playoffs inserts them. */
function bracketRows(p: number): PlayoffRowState[] {
  return planBracket(p).map((g, i) => ({
    id: `m${i}`,
    roundNumber: g.round,
    position: g.position,
    team1UserId: g.team1.kind === 'seed' ? `s${g.team1.seed}` : null,
    team2UserId: g.team2.kind === 'seed' ? `s${g.team2.seed}` : null,
    team1Seed: g.team1.kind === 'seed' ? g.team1.seed : null,
    team2Seed: g.team2.kind === 'seed' ? g.team2.seed : null,
    scored: false,
    winnerUserId: null,
  }));
}
const at = (rows: PlayoffRowState[], round: number, position: number) =>
  rows.find((r) => r.roundNumber === round && r.position === position)!;

Deno.test('heal: a fresh bracket, and one whose advances all landed, need nothing', () => {
  for (let p = 2; p <= 16; p++) {
    assertEquals(findMissedAdvances(bracketRows(p), playoffShape(p).weeks), { advances: [], conflicts: [] }, `P=${p}`);
  }
  const rows = bracketRows(6);
  Object.assign(at(rows, 1, 1), { scored: true, winnerUserId: 's5' });
  Object.assign(at(rows, 2, 0), { team2UserId: 's5', team2Seed: 5 }); // the advance landed
  assertEquals(findMissedAdvances(rows, 3), { advances: [], conflicts: [] });
});

Deno.test('heal: a scored game whose winner never reached its slot is re-advanced, per game', () => {
  const rows = bracketRows(6);
  Object.assign(at(rows, 1, 1), { scored: true, winnerUserId: 's5' }); // landed
  Object.assign(at(rows, 2, 0), { team2UserId: 's5', team2Seed: 5 });
  Object.assign(at(rows, 1, 2), { scored: true, winnerUserId: 's3' }); // did NOT land
  const { advances, conflicts } = findMissedAdvances(rows, 3);
  assertEquals(conflicts, []);
  assertEquals(advances, [{ fromId: at(rows, 1, 2).id, plan: { kind: 'advance', round: 2, position: 1, slot: 'team1', userId: 's3', seed: 3 } }]);
});

Deno.test('heal: a slot held by someone else, a missing target, or a winnerless scored game is reported, never overwritten', () => {
  const rows = bracketRows(4);
  Object.assign(at(rows, 1, 0), { scored: true, winnerUserId: 's1' });
  Object.assign(at(rows, 2, 0), { team1UserId: 's3', team1Seed: 3 }); // wrong occupant
  Object.assign(at(rows, 1, 1), { scored: true, winnerUserId: null });
  let r = findMissedAdvances(rows, 2);
  assertEquals(r.advances, []);
  assertEquals(r.conflicts.map((c) => c.reason).sort(), ['playoff_game_scored_without_winner', 'playoff_slot_taken: round 2 position 0 team1']);

  const noFinal = bracketRows(4).filter((x) => x.roundNumber === 1);
  Object.assign(noFinal[0], { scored: true, winnerUserId: 's1' });
  r = findMissedAdvances(noFinal, 2);
  assertEquals(r.conflicts.map((c) => c.reason), ['playoff_target_missing: round 2 position 0']);
});

Deno.test('heal: the scored final needs no advance; unscored placeholders are ignored', () => {
  const rows = bracketRows(2);
  Object.assign(rows[0], { scored: true, winnerUserId: 's2' });
  assertEquals(findMissedAdvances(rows, 1), { advances: [], conflicts: [] });
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
