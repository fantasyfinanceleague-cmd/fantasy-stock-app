/**
 * Pure scoring-eligibility decisions for process-week-results.
 *
 * Extracted from the Deno.serve handler so the refuse-don't-fabricate guards can
 * be unit-tested with no DB, no Alpaca, and no Deno runtime APIs — the same
 * hermetic pattern as ./grouping.ts. See scoring-eligibility.test.ts for the
 * regression coverage.
 *
 * THE DEFECT THESE ENCODE AGAINST: the snapshot-less fallback (calculatePortfolio
 * in index.ts) values holdings at TODAY's price and returns CUMULATIVE gain from
 * draft entry — a player's all-time P/L, NOT this week's delta (week_start_price
 * -> week_end_price). Scoring a week off that number fabricates results, and
 * because league_standings increments are irreversible, a re-run cannot undo it.
 * Three guards refuse rather than fabricate; every one of them is DECIDED here:
 *
 *   1. Stale batch    (decideBatchScoring): a snapshot-less week that ended
 *                      > fallbackMaxAgeHours ago is skipped whole
 *                      (reason 'stale_no_snapshots').
 *   2. Week>1 batch   (decideBatchScoring): a snapshot-less week past week 1 is
 *                      skipped whole (reason 'no_snapshots_week_gt_1') — even
 *                      INSIDE the freshness window, cumulative != weekly delta
 *                      once any prior week exists.
 *   3. Per-user gate  (decideUserScorer + decideMatchupScoring): the batch guards
 *                      key off hasSnapshots, which is true if ANYONE in the
 *                      league-week has a snapshot. In a PARTIALLY-snapshotted
 *                      week>1 a snapshot-less user would still reach the fallback,
 *                      so they are marked 'unscoreable' and any matchup they are in
 *                      is refused (reason 'unscoreable_participant_no_snapshot').
 *
 * These functions decide ONLY. All logging, DB writes, price fetches, and the
 * skipped[] payload shaping stay in index.ts — this module has no side effects and
 * no runtime dependencies, so it is trivially and hermetically testable. Where the
 * evaluation ORDER is load-bearing it is called out per function.
 */

// ---------------------------------------------------------------------------
// Reason strings — exported as constants so index.ts (the producer of the
// skipped[] payloads) and the tests (the assertions) share ONE source of truth.
// A drift between the two would otherwise be invisible until an ops query broke.
// ---------------------------------------------------------------------------

/** Reasons a whole (league, week) batch is skipped without any matchup write. */
export const BATCH_SKIP_REASON = {
  /** No snapshots AND the week ended longer ago than fallbackMaxAgeHours. */
  STALE_NO_SNAPSHOTS: 'stale_no_snapshots',
  /** No snapshots AND week_number > 1 (cumulative-from-entry != weekly delta). */
  NO_SNAPSHOTS_WEEK_GT_1: 'no_snapshots_week_gt_1',
} as const;
export type BatchSkipReason =
  (typeof BATCH_SKIP_REASON)[keyof typeof BATCH_SKIP_REASON];

/** Reason a single matchup is refused (team1_gain left NULL, no standings write). */
export const MATCHUP_REFUSAL_REASON = {
  /** A participant is snapshot-less past week 1, so the matchup can't be scored. */
  UNSCOREABLE_PARTICIPANT_NO_SNAPSHOT: 'unscoreable_participant_no_snapshot',
} as const;
export type MatchupRefusalReason =
  (typeof MATCHUP_REFUSAL_REASON)[keyof typeof MATCHUP_REFUSAL_REASON];

export type BatchDecision =
  | { action: 'proceed' }
  | { action: 'skip'; reason: BatchSkipReason };

/**
 * Which scorer the handler should run for a single user:
 *  - 'full'        -> calculateUserScore (snapshots + week_end_price + trades)
 *  - 'legacy'      -> calculateWeeklyGainLegacy (snapshots, live prices, no end price)
 *  - 'fallback'    -> calculatePortfolio (cumulative-from-entry — ONLY valid at week 1)
 *  - 'unscoreable' -> refuse; do NOT write a score (snapshot-less past week 1)
 */
export type ScorerKind = 'full' | 'legacy' | 'fallback' | 'unscoreable';

export type MatchupDecision =
  | { action: 'proceed' }
  | { action: 'refuse'; reason: MatchupRefusalReason };

// ---------------------------------------------------------------------------
// GUARDS 1 & 2 — batch level
// ---------------------------------------------------------------------------

