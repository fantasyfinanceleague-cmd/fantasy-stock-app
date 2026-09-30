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
 * Several guards refuse rather than fabricate; every one of them is DECIDED here:
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
 *   4. Unclosed user  (decideUserScorer -> 'close_incomplete'): a user WITH a
 *                      week_snapshots row but no week_end_price yet (every batch
 *                      here has week_end < now, so this only ever means
 *                      snapshot-week-end hasn't finished closing the week — its
 *                      retry chain still running, or exhausted on an unpriceable
 *                      symbol). Refused rather than scored from live prices
 *                      (reason 'unscoreable_participant_no_close_price'); see
 *                      MATCHUP_REFUSAL_REASON's doc and
 *                      docs/audits/2026-09-30-week-window-audit.md's S7.
 *
 *   5. All-cash user  (ledgerPositionState + decideUserScorer -> 'cash_only'): a
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
 *   LEDGER (drafts + trades, netted by the shared userNetHoldings) proves
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
 * no runtime dependencies beyond the pure ../_shared/draft-validation.ts helpers,
 * so it is trivially and hermetically testable. Where the
 * evaluation ORDER is load-bearing it is called out per function.
 */

// ../_shared/draft-validation.ts is itself pure and import-free, so importing it
// keeps this module hermetic while keeping ONE definition of the SKIP sentinel and
// ONE netting rule (userNetHoldings) shared with draft legality and the snapshot jobs.
import {
  SKIP_SYMBOL,
  userNetHoldings,
  type PickRow,
  type TradeRow,
} from '../_shared/draft-validation.ts';

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
  /**
   * A participant HAS a week_snapshots row but no week_end_price yet — every
   * batch reaching process-week-results has already had its week_end pass (the
   * top-level query is `.lt('week_end', now)`), so this always means
   * snapshot-week-end has not finished closing this week: its Friday retry
   * chain may still be running, or it exhausted retries on a permanently
   * unpriceable symbol (S7 — see ./user-score.ts's removed
   * calculateWeeklyGainLegacy and CLAUDE.md "success signals" #5/#6). Distinct
   * from NO_SNAPSHOT so ops can tell "never snapshotted" (a backfill issue)
   * apart from "close never completed" (usually self-heals once
   * snapshot-week-end finishes and the next process-week-results run — the
   * 22:00Z/Saturday heal crons — re-reads hasWeekEndPrices as true).
   */
  UNSCOREABLE_PARTICIPANT_NO_CLOSE_PRICE: 'unscoreable_participant_no_close_price',
} as const;
export type MatchupRefusalReason =
  (typeof MATCHUP_REFUSAL_REASON)[keyof typeof MATCHUP_REFUSAL_REASON];

export type BatchDecision =
  | { action: 'proceed' }
  | { action: 'skip'; reason: BatchSkipReason };

/**
 * Which scorer the handler should run for a single user:
 *  - 'full'             -> calculateUserScore (snapshots + week_end_price + trades)
 *  - 'close_incomplete' -> refuse; do NOT score from live prices (snapshot
 *                          exists, week_end_price does not — see
 *                          MATCHUP_REFUSAL_REASON.UNSCOREABLE_PARTICIPANT_NO_CLOSE_PRICE)
 *  - 'cash_only'        -> scoreCashOnlyUser (no snapshot; ledger proves flat at BOTH
 *                          week boundaries — any week number)
 *  - 'fallback'         -> calculatePortfolio (cumulative-from-entry — ONLY valid at week 1)
 *  - 'unscoreable'      -> refuse; do NOT write a score (snapshot-less past week 1)
 *
 * 'cash_only' is a distinct kind rather than folded into 'full' because (i) 'full'
 * is gated on the batch-level hasWeekEndPrices flag, which a cash user does not
 * need; (ii) its evidence is a ledger proof, not a snapshot, and ops must be able
 * to tell the two apart in the log; (iii) the handler branches exhaustively.
 *
 * 'close_incomplete' REPLACES the old 'legacy' kind (calculateWeeklyGainLegacy,
 * removed from index.ts). 'legacy' scored a snapshotted-but-unclosed user from
 * LIVE prices, ignoring every mid-week trade and writing team1_gain
 * irreversibly — for every batch reaching this module week_end has already
 * passed (index.ts's top-level query), so "snapshot but no close price" can
 * only mean the close job hasn't finished, never a legitimate steady state.
 * Scoring it from whatever price Alpaca returns at THIS run produced a
 * different, wrong, and irreversible number depending on exactly when
 * snapshot-week-end's retry chain happened to finish relative to the 21:15Z
 * scorer cron (S7 in docs/audits/2026-09-30-week-window-audit.md). Refusing
 * is recoverable: the matchup stays pending and the heal crons (22:00Z Friday,
 * Saturday) pick it up once snapshot-week-end actually closes the week.
 */
