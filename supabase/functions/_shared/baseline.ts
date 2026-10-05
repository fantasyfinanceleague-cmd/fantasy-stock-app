/**
 * S9: may snapshot-week-end close a league-week, given the baseline rows?
 *
 * THE DEFECT: week-end writes rows for traded symbols even when week-start never
 * baselined a holder. Closing then scores a PARTIAL portfolio (all-or-nothing,
 * CLAUDE.md).
 *
 * THE RULE (rows only, no marker): the holders are derived from the ledger, drafts
 * plus trades strictly before the OPEN cut, the same set week-start baselines. The
 * close may proceed iff EVERY one of them already has a week_snapshots row.
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
  /** How many holders held at the OPEN cut (the set week-start baselines). */
  openHolderCount: number;
  /** Of those, how many have NO week_snapshots row. */
  openHoldersMissingRows: number;
}

export type BaselineGate = 'proceed' | 'refuse_no_baseline';

export function weekEndBaselineGate(e: BaselineEvidence): BaselineGate {
  return e.openHoldersMissingRows === 0 ? 'proceed' : 'refuse_no_baseline';
}
