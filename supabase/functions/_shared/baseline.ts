/**
 * S9: may snapshot-week-end close a league-week, given the baseline evidence?
 *
 * THE DEFECT: week-end writes rows for traded symbols even when week-start never
 * baselined a holder. Closing then scores a PARTIAL portfolio (all-or-nothing,
 * CLAUDE.md).
 *
 * THE RULE, in this order:
 *   1. Nothing held at the open or the close  -> proceed (no baseline is needed).
 *   2. The marker read failed                 -> refuse (fail closed).
 *   3. Holders held at the OPEN exist         -> the per-holder row evidence governs:
 *        every one has a row  -> proceed (complete baseline)
 *        any one lacks a row  -> refuse (partial). The marker does NOT override this.
 *      (A stale or wrong marker can therefore never let a close proceed past a
 *      holder that has no baseline; CLAUDE.md "all-or-nothing", case 5.)
 *   4. Nobody held at the open (every holder bought mid-week, cc26857) -> the zero
 *      rows are ambiguous, so the marker decides: set by week-start -> proceed;
 *      unset -> refuse ("never ran" is indistinguishable from "ran, nothing held").
 *
 * The marker is therefore needed only where zero rows are ambiguous. It is written by
 * week-start only after its rows commit, or after confirming nothing was held.
 *
 * Pure: no DB. See baseline.test.ts.
 */

export interface BaselineEvidence {
  /** A holder held a position at the open or the close. */
  needsBaseline: boolean;
  /** matchups.baseline_completed_at is set for this league-week. */
  markerSet: boolean;
  /** The marker read succeeded. A failed read refuses (fail closed). */
  markerReadOk: boolean;
  /** How many holders held at the OPEN cut (the set week-start baselines). */
  openHolderCount: number;
  /** Of those, how many have NO week_snapshots row. */
  openHoldersMissingRows: number;
}

export type BaselineGate = 'proceed' | 'refuse_no_baseline' | 'refuse_marker_unreadable';

export function weekEndBaselineGate(e: BaselineEvidence): BaselineGate {
  if (!e.needsBaseline) return 'proceed';
  if (!e.markerReadOk) return 'refuse_marker_unreadable';
  if (e.openHolderCount > 0) {
    return e.openHoldersMissingRows === 0 ? 'proceed' : 'refuse_no_baseline';
  }
  return e.markerSet ? 'proceed' : 'refuse_no_baseline';
}
