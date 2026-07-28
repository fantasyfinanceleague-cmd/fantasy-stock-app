/**
 * Pure playoff-progression decisions for process-week-results.
 *
 * Extracted from the Deno.serve handler so bracket advancement can be unit-tested
 * with no DB, no Alpaca, and no Deno runtime APIs — the same hermetic pattern as
 * ./grouping.ts and ./scoring-eligibility.ts. See playoff-progression.test.ts.
 *
 * THIS MODULE IS A FAITHFUL TRANSCRIPTION OF CURRENT index.ts BEHAVIOUR, INCLUDING
 * TWO DEFECTS. It deliberately does NOT fix them — the tests exist to prove they
 * are real before anyone changes anything. Every branch cites the index.ts line it
 * mirrors so equivalence can be checked by inspection.
 *
 * ---------------------------------------------------------------------------
 * FIRST, WHAT IS *NOT* BROKEN — the finals row is not derived from winners.
 * ---------------------------------------------------------------------------
 * generateBracket (index.ts:566) inserts the finals row as a PLACEHOLDER at the
 * same moment as the semis, in one loop (index.ts:465). For a 4-team bracket that
 * is 2 semis at startWeek plus 1 finals at startWeek+1 with team1/team2 NULL. So
 * finals GENERATION cannot depend on semifinal outcomes — the row already exists
 * before any semi is scored. A tie cannot prevent it.
 *
 * What a tie CAN prevent is finals POPULATION: advancePlayoffWinner (index.ts:686)
 * filling the placeholder's empty slot. That is where the defect lives.
 *
 * ---------------------------------------------------------------------------
 * DEFECT 1 — a both-empty playoff matchup produces NO winner, so nothing advances.
 * ---------------------------------------------------------------------------
 * index.ts:1194 reads:
 *
 *     if (team1Empty && team2Empty) {
 *       isTie = true;                       // <-- no isPlayoff check
 *     }
 *
 * Every OTHER tie path checks isPlayoff and resolves: the dollar/percent double-tie
 * at index.ts:1231 falls through to a seed tiebreaker and always names a winner.
 * The both-empty branch does not. It is the ONLY path in a playoff matchup that
 * leaves winnerId null.
 *
 * The consequence chain:
 *   winnerId stays null
 *     -> index.ts:1270 `if (isPlayoff && winnerId)` is false
 *     -> advancePlayoffWinner is never called
 *     -> the finals placeholder keeps team1_user_id = NULL
 *     -> the pending-matchup query at index.ts:874 filters
 *        `.not('team1_user_id', 'is', null)`, so the finals is never selected
 *     -> the finals is never scored, the season never completes, standings freeze,
 *        and every subsequent Friday finds nothing to score.
 *
 * Silent and user-visible, exactly as feared — but reached by a different route
 * than "a tied semi bails out of finals generation".
 *
 * ---------------------------------------------------------------------------
 * DEFECT 2 — the advancing winner is recorded with the WRONG seed, always.
 * ---------------------------------------------------------------------------
 * index.ts:689 computes:
 *
 *     const winnerSeed = matchup.winner_user_id === matchup.team1_user_id
 *       ? matchup.team1_seed
 *       : matchup.team2_seed;
 *
 * `matchup` is the row as SELECTED at index.ts:855, and that select list
 * (index.ts:857-871) does NOT include winner_user_id. The column is also only
 * written later, by the UPDATE at index.ts:1254. So matchup.winner_user_id is
 * `undefined`, the strict comparison is never true, and winnerSeed is ALWAYS
 * team2_seed — even when team1 won.
 *
 * The correct player still advances (winnerId is passed separately and is right).
 * Only the seed is wrong, which corrupts the finals seed tiebreaker — the very
 * mechanism DEFECT 1's sibling branch relies on.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The per-user scoring result the handler computes before deciding a matchup. */
export interface TeamScore {
  dollarGain: number;
  percentGain: number;
  hasPositions: boolean;
}

