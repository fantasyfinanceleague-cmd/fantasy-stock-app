/**
 * S9: may snapshot-week-end close a league-week, given the baseline evidence?
 *
 * THE DEFECT: week-end writes rows for traded symbols even when week-start never
 * baselined the holder. A holder who held the symbol at the OPEN but has no row
 * gets a row priced at their mid-week buy and sized to the CLOSE quantity, and the
 * all-or-nothing family (CLAUDE.md) has no guard for that partial portfolio.
 *
 * THE RULE, keyed on the OPEN cut (the same set week-start baselines):
 *   - nobody held anything at the open       -> proceed (every holder bought mid-week;
 *                                               zero rows is then correct, cc26857)
 *   - the baseline marker is unreadable       -> refuse (fail closed)
 *   - the marker is present and matches this
 *     week's open (not a stale prior season)  -> proceed (week-start finished it)
 *   - every open holder already has a row     -> proceed (complete by rows; covers
 *                                               legacy weeks written before the marker)
 *   - any open holder has no row              -> refuse: the baseline is partial or
 *                                               never ran
 * The refusal is recoverable: a later week-start heal baselines the missing
 * participants from the cut's open session bar and writes the marker.
 *
 * Pure: no DB. See baseline.test.ts.
 */

export interface BaselineEvidence {
  /** At least one participant held a position at the OPEN cut. */
  anyOpenHoldings: boolean;
  /** Open-cut holders with NO week_snapshots row for this league-week. */
  openHoldersMissingRows: number;
  /** A week_baselines row exists for (league, week). */
  markerPresent: boolean;
  /** That row's open_at equals this week's open (guards against a stale prior season). */
  markerMatchesWindow: boolean;
  /** The marker read succeeded. A failed read refuses (fail closed). */
  markerReadOk: boolean;
}

export type BaselineGate = 'proceed' | 'refuse_no_baseline' | 'refuse_marker_unreadable';

export function weekEndBaselineGate(e: BaselineEvidence): BaselineGate {
  if (!e.anyOpenHoldings) return 'proceed';
  if (!e.markerReadOk) return 'refuse_marker_unreadable';
  if (e.markerPresent && e.markerMatchesWindow) return 'proceed';
  if (e.openHoldersMissingRows === 0) return 'proceed';
  return 'refuse_no_baseline';
}

/** The week_baselines row week-start writes once a league-week's baseline is complete. */
export interface BaselineMarkerRow {
  league_id: string;
  week_number: number;
  open_at: string;
  open_session_date: string;
  participants: number;
  rows_written: number;
}

export function baselineMarkerRow(
  leagueId: string,
  weekNumber: number,
  openAt: Date,
  openSessionDate: string,
  participants: number,
  rowsWritten: number,
): BaselineMarkerRow {
  return {
    league_id: leagueId,
    week_number: weekNumber,
    open_at: openAt.toISOString(),
    open_session_date: openSessionDate,
    participants,
    rows_written: rowsWritten,
  };
}
