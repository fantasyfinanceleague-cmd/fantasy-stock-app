/**
 * Pure snapshot-planning decisions for snapshot-week-start.
 *
 * Extracted from the Deno.serve handler so the ALL-OR-NOTHING and
 * COMPLETE-ONLY-SKIP invariants can be unit-tested with no DB, no Alpaca, and no
 * Deno runtime APIs — the same hermetic pattern as
 * ../process-week-results/grouping.ts and scoring-eligibility.ts. See
 * plan.test.ts for the regression coverage.
 *
 * THE TWO DEFECTS THESE ENCODE AGAINST (both in the old handler):
 *
 *   1. PARTIAL WRITE. Snapshots were built per-holding with `if (!price) continue`,
 *      dropping any holding Alpaca returned no price for, then inserted as one
 *      batch. A user whose only symbol(s) missed ended up with ZERO rows while
 *      other users in the same league-week got theirs — a PARTIAL league-week that
 *      reads as "done".
 *
 *   2. UNHEALABLE SKIP. The league was skipped if week_snapshots had ANY row for
 *      (league_id, week_number). So once a partial write landed, a retry could
 *      never fill the gap, and the partial state read as "complete" both to that
 *      skip-check AND to the downstream process-week-results batch-level
 *      `hasSnapshots`.
 *
 * THE FIX (per-league atomic, self-healing) — and why completeness is PER-USER:
 *   - Writes are all-or-nothing over the users being written (buildPricedRows): if
 *     ANY of their holdings lacks a price, the caller writes NOTHING this run and
 *     retries. So a user is only ever fully snapshotted or not at all — there is no
 *     within-user partial to detect.
 *   - Given that, completeness is measured PER PARTICIPANT, not per (user, symbol):
 *     a league-week is complete once every participant-with-holdings has a
 *     snapshot. This is deliberately drift-immune. snapshot-week-start fires BOTH
 *     Monday and Tuesday (cron '35 14 * * 1,2'); a participant who buys a new
 *     symbol Monday afternoon would make a per-(user,symbol) check read 'incomplete'
 *     on Tuesday and trigger a full re-snapshot at Tuesday's prices — silently
 *     overwriting Monday's week_start_price for everyone and recording a mid-week
 *     buy as a week-start holding. Per-user completeness treats that participant as
 *     already covered, so Tuesday is a no-op and the mid-week buy is left to the
 *     trades table where it belongs.
 *   - Healing writes ONLY the missing participants (selectMissingHoldings), so an
 *     already-correct user's rows are never rebuilt or overwritten.
 *
 * INHERENT LIMIT: a permanently-unpriceable symbol (e.g. delisted) can never be
 * snapshotted, so retries for that league will exhaust and it falls through to the
 * downstream per-user gate (decideUserScorer -> 'unscoreable' in
 * ../process-week-results/scoring-eligibility.ts). That backstop is REQUIRED
 * regardless; this module only makes it fire rarely by never producing a partial.
 *
 * These functions decide ONLY. All logging, DB queries, price fetches, upserts,
 * and retry scheduling stay in index.ts — this module has no side effects and no
 * runtime dependencies, so it is trivially and hermetically testable.
 */

export interface Holding {
  symbol: string;
  quantity: number;
}

/** A row destined for week_snapshots. Shape matches the table columns written. */
export interface SnapshotRow {
  league_id: string;
  user_id: string;
  week_number: number;
  symbol: string;
  quantity: number;
  week_start_price: number;
}

/**
 * Coverage of a league-week's EXPECTED snapshots versus what already exists.
 * Measured per participant-with-holdings (see the module header for why per-user,
 * not per (user, symbol)).
 *
 *  - 'none_expected': no participant holds anything — nothing to do, and NOT an
 *                     error. Left as-is so an empty league never wedges the retry.
 *  - 'complete':      every participant-with-holdings already has a snapshot — skip.
 *  - 'incomplete':    at least one participant-with-holdings has NO snapshot yet.
 */
export type Coverage = 'none_expected' | 'complete' | 'incomplete';

/** A participant "has holdings" when they hold at least one qty>0 position. */
function hasHoldings(holdings: Holding[]): boolean {
  return holdings.length > 0;
}

/**
 * Classify how completely a league-week is snapshotted. This REPLACES the old
 * existence-only skip: 'incomplete' is what makes a zero-row participant healable
 * (the retry re-attempts) instead of the whole league being locked out because
 * "some row exists". A participant holding nothing contributes no expected rows.
 *
 * `coveredUserIds` = the distinct user_ids that already have ≥1 week_snapshots row
 * for this league-week. It may legitimately contain users no longer holding
 * anything; that is harmless (they simply aren't in the expected set).
 */
export function classifyCoverage(
  userHoldings: Map<string, Holding[]>,
  coveredUserIds: ReadonlySet<string>,
): Coverage {
  let expected = 0;
  let covered = 0;
  for (const [userId, holdings] of userHoldings) {
    if (!hasHoldings(holdings)) continue;
    expected++;
    if (coveredUserIds.has(userId)) covered++;
  }
  if (expected === 0) return 'none_expected';
  return covered === expected ? 'complete' : 'incomplete';
}

/**
 * The subset of participants who hold something but have NO snapshot yet — the
 * only users a heal run should write. Returning just these (rather than all
 * participants) is what guarantees an already-correct user's rows are never
 * rebuilt or overwritten with the current run's prices/quantities.
 */
export function selectMissingHoldings(
  userHoldings: Map<string, Holding[]>,
  coveredUserIds: ReadonlySet<string>,
): Map<string, Holding[]> {
  const missing = new Map<string, Holding[]>();
  for (const [userId, holdings] of userHoldings) {
    if (!hasHoldings(holdings)) continue;
    if (!coveredUserIds.has(userId)) missing.set(userId, holdings);
  }
  return missing;
}

/**
 * Build the COMPLETE set of snapshot rows for the given users, or report which
 * symbols block it. ALL-OR-NOTHING: `rows` is only safe to write when
 * `missingSymbols` is empty. If any holding lacks a price the caller must write
 * NOTHING and retry — a partial write corrupts both classifyCoverage above and
 * downstream scoring.
 *
 * Callers pass ONLY the users being written (typically selectMissingHoldings'
 * output), so this never rebuilds an already-correct user's rows.
 *
 * A price is "missing" when absent, zero, or non-positive — matching the old
 * handler's `if (!price)` and never snapshotting a $0 start price (which would
 * silently zero out that holding's weekly delta downstream).
 */
export function buildPricedRows(
  leagueId: string,
  weekNumber: number,
  usersToWrite: Map<string, Holding[]>,
  prices: Map<string, number>,
): { rows: SnapshotRow[]; missingSymbols: string[] } {
  const rows: SnapshotRow[] = [];
  const missing = new Set<string>();

  for (const [userId, holdings] of usersToWrite) {
    for (const h of holdings) {
      const price = prices.get(h.symbol);
      if (!price || price <= 0) {
        missing.add(h.symbol);
        continue;
      }
      rows.push({
        league_id: leagueId,
        user_id: userId,
        week_number: weekNumber,
        symbol: h.symbol,
        quantity: h.quantity,
        week_start_price: price,
      });
    }
  }

  return { rows, missingSymbols: [...missing] };
}