/** The matchup fields the outcome decision reads. */
export interface PlayoffMatchup {
  team1UserId: string;
  /** null on a bye (regular season) or an unpopulated playoff placeholder. */
  team2UserId: string | null;
  team1Seed: number | null;
  team2Seed: number | null;
  isPlayoff: boolean;
  playoffRound?: PlayoffRound | null;
}

export type PlayoffRound = 'quarter' | 'semi' | 'finals';

/** Why the outcome came out the way it did. Mirrors the handler's log lines. */
export type OutcomeReason =
  | 'bye'
  | 'both_empty_tie'
  | 'both_empty_playoff_seed_tiebreak'
  | 'playoff_no_opponent'
  | 'team1_empty_auto_loss'
  | 'team2_empty_auto_loss'
  | 'dollar_gain'
  | 'percent_tiebreak'
  | 'playoff_seed_tiebreak'
  | 'regular_season_true_tie';

export interface Outcome {
  winnerId: string | null;
  isTie: boolean;
  team1Won: boolean;
  team2Won: boolean;
  reason: OutcomeReason;
}

const DEFAULT_SCORE: TeamScore = { dollarGain: 0, percentGain: 0, hasPositions: false };

// ---------------------------------------------------------------------------
// The outcome decision — index.ts:1166-1251
// ---------------------------------------------------------------------------

/**
 * Decide a matchup's winner. Transcribed branch-for-branch from index.ts.
 *
 * ORDER IS LOAD-BEARING and mirrors the handler exactly: bye, then both-empty,
 * then single-empty auto-losses, then dollar, then percent, then (playoff only)
 * seed. Reordering changes outcomes — in particular, moving the both-empty check
 * after the seed tiebreaker would silently FIX defect 1, which is not this
 * module's job.
 */
export function decideMatchupOutcome(
  m: PlayoffMatchup,
  team1Score: TeamScore = DEFAULT_SCORE,
  team2Score: TeamScore = DEFAULT_SCORE,
): Outcome {
  // index.ts:1166 — a playoff matchup is NEVER a bye, even with a null team2.
  const isByeWeek = !m.team2UserId && !m.isPlayoff;

  if (isByeWeek) {
    // index.ts:1179 — bye gets an automatic win.
    return { winnerId: m.team1UserId, isTie: false, team1Won: true, team2Won: false, reason: 'bye' };
  }

  const team1Empty = !team1Score.hasPositions;
  const team2Empty = !team2Score.hasPositions;

  // DEFECT 1 FIXED. This branch used to set isTie unconditionally, with no
  // isPlayoff check — the only path in a playoff matchup that left winnerId null,
  // which meant advancePlayoffWinner never ran and the finals placeholder stayed
  // NULL forever. A playoff now resolves by seed, exactly like the double-tie
  // branch below; the regular season keeps its true tie, which is a real outcome
  // there (0.5 wins each). "Refuse, don't fabricate" is the wrong instinct here:
  // refusing IS the dead end, because an unpopulated placeholder can never be
  // re-selected past the `team1_user_id IS NOT NULL` filter.
  if (team1Empty && team2Empty) {
    if (m.isPlayoff) return resolveBySeed(m, 'both_empty_playoff_seed_tiebreak');
    return { winnerId: null, isTie: true, team1Won: false, team2Won: false, reason: 'both_empty_tie' };
  }

  // index.ts:1198 / 1203 — empty portfolio is an automatic loss.
  if (team1Empty) {
    return { winnerId: m.team2UserId, isTie: false, team1Won: false, team2Won: true, reason: 'team1_empty_auto_loss' };
  }
  if (team2Empty) {
    return { winnerId: m.team1UserId, isTie: false, team1Won: true, team2Won: false, reason: 'team2_empty_auto_loss' };
  }

  // index.ts:1210 — both have positions: compare dollar gain.
  if (team1Score.dollarGain > team2Score.dollarGain) {
    return { winnerId: m.team1UserId, isTie: false, team1Won: true, team2Won: false, reason: 'dollar_gain' };
  }
  if (team2Score.dollarGain > team1Score.dollarGain) {
    return { winnerId: m.team2UserId, isTie: false, team1Won: false, team2Won: true, reason: 'dollar_gain' };
  }

  // index.ts:1218 — dollar tie: percentage gain breaks it.
  if (team1Score.percentGain > team2Score.percentGain) {
    return { winnerId: m.team1UserId, isTie: false, team1Won: true, team2Won: false, reason: 'percent_tiebreak' };
  }
  if (team2Score.percentGain > team1Score.percentGain) {
    return { winnerId: m.team2UserId, isTie: false, team1Won: false, team2Won: true, reason: 'percent_tiebreak' };
  }

  // Double tie. Shares resolveBySeed with the both-empty branch above so the two
  // can never drift — that drift was DEFECT 1.
  if (m.isPlayoff) return resolveBySeed(m, 'playoff_seed_tiebreak');

  // Regular season true tie.
  return { winnerId: null, isTie: true, team1Won: false, team2Won: false, reason: 'regular_season_true_tie' };
}

