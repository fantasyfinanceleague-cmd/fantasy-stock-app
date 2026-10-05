/**
 * S9: may snapshot-week-end close a league-week, given the baseline marker?
 *
 * THE DEFECT: week-end writes rows for traded symbols even when week-start never
 * baselined the week. Closing then scores a PARTIAL portfolio, the all-or-nothing
 * family (CLAUDE.md). Zero rows cannot tell "nothing held at the open" from "the
 * baseline never ran", so the marker decides it.
 *
 * THE RULE: a league-week with any holding (at the open or the close) may close
 * only when matchups.baseline_completed_at is set. Week-start sets it after its
 * rows commit, or after confirming nothing was held at the open. A week with
 * nothing held at either cut needs no marker.
 *   - cc26857 (every holder bought mid-week): nothing held at the open. Week-start
 *     still sets the marker with zero rows, so the close proceeds with zero
 *     baseline rows, and the mid-week rows are correct.
 *   - a marker read that fails refuses (fail closed).
 *
 * Pure: no DB. See baseline.test.ts.
 */

export interface BaselineEvidence {
  /** The league-week has a holding at the open or the close. */
  needsBaseline: boolean;
  /** matchups.baseline_completed_at is set for this league-week. */
  markerSet: boolean;
  /** The marker read succeeded. A failed read refuses (fail closed). */
  markerReadOk: boolean;
}

export type BaselineGate = 'proceed' | 'refuse_no_baseline' | 'refuse_marker_unreadable';

export function weekEndBaselineGate(e: BaselineEvidence): BaselineGate {
  if (!e.needsBaseline) return 'proceed';
  if (!e.markerReadOk) return 'refuse_marker_unreadable';
  return e.markerSet ? 'proceed' : 'refuse_no_baseline';
}