export type ScorerKind = 'full' | 'close_incomplete' | 'cash_only' | 'fallback' | 'unscoreable';

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

/**
 * Whether THIS USER's OWN week_snapshots rows are ALL priced — every row for
 * this user carries a week_end_price, not merely "some row somewhere in the
 * league-week batch does."
 *
 * WHY THIS MUST BE PER-USER, NOT BATCH-LEVEL (found in review of the S7 fix,
 * by both the security and supabase reviewers, independently, before this
 * function existed): snapshot-week-end/close.ts's buildCloseWork decides
 * all-or-nothing PER LEAGUE-WEEK (if any required symbol is unpriced, the
 * whole batch's writes are withheld) — but the writes that DECISION produces
 * are then applied by snapshot-week-end/index.ts as a LOOP of separate
 * per-row `.update()` calls, not one transaction. A mid-loop failure (a
 * timeout, a transient error on one row) can leave SOME users' rows closed
 * and one user's still NULL, in the exact same league-week. A batch-level
 * `snapshotData.some(s => s.week_end_price != null)` reads that state as
 * "closed" — routing the affected user to 'full' (not 'close_incomplete'),
 * and calculateUserScore's `if (endPrice !== undefined)` guards then silently
 * DROP that user's unpriced position from both dollarGain and startValue
 * instead of refusing. The matchup then scores and team1_gain is written
 * non-NULL — permanently unreachable by the `.is('team1_gain', null)` query,
 * unlike a genuine 'close_incomplete' refusal, which stays pending and heals.
 * This is the same "guard keyed on ANY-row-exists rather than per-participant
 * completeness" shape CLAUDE.md's partial-state family catalogs repeatedly —
 * reintroduced one level down, for the very check the S7 fix added.
 *
 * `.every()`, not `.some()`, mirrors close.ts's own classifyCloseCoverage
 * KIND-1 rule ("any existing row still lacking a close price -> incomplete").
 * An entered_mid_week row is unaffected: close.ts only ever inserts one with
 * its week_end_price already set (NewSnapshotRow.week_end_price is required,
 * non-null), so such a row can never be the cause of a false 'true' here.
 */
export function userWeekEndPricesComplete(
  snapshots: ReadonlyArray<{ weekEndPrice: number | null }>,
): boolean {
  return snapshots.length > 0 && snapshots.every((s) => s.weekEndPrice !== null);
}

export interface UserScorerInputs {
  /** snapshots.length > 0 for THIS user (per-user, not the batch-level flag). */
  hasSnapshot: boolean;
  /**
   * THIS USER's OWN week_snapshots rows are fully priced — see
   * userWeekEndPricesComplete's doc for why this must never be computed at
   * batch level ("any row in the league-week has a price"). The caller
   * (index.ts) must pass userWeekEndPricesComplete(thisUsersSnapshots), not a
   * flag shared across every user in the batch.
   */
  hasWeekEndPrices: boolean;
  weekNumber: number;
  /**
   * This user's ledger state (ledgerPositionState). ABSENT = unknown = NOT provably
   * flat: the all-cash branch can never fire without an explicit ledger proof.
   */
  ledger?: LedgerState;
}

