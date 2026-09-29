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
 * buildPlayoffBracket (season-transition.ts; was index.ts:566 generateBracket, and
 * the rows are now inserted atomically by start_league_playoffs) creates the finals row as a PLACEHOLDER at the
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

import { nextSlot, type PlayoffRoundCode } from '../_shared/playoff-bracket.ts';

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

/** The structural round code stored in matchups.playoff_round (by distance
 * from the final). Never used to decide advancement: that keys on the row's
 * address (playoff_round_number, bracket_position). */
export type PlayoffRound = PlayoffRoundCode;

/** Why the outcome came out the way it did. Mirrors the handler's log lines. */
export type OutcomeReason =
  | 'bye_no_result'
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
    // A regular-season bye is NO RESULT (Giorgio, 2026-09-29): not a win, not a
    // loss, not a tie. It used to be an automatic win, which handed uneven free
    // wins to odd-roster leagues (byes are not evenly spread when num_weeks is
    // not a multiple of the roster size).
    //
    // winner NULL + is_tie false is the same row shape a scored bye has always
    // had apart from the winner, so the row's discriminator is NOT the NULL
    // winner: it is `team2_user_id IS NULL AND NOT is_playoff` (CLAUDE.md
    // "overloaded NULLs are type tags"). Consumers must key on that, never read
    // a NULL winner on a scored row as a tie. The standings writer keys on this
    // reason via standingsIncrements (no W/L/T, no games played).
    return { winnerId: null, isTie: false, team1Won: false, team2Won: false, reason: 'bye_no_result' };
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

// ---------------------------------------------------------------------------
// Addressed advancement (flexible playoffs, 20261012000000)
// ---------------------------------------------------------------------------
//
// DEFECT 3 FIXED — advancement is by ADDRESS, not "first empty slot".
// advancePlayoffWinner used to select every next-round row with an empty slot
// (in no particular order) and write the winner into the first one. So the
// bracket was not actually fixed even for 8 teams: 1v8's winner could meet
// 2v7's, depending on the order the quarterfinals were processed. With byes it
// would be wrong outright (a round-2 row already holds the bye seed in one
// slot). Now the winner of (round r, position p) goes to exactly
// (r+1, floor(p/2)), slot team1 if p is even else team2 (nextSlot, pure and
// exhaustively tested in _shared/playoff-bracket.test.ts).

/** A playoff row's address plus what the advance writes from it. */
export interface AddressedRow extends AdvancingRow {
  roundNumber: number;
  position: number;
}

export type AdvancePlan =
  | { kind: 'final' }
  | { kind: 'advance'; round: number; position: number; slot: 'team1' | 'team2'; userId: string; seed: number | null };

/** Where this row's winner goes (or 'final' when it was the final). `weeks`
 * is W for the league's playoff_teams. Throws on an address outside the
 * bracket, which start_league_playoffs makes impossible for its rows. */
export function planAdvance(row: AddressedRow, winnerId: string, weeks: number): AdvancePlan {
  const next = nextSlot(row.roundNumber, row.position, weeks);
  if (!next) return { kind: 'final' };
  return { kind: 'advance', ...next, userId: winnerId, seed: winnerSeedForAdvance(row, winnerId) };
}

/**
 * Whether a pending row may be scored now. A playoff row needs BOTH teams:
 * one with a NULL slot is still awaiting its feeder's winner.
 *
 * DEFECT 4 FIXED. The pending query only required team1, so once its week
 * ended, a HALF-filled later-round row was selected and scored as a walkover
 * (team2_empty_auto_loss / playoff_no_opponent) — latent for a 4-team bracket
 * whose semi was refused past the final's week, and the NORMAL state with byes
 * (every round-2 row starts as "bye seed vs NULL"). A regular-season row with
 * team2 NULL is a bye and stays scoreable (it is recorded as no result).
 */
export function isScoreableNow(m: { is_playoff?: boolean | null; team1_user_id: string | null; team2_user_id: string | null }): boolean {
  if (!m.team1_user_id) return false;
  if (m.is_playoff === true) return !!m.team2_user_id;
  return true;
}

