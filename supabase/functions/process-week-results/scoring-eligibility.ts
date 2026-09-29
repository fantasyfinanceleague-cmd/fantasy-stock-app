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
 *   4. All-cash user  (ledgerPositionState + decideUserScorer -> 'cash_only'): a
 *                      snapshot-less user is NOT automatically a broken snapshot.
 *                      snapshot-week-start only snapshots HELD symbols, so a user
 *                      sitting entirely in cash correctly has no row — and before
 *                      this branch they were 'unscoreable' past week 1 (a matchup
 *                      refused forever, with nothing to backfill) or an accidental
 *                      week-1 auto-loss. See "THE ALL-CASH RULE" below.
 *
 * THE ALL-CASH RULE (CLAUDE.md's partial-state / existence-only family):
 *   "No snapshot row" alone proves nothing — it is exactly what a failed snapshot
 *   job also looks like. A snapshot-less user is scored as all-cash ONLY when the
 *   LEDGER (drafts + trades, netted per symbol, SKIP draft rows excluded) proves
 *   BOTH boundaries empty:
 *     - flat at week_start: nothing snapshot-week-start should have written.
 *     - flat at week_end:   nothing snapshot-week-end should have written.
 *       snapshot-week-end INSERTs an entered_mid_week row for every position held
 *       at the close, so "flat at start, held at end, no row" is a MISSING
 *       week-end snapshot — and scoring it would silently drop that buy (no end
 *       price => $0 contribution). Checking only the start boundary would be the
 *       same partial-state bug one step later.
 *   With both boundaries flat, every lot opened in the week also closed in it, so
 *   the score is fully determined by trade prices and nothing can be missing.
 *   Anything else stays 'unscoreable' (week>1) — the regression guard for a
 *   genuinely broken snapshot job. Every ambiguity FAILS CLOSED to "held": a null
 *   week bound, an unparseable created_at, a non-finite quantity, or no ledger
 *   supplied at all.
 *
 * KNOWN LIMIT (fails in the REFUSING direction): snapshot-week-start computes
 * holdings at RUN time (cron Mon/Tue 14:35Z), not at week_start (14:30Z). A user
 * who liquidates in that gap is ledger-held at week_start with no row, so they are
 * refused ('unscoreable') — a false refusal, never a fabricated score.
 *
 * These functions decide ONLY. All logging, DB writes, price fetches, and the
 * skipped[] payload shaping stay in index.ts — this module has no side effects and
 * no runtime dependencies beyond the pure ../_shared/draft-validation.ts constant,
 * so it is trivially and hermetically testable. Where the
 * evaluation ORDER is load-bearing it is called out per function.
 */

// SKIP_SYMBOL marks a forfeited draft pick. ../_shared/draft-validation.ts is itself
// pure and import-free, so importing it keeps this module hermetic while keeping
// ONE definition of the sentinel.
import { SKIP_SYMBOL } from '../_shared/draft-validation.ts';

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
  /**
   * A query feeding the scoring decision (snapshots, drafts, ledger trades,
   * mid-week trades) returned an error. supabase-js resolves `{ data, error }`
   * rather than throwing, and a failed query's `data` is null — which the
   * handler's `?? []` would otherwise read as "no rows": no snapshots, no
   * holdings, EVERYONE FLAT. That is the false-flat trap, so the batch is refused
   * (recoverable: team1_gain stays NULL and the next run retries).
   */
  SCORING_INPUTS_FETCH_FAILED: 'scoring_inputs_fetch_failed',
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
 *  - 'cash_only'   -> scoreCashOnlyUser (no snapshot; ledger proves flat at BOTH
 *                     week boundaries — any week number)
 *  - 'fallback'    -> calculatePortfolio (cumulative-from-entry — ONLY valid at week 1)
 *  - 'unscoreable' -> refuse; do NOT write a score (snapshot-less past week 1)
 *
 * 'cash_only' is a distinct kind rather than folded into 'full' because (i) 'full'
 * is gated on the batch-level hasWeekEndPrices flag, which a cash user does not
 * need; (ii) its evidence is a ledger proof, not a snapshot, and ops must be able
 * to tell the two apart in the log; (iii) the handler branches exhaustively.
 */
export type ScorerKind = 'full' | 'legacy' | 'cash_only' | 'fallback' | 'unscoreable';

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
  /**
   * Any query feeding the scoring decision errored. Absent = false. Checked FIRST:
   * nothing derived from a failed query may be trusted, including "everyone is
   * flat" below.
   */
  scoringInputsFetchFailed?: boolean;
  /**
   * Every participant is 'cash_only' (ledger-flat at both boundaries). Absent =
   * false. Only consulted for a snapshot-less batch: such a batch is correctly
   * snapshot-less, and cash_only scores from stored trade prices — never current
   * prices — so neither the stale nor the week>1 guard's rationale applies.
   */
  allParticipantsCashOnly?: boolean;
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
  if (i.scoringInputsFetchFailed === true) {
    return { action: 'skip', reason: BATCH_SKIP_REASON.SCORING_INPUTS_FETCH_FAILED };
  }
  // A batch where EVERY participant is provably all-cash has no snapshots BECAUSE
  // nobody held anything — the batch is complete, not broken. A MIXED
  // snapshot-less batch (someone ledger-held) still falls through to the guards:
  // snapshot-week-start writes league-atomically, so any held participant without
  // a row means the whole league's write failed, and a backfill heals it (after
  // which the per-user path scores the cash users as 'cash_only').
  if (!i.hasSnapshots && i.allParticipantsCashOnly === true) {
    return { action: 'proceed' };
  }
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
  /**
   * This user's ledger state (ledgerPositionState). ABSENT = unknown = NOT provably
   * flat: the all-cash branch can never fire without an explicit ledger proof.
   */
  ledger?: LedgerState;
}

