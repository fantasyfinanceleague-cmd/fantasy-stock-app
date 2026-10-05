/**
 * S9: may snapshot-week-end close a league-week, given the baseline evidence?
 *
 * THE DEFECT: week-end writes rows for traded symbols even when week-start never
 * baselined the week. Closing then scores a PARTIAL portfolio (all-or-nothing,
 * CLAUDE.md). Zero rows cannot tell "nothing held at the open" from "the baseline
 * never ran", so the marker decides the zero-row case.
 *
 * THE RULE: a league-week with any holding (at the open or the close) may close when:
 *   - the marker matchups.baseline_completed_at is set (week-start finished it,
 *     including nothing-held and the late heal), OR
 *   - legacy evidence: every holder held at the OPEN already has a row. That is a
 *     complete baseline written before the marker existed. Without this, every
 *     pre-deploy league-week with holdings would refuse on the first Friday after
 *     deploy and stall scoring. A PARTIAL baseline (any open holder without a row)
 *     still refuses.
 * A week with nothing held at either cut needs no evidence. A failed marker read
 * refuses (fail closed). With nobody held at the open and no marker, the week
 * refuses: that is the zero-row ambiguity the marker exists to resolve.
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
  /**
   * Every holder held at the open has a week_snapshots row. null when nobody held
   * at the open, so there is no row evidence to offer.
   */
  openHoldersAllHaveRows: boolean | null;
}

export type BaselineGate = 'proceed' | 'refuse_no_baseline' | 'refuse_marker_unreadable';

export function weekEndBaselineGate(e: BaselineEvidence): BaselineGate {
  if (!e.needsBaseline) return 'proceed';
  if (!e.markerReadOk) return 'refuse_marker_unreadable';
  if (e.markerSet) return 'proceed';
  if (e.openHoldersAllHaveRows === true) return 'proceed';
  return 'refuse_no_baseline';
}