/** A playoff row as the heal pass reads it (placeholders have NULL teams). */
export interface PlayoffRowState {
  id: string;
  roundNumber: number;
  position: number;
  team1UserId: string | null;
  team2UserId: string | null;
  team1Seed: number | null;
  team2Seed: number | null;
  scored: boolean; // team1_gain IS NOT NULL
  winnerUserId: string | null;
}

export interface MissedAdvance {
  fromId: string;
  plan: Extract<AdvancePlan, { kind: 'advance' }>;
}

/**
 * Heal-pass decision: scored playoff games whose winner never reached the next
 * round. Once a game is scored it is never selected again, so an advance that
 * failed (a transport error, a crash between the two writes) would leave the
 * next-round slot NULL FOREVER, and that game could then never be played: a
 * recoverable gap made permanent (the CLAUDE.md partial-state family). This
 * compares EVERY scored game against its target slot, per game:
 *   target slot NULL          -> advance again (idempotent: the write is
 *                                conditional on the slot still being NULL)
 *   target slot = the winner  -> already done
 *   target slot = someone else, target row missing, or a scored game with no
 *   winner                    -> a conflict, REPORTED and never overwritten.
 * Unscored rows (including placeholders) are ignored. `rows` is ONE league's
 * complete set of playoff rows.
 */
export function findMissedAdvances(
  rows: PlayoffRowState[],
  weeks: number,
): { advances: MissedAdvance[]; conflicts: Array<{ fromId: string; reason: string }> } {
  const advances: MissedAdvance[] = [];
  const conflicts: Array<{ fromId: string; reason: string }> = [];
  const at = new Map(rows.map((r) => [`${r.roundNumber}:${r.position}`, r]));

  for (const r of rows) {
    if (!r.scored) continue;
    if (!r.winnerUserId || !r.team1UserId) {
      conflicts.push({ fromId: r.id, reason: 'playoff_game_scored_without_winner' });
      continue;
    }
    let plan: AdvancePlan;
    try {
      plan = planAdvance({ ...r, team1UserId: r.team1UserId }, r.winnerUserId, weeks);
    } catch (e) {
      conflicts.push({ fromId: r.id, reason: `playoff_row_bad_address: ${(e as Error).message}` });
      continue;
    }
    if (plan.kind === 'final') continue;
    const target = at.get(`${plan.round}:${plan.position}`);
    if (!target) {
      conflicts.push({ fromId: r.id, reason: `playoff_target_missing: round ${plan.round} position ${plan.position}` });
      continue;
    }
    const current = plan.slot === 'team1' ? target.team1UserId : target.team2UserId;
    if (current === null || current === undefined) advances.push({ fromId: r.id, plan });
    else if (current !== plan.userId) {
      conflicts.push({ fromId: r.id, reason: `playoff_slot_taken: round ${plan.round} position ${plan.position} ${plan.slot}` });
    }
  }
  return { advances, conflicts };
}

// ---------------------------------------------------------------------------
// Standings increments — what updateUserStandings adds per participant
// ---------------------------------------------------------------------------

export interface RecordIncrement {
  wins: number;
  losses: number;
  ties: number;
}

/**
 * The W/L/T each side of a scored regular-season matchup adds to
 * league_standings. A bye adds NOTHING to either record, so it is not a game
 * played. W + L + T stays exactly the non-bye games played, which is the
 * denominator of the win% ranking key (league_standings_ranked). team2 is null
 * on a bye: there is no second participant to update.
 *
 * points_for is deliberately NOT here: a bye week still adds the manager's real
 * weekly dollar gain to season gain, so everyone's season gain covers the same
 * weeks.
 */
export function standingsIncrements(outcome: Outcome): { team1: RecordIncrement; team2: RecordIncrement | null } {
  if (outcome.reason === 'bye_no_result') {
    return { team1: { wins: 0, losses: 0, ties: 0 }, team2: null };
  }
  const t = outcome.isTie ? 1 : 0;
  return {
    team1: { wins: outcome.team1Won ? 1 : 0, losses: outcome.team2Won ? 1 : 0, ties: t },
    team2: { wins: outcome.team2Won ? 1 : 0, losses: outcome.team1Won ? 1 : 0, ties: t },
  };
}