/**
 * Guard 3a. Picks the scorer for one user, or marks them 'unscoreable'.
 *
 * The order mirrors the handler's if/else-if chain exactly:
 *   snapshot + end price -> 'full'
 *   snapshot only        -> 'legacy'
 *   no snapshot, ledger flat at BOTH week boundaries
 *                        -> 'cash_only'     (ANY week — see THE ALL-CASH RULE)
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
  // Before the week check, so it applies at week 1 too: there the fallback would
  // see empty holdings and return hasPositions:false — an accidental auto-loss.
  if (isProvablyCash(i.ledger)) return 'cash_only';
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

// ---------------------------------------------------------------------------
// THE ALL-CASH RULE — ledger-derived week-boundary holdings
// ---------------------------------------------------------------------------

/**
 * A drafts row as selected by the handler. user_id is TEXT in the table; typed
 * `unknown` so the comparison below is forced through normalisation.
 */
export interface LedgerDraftRow {
  user_id: unknown;
  symbol: string | null;
  quantity: unknown;
}

/** A trades row as selected by the handler. user_id is UUID in the table. */
export interface LedgerTradeRow {
  user_id: unknown;
  symbol: string | null;
  action: string;
  quantity: unknown;
  created_at: string | null;
}

export interface LedgerState {
  /** Net qty > 0 in any symbol from drafts + trades created BEFORE week_start. */
  heldAtWeekStart: boolean;
  /** Net qty > 0 in any symbol from drafts + trades created AT OR BEFORE week_end. */
  heldAtWeekEnd: boolean;
  /**
   * Any non-SKIP draft row or any trade up to week_end: the user has EVER been a
   * participant with a portfolio. Distinguishes genuinely-cash (true) from
   * genuinely-empty (false) — see scoreCashOnlyUser in ./user-score.ts.
   */
  hasLedgerHistory: boolean;
}

/**
 * A net quantity at or below this is fixed_notional rounding dust, not a holding —
 * the SAME ownership predicate as userNetHoldings in ../_shared/draft-validation.ts
 * (`q > 1e-9`), so a round trip that nets to 1e-7 is not a false refusal. Dust this
 * small is worth well under a cent at any real price, so scoring it as cash is exact
 * to the cent.
 */