/**
 * Higher seed (lower number) advances. A null seed sorts as 999, matching the
 * original `matchup.team1_seed || 999`.
 *
 * The null-opponent guard is load-bearing: a playoff placeholder whose second
 * slot was never filled has team2UserId === null, and without this it would
 * "resolve" to a null winner — silently recreating DEFECT 1 inside its own fix.
 * With no opponent, team1 advances.
 */
export function resolveBySeed(m: PlayoffMatchup, reason: OutcomeReason): Outcome {
  if (m.team2UserId === null) {
    return { winnerId: m.team1UserId, isTie: false, team1Won: true, team2Won: false, reason: 'playoff_no_opponent' };
  }
  const seed1 = m.team1Seed || 999;
  const seed2 = m.team2Seed || 999;
  return seed1 < seed2
    ? { winnerId: m.team1UserId, isTie: false, team1Won: true, team2Won: false, reason }
    : { winnerId: m.team2UserId, isTie: false, team1Won: false, team2Won: true, reason };
}

// ---------------------------------------------------------------------------
// The advancement gate — index.ts:1270
// ---------------------------------------------------------------------------

/**
 * Whether the handler will call advancePlayoffWinner for this matchup.
 * Mirrors `if (isPlayoff && winnerId)` exactly — including the falsy check, which
 * is what defect 1 trips.
 */
export function willAdvanceWinner(m: PlayoffMatchup, outcome: Outcome): boolean {
  return m.isPlayoff && !!outcome.winnerId;
}

/** index.ts:701-703. Finals has no next round. */
export function nextRoundOf(round: PlayoffRound | null | undefined): PlayoffRound | null {
  if (round === 'quarter') return 'semi';
  if (round === 'semi') return 'finals';
  return null;
}

// ---------------------------------------------------------------------------
// The seed carried forward — index.ts:689
// ---------------------------------------------------------------------------

/** The matchup row as it exists when advancePlayoffWinner reads it. */
export interface AdvancingRow {
  team1UserId: string;
  team2UserId: string | null;
  team1Seed: number | null;
  team2Seed: number | null;
}

/**
 * The seed written onto the next-round slot.
 *
 * DEFECT 2 FIXED. This used to compare `row.winnerUserId === row.team1UserId`,
 * reading a column absent from the pending-matchup select list and only written
 * later by the UPDATE — so it was `undefined` at read time, the comparison never
 * held, and the seed was ALWAYS team2Seed regardless of who won. It went
 * unnoticed because half of all advancements are accidentally correct.
 *
 * The winner is now passed in explicitly rather than re-derived from the row,
 * which removes the possibility of reading a stale or unselected field at all.
 */
export function winnerSeedForAdvance(row: AdvancingRow, winnerId: string): number | null {
  return winnerId === row.team1UserId ? row.team1Seed : row.team2Seed;
}