/**
 * Guard 3a. Picks the scorer for one user, or marks them unscoreable (either
 * 'close_incomplete' or 'unscoreable').
 *
 * The order mirrors the handler's if/else-if chain exactly:
 *   snapshot + end price -> 'full'
 *   snapshot only        -> 'close_incomplete'  (S7: refuse rather than score
 *                          from live prices — see MATCHUP_REFUSAL_REASON's doc)
 *   no snapshot, ledger flat at BOTH week boundaries
 *                        -> 'cash_only'     (ANY week — see THE ALL-CASH RULE)
 *   no snapshot, week>1  -> 'unscoreable'  (the per-user residual of the defect:
 *                          cumulative-from-entry is all-time P/L, not a weekly
 *                          delta, once a prior week exists)
 *   no snapshot, week 1  -> 'fallback'     (draft entry ~= week-1 start price, so
 *                          cumulative-from-entry is an acceptable week-1 proxy)
 *
 * Note the snapshot branches win REGARDLESS of week number — a snapshotted user
 * is always scored from their snapshot (or refused as 'close_incomplete' if it
 * isn't closed yet); the week>1 refusal only ever applies to a snapshot-less
 * user.
 */
export function decideUserScorer(i: UserScorerInputs): ScorerKind {
  if (i.hasSnapshot && i.hasWeekEndPrices) return 'full';
  if (i.hasSnapshot) return 'close_incomplete';
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
 * `unscoreableUserIds` maps each unscoreable user to WHY (NO_SNAPSHOT or
 * NO_CLOSE_PRICE — see MATCHUP_REFUSAL_REASON), not merely THAT — a Map, not a
 * Set, so the matchup refusal carries the same distinction the per-user decision
 * made.
 *
 * PRECEDENCE, when BOTH participants are unscoreable for DIFFERENT reasons, is
 * by SEVERITY, not by team position (found in review of the S7 fix):
 * NO_SNAPSHOT (a backfill issue, does not self-heal) wins over NO_CLOSE_PRICE
 * (usually self-heals once snapshot-week-end finishes and a heal cron
 * re-runs). Reporting team1's reason regardless of which is worse — the
 * original approach — could report the self-healing-sounding NO_CLOSE_PRICE
 * for a matchup that will NOT actually heal on its own because the OTHER
 * participant's cause is the permanent one, silently masking it: the heal
 * crons would run, do nothing (the real cause is unrelated to a close), and
 * the matchup would sit refused with a reason that reads as "should have
 * fixed itself by now." Same "verdict scope must match evidence scope"
 * lesson CLAUDE.md tracks (case 5): a single reported reason must describe
 * the worse of the two truths, not an arbitrary one. Scoring correctness is
 * identical either way — the matchup is refused regardless of which reason is
 * reported — this only affects what ops sees in skipped[] and the logs.
 *
 * BYE WEEKS gate on team1 only: a bye has team2UserId == null, so team2 is never
 * consulted (a null id can't be "unscoreable"). This is why team2UserId is
 * nullable and guarded — mirroring the handler's
 * `team2_user_id != null && unscoreableUserIds.has(...)`.
 *
 * This is the composition point that pins the KEY regression: in a partially-
 * snapshotted week>1, decideUserScorer marks only the snapshot-less user
 * 'unscoreable', so ONLY matchups containing that user are refused here — an
 * all-snapshotted matchup in the SAME week still proceeds and scores. The same
 * holds for 'close_incomplete'.
 */
export function decideMatchupScoring(
  team1UserId: string,
  team2UserId: string | null,
  unscoreableUserIds: ReadonlyMap<string, MatchupRefusalReason>,
): MatchupDecision {
  const team1Reason = unscoreableUserIds.get(team1UserId);
  const team2Reason =
    team2UserId != null ? unscoreableUserIds.get(team2UserId) : undefined;
  let reason: MatchupRefusalReason | undefined;
  if (team1Reason && team2Reason) {
    // Both unscoreable, for potentially different reasons: report the one
    // that does NOT self-heal, so a permanent backfill issue on one side is
    // never hidden behind a self-healing-sounding reason from the other.
    reason = team1Reason === MATCHUP_REFUSAL_REASON.UNSCOREABLE_PARTICIPANT_NO_SNAPSHOT
      ? team1Reason
      : team2Reason;
  } else {
    reason = team1Reason ?? team2Reason;
  }
  if (reason) {
    return { action: 'refuse', reason };
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

/** Held at BOTH boundaries — the fail-closed answer to any ambiguity. */
const HELD: LedgerState = { heldAtWeekStart: true, heldAtWeekEnd: true, hasLedgerHistory: true };

/**
 * drafts.user_id is TEXT and trades.user_id is UUID (CLAUDE.md). In JS both arrive
 * as strings, but a text id is not guaranteed canonical, and a mismatch here would
 * hide the user's rows and read as FLAT — so compare normalised forms.
 * userNetHoldings compares with a raw `String(user_id) !== userId`, so rows are
 * handed to it with their id ALREADY normalised.
 */
function normId(id: unknown): string {
  return String(id ?? '').trim().toLowerCase();
}

function isProvablyCash(ledger: LedgerState | undefined): boolean {
  return ledger !== undefined && !ledger.heldAtWeekStart && !ledger.heldAtWeekEnd;
}

/**
 * `Number(q) || 0` (userNetHoldings' coercion) silently turns garbage into 0 = flat.
 * Null is a legitimate 0 (shared semantics); '' / whitespace is NOT — `Number('')`
 * is 0, so it is rejected explicitly rather than read as flat.
 */
function isFiniteQty(q: unknown): boolean {
  if (typeof q === 'string' && q.trim() === '') return false;
  return Number.isFinite(Number(q ?? 0));
}

/**
 * Derive one user's holdings at both week boundaries from the ledger.
 *
 * NETTING IS DELEGATED to userNetHoldings in ../_shared/draft-validation.ts — the
 * same function draft legality uses and the snapshot jobs' holdings helper
 * delegates to — so "held" means ONE thing across draft legality, the snapshot
 * jobs and this eligibility check: SKIP draft rows excluded (case-insensitive),
 * quantity `Number(q) || 0` (no coercion to 1), buys +, sells -, per symbol, a
 * position held only when its net exceeds the 1e-9 fixed_notional rounding-dust
 * threshold. The question is "would the snapshot jobs have expected a row?", so
 * the answer must come from the function they use.
 *
 * This layer adds only what userNetHoldings cannot know:
 *   - TIME. Trades are filtered before netting: start = trades strictly BEFORE
 *     week_start; end = trades AT OR BEFORE week_end. That partitions exactly with
 *     the handler's mid-week trade query (`created_at >= week_start AND
 *     created_at <= week_end`). Drafts count at both (they precede the season).
 *   - FAIL-CLOSED to HELD on: a null/unparseable week bound; any of the user's
 *     trades with a null/unparseable created_at (a sell of unknown time could be
 *     hiding a start-of-week holding); any non-finite quantity (which
 *     `Number(q) || 0` would otherwise read as 0 — i.e. as flat).
 *   - id normalisation (see normId) and dropping null-symbol rows, which carry no
 *     position and would throw inside userNetHoldings.
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

  // userNetHoldings reads only user_id / symbol / quantity (+ action for trades);
  // the remaining PickRow / TradeRow fields are zero-filled to satisfy the type.
  const picks: PickRow[] = [];
  for (const d of drafts) {
    if (normId(d.user_id) !== uid || !d.symbol) continue;
    if (!isFiniteQty(d.quantity)) return HELD;
    picks.push({ user_id: uid, symbol: d.symbol, quantity: Number(d.quantity ?? 0), entry_price: 0, pick_number: 0 });
  }

  const beforeStart: TradeRow[] = [];
  const throughEnd: TradeRow[] = [];
  for (const t of trades) {
    if (normId(t.user_id) !== uid || !t.symbol) continue;
    const at = t.created_at ? Date.parse(t.created_at) : NaN;
    if (!Number.isFinite(at)) return HELD;
    if (!isFiniteQty(t.quantity)) return HELD;
    if (at > endMs) continue;
    const row: TradeRow = { user_id: uid, symbol: t.symbol, action: t.action, quantity: Number(t.quantity ?? 0), price: 0 };
    throughEnd.push(row);
    if (at < startMs) beforeStart.push(row);
  }

  return {
    heldAtWeekStart: userNetHoldings(uid, picks, beforeStart).size > 0,
    heldAtWeekEnd: userNetHoldings(uid, picks, throughEnd).size > 0,
    // Same SKIP predicate as userNetHoldings' isSkip.
    hasLedgerHistory:
      picks.some((p) => p.symbol.toUpperCase() !== SKIP_SYMBOL) || throughEnd.length > 0,
  };
}