const HELD_EPSILON = 1e-9;

/** Held at BOTH boundaries — the fail-closed answer to any ambiguity. */
const HELD: LedgerState = { heldAtWeekStart: true, heldAtWeekEnd: true, hasLedgerHistory: true };

/**
 * drafts.user_id is TEXT and trades.user_id is UUID (CLAUDE.md). In JS both arrive
 * as strings, but a text id is not guaranteed canonical, and a mismatch here would
 * hide the user's rows and read as FLAT — so compare normalised forms.
 */
function normId(id: unknown): string {
  return String(id ?? '').trim().toLowerCase();
}

function isProvablyCash(ledger: LedgerState | undefined): boolean {
  return ledger !== undefined && !ledger.heldAtWeekStart && !ledger.heldAtWeekEnd;
}

/**
 * Derive one user's holdings at both week boundaries from the ledger, netting
 * per symbol with the SAME semantics as snapshot-week-start's calculateHoldings
 * (draft qty `|| 1`, buy +, sell -, held = net > 0 beyond rounding dust) — the question being asked is
 * "would the snapshot jobs have expected a row for this user?". The one deliberate
 * divergence: SKIP sentinel draft rows are excluded (a forfeited pick is not a
 * holding; calculateHoldings' `|| 1` would turn one into 1 share of 'SKIP').
 *
 * Boundaries partition exactly with the handler's mid-week trade query
 * (`created_at >= week_start AND created_at <= week_end`): start = trades strictly
 * BEFORE week_start; end = trades AT OR BEFORE week_end. Drafts count at both
 * (they precede the season). Trades after week_end are ignored.
 *
 * FAILS CLOSED to HELD on: a null/unparseable week bound, any of the user's
 * trades with a null/unparseable created_at (a sell of unknown time could be
 * hiding a start-of-week holding), or any non-finite quantity.
 */
export function ledgerPositionState(
  userId: string,
  drafts: readonly LedgerDraftRow[],
  trades: readonly LedgerTradeRow[],
  weekStart: string | null,
  weekEnd: string | null,
): LedgerState {
  const startMs = weekStart ? Date.parse(weekStart) : NaN;
  const endMs = weekEnd ? Date.parse(weekEnd) : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return HELD;

  const uid = normId(userId);
  const atStart = new Map<string, number>();
  const atEnd = new Map<string, number>();
  let hasLedgerHistory = false;

  const add = (m: Map<string, number>, sym: string, qty: number) =>
    m.set(sym, (m.get(sym) ?? 0) + qty);

  for (const d of drafts) {
    if (normId(d.user_id) !== uid) continue;
    const sym = d.symbol?.toUpperCase();
    if (!sym || sym === SKIP_SYMBOL) continue;
    const qty = Number(d.quantity || 1);
    if (!Number.isFinite(qty)) return HELD;
    hasLedgerHistory = true;
    add(atStart, sym, qty);
    add(atEnd, sym, qty);
  }

  for (const t of trades) {
    if (normId(t.user_id) !== uid) continue;
    const sym = t.symbol?.toUpperCase();
    if (!sym) continue;
    const at = t.created_at ? Date.parse(t.created_at) : NaN;
    if (!Number.isFinite(at)) return HELD;
    if (at > endMs) continue;
    const qty = Number(t.quantity || 0);
    if (!Number.isFinite(qty)) return HELD;
    const signed = t.action === 'buy' ? qty : t.action === 'sell' ? -qty : 0;
    hasLedgerHistory = true;
    add(atEnd, sym, signed);
    if (at < startMs) add(atStart, sym, signed);
  }

  const anyHeld = (m: Map<string, number>) => [...m.values()].some((q) => q > HELD_EPSILON);
  return {
    heldAtWeekStart: anyHeld(atStart),
    heldAtWeekEnd: anyHeld(atEnd),
    hasLedgerHistory,
  };
}
