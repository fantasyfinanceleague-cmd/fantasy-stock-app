/**
 * S9: may snapshot-week-end close a league-week, given the baseline rows?
 *
 * THE DEFECT: week-end writes rows for traded symbols even when week-start never
 * baselined a holder. Closing then scores a PARTIAL portfolio (all-or-nothing,
 * CLAUDE.md).
 *
 * THE RULE (rows only, no marker): the positions are the league-week's matchup
 * participants' holdings at the OPEN cut (drafts plus trades strictly before the open),
 * the same set week-start baselines. The close may proceed iff EVERY (holder, symbol)
 * position already has a week_snapshots row.
 *   - zero open holders -> proceed. Nothing was held at the open, so there is nothing
 *     to baseline. This is the all-mid-week-buyers case (cc26857), and it needs no
 *     marker, because the ledger already says "nothing held".
 *   - any open holder without a row -> refuse (the baseline is partial or never ran).
 *     The refusal is recoverable: a later week-start heal baselines the missing
 *     holders from the open session bar, and then the close proceeds.
 *
 * Pure: no DB. See baseline.test.ts.
 */

export interface BaselineEvidence {
  /** How many holders held at the OPEN cut (informational). */
  openHolderCount: number;
  /** How many (holder, symbol) positions held at the OPEN cut have NO week_snapshots row. */
  openPositionsMissingRows: number;
}

export type BaselineGate = 'proceed' | 'refuse_no_baseline';

export function weekEndBaselineGate(e: BaselineEvidence): BaselineGate {
  return e.openPositionsMissingRows === 0 ? 'proceed' : 'refuse_no_baseline';
}