export interface BatchScoringInputs {
  /** True if the (league, week) has ANY week_snapshots row. */
  hasSnapshots: boolean;
  /**
   * Hours since week_end. May be +Infinity when week_end is null — an unbounded
   * age, which correctly trips the stale guard for a snapshot-less batch.
   */
  weekAgeHours: number;
  weekNumber: number;
  /** FALLBACK_MAX_AGE_HOURS from index.ts (72). Passed in to keep this pure. */
  fallbackMaxAgeHours: number;
}

/**
 * Guards 1 & 2. A batch with snapshots always proceeds. A snapshot-less batch is
 * skipped if it is stale (> fallbackMaxAgeHours) OR past week 1.
 *
 * ORDER IS LOAD-BEARING: the freshness check is evaluated BEFORE the week>1 check,
 * mirroring the handler. So a snapshot-less, stale, week>1 batch reports
 * 'stale_no_snapshots' (the more specific operational cause — e.g. a key outage
 * that skipped snapshots days ago) rather than 'no_snapshots_week_gt_1'. Swapping
 * the order would relabel every stale week>1 skip and break ops dashboards that
 * separate the two.
 *
 * BOUNDARY: the comparison is strict `>`, so a batch that ended EXACTLY
 * fallbackMaxAgeHours ago is NOT stale — identical to the handler.
 */
export function decideBatchScoring(i: BatchScoringInputs): BatchDecision {
  if (!i.hasSnapshots && i.weekAgeHours > i.fallbackMaxAgeHours) {
    return { action: 'skip', reason: BATCH_SKIP_REASON.STALE_NO_SNAPSHOTS };
  }
  if (!i.hasSnapshots && i.weekNumber > 1) {
    return { action: 'skip', reason: BATCH_SKIP_REASON.NO_SNAPSHOTS_WEEK_GT_1 };
  }
  return { action: 'proceed' };
}

// ---------------------------------------------------------------------------
// GUARD 3a — per user
// ---------------------------------------------------------------------------

export interface UserScorerInputs {
  /** snapshots.length > 0 for THIS user (per-user, not the batch-level flag). */
  hasSnapshot: boolean;
  /** Batch-level: any snapshot row for the week carries a week_end_price. */
  hasWeekEndPrices: boolean;
  weekNumber: number;
}

/**
 * Guard 3a. Picks the scorer for one user, or marks them 'unscoreable'.
 *
 * The order mirrors the handler's if/else-if chain exactly:
 *   snapshot + end price -> 'full'
 *   snapshot only        -> 'legacy'
 *   no snapshot, week>1  -> 'unscoreable'  (the per-user residual of the defect:
 *                          cumulative-from-entry is all-time P/L, not a weekly
 *                          delta, once a prior week exists)
 *   no snapshot, week 1  -> 'fallback'     (draft entry ~= week-1 start price, so
 *                          cumulative-from-entry is an acceptable week-1 proxy)
 *
 * Note the snapshot branches win REGARDLESS of week number — a snapshotted user is
 * always scored from their snapshot; the week>1 refusal only ever applies to a
 * snapshot-less user.
 */
export function decideUserScorer(i: UserScorerInputs): ScorerKind {
  if (i.hasSnapshot && i.hasWeekEndPrices) return 'full';
  if (i.hasSnapshot) return 'legacy';
  if (i.weekNumber > 1) return 'unscoreable';
  return 'fallback';
}

// ---------------------------------------------------------------------------
// GUARD 3b — per matchup
// ---------------------------------------------------------------------------

/**
 * Guard 3b. Refuses a matchup if EITHER participant is unscoreable; otherwise the
 * matchup proceeds and is scored normally.
 *
 * BYE WEEKS gate on team1 only: a bye has team2UserId == null, so team2 is never
 * consulted (a null id can't be "unscoreable"). This is why team2UserId is
 * nullable and guarded — mirroring the handler's
 * `team2_user_id != null && unscoreableUserIds.has(...)`.
 *
 * This is the composition point that pins the KEY regression: in a partially-
 * snapshotted week>1, decideUserScorer marks only the snapshot-less user
 * 'unscoreable', so ONLY matchups containing that user are refused here — an
 * all-snapshotted matchup in the SAME week still proceeds and scores.
 */
export function decideMatchupScoring(
  team1UserId: string,
  team2UserId: string | null,
  unscoreableUserIds: ReadonlySet<string>,
): MatchupDecision {
  const team1Unscoreable = unscoreableUserIds.has(team1UserId);
  const team2Unscoreable =
    team2UserId != null && unscoreableUserIds.has(team2UserId);
  if (team1Unscoreable || team2Unscoreable) {
    return {
      action: 'refuse',
      reason: MATCHUP_REFUSAL_REASON.UNSCOREABLE_PARTICIPANT_NO_SNAPSHOT,
    };
  }
  return { action: 'proceed' };
}
