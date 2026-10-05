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

// ---------------------------------------------------------------------------
// Single-cut week window (fix for the Monday-gap scoring defect —
// docs/audits/2026-09-30-week-window-audit.md). Wraps the shared
// ../_shared/week-window.ts weekCut() with the two decisions specific to
// snapshot-week-start: is this league's week DUE yet (now before this week's
// open means nothing to do, not an error — this REPLACES the old
// Alpaca-calendar holiday check and the Monday/Tuesday day-of-week branch:
// the cron still fires both days, but the decision no longer cares which day
// it is, only whether `now` has reached the week's real open), and should
// matchups.week_start/week_end be REWRITTEN to the canonical cut (only when
// this league-week has NO week_snapshots rows yet — see planWeekWindow's doc).
// ---------------------------------------------------------------------------

import { weekCut, type CalendarSession, type Coverage as MarketCalendarCoverage } from '../_shared/week-window.ts';

export type WeekWindowPlan =
  | { action: 'not_due' }
  | { action: 'refuse'; reason: 'no_coverage' | 'no_sessions_in_week' | 'floor_beyond_week' | 'invalid_calendar_data' }
  | {
    action: 'proceed';
    open: Date;
    close: Date;
    openSessionDate: string;
    closeSessionDate: string;
    /**
     * Rewrite matchups.week_start/week_end to [open, close] for this
     * league-week. ONLY true when existingSnapshotCount === 0 — once even one
     * week_snapshots row exists, SOME baseline was already taken at SOME
     * instant/price under whatever window was stored at the time, and every
     * other consumer of matchups.week_start/week_end (process-week-results'
     * trade window, get_home_league, mobile) may already be reasoning about
     * that stored window. Rewriting it out from under already-written data
     * would retroactively change what "in-week" means for trades already
     * classified — so a league-week is either rewritten ONCE, before its
     * first snapshot, or never touched again. This protects prod's real
     * week 1 (already fully snapshotted under the OLD nominal window before
     * this fix deploys): it keeps its old window forever, exactly as
     * intended, never re-windowed.
     */
    rewrite: boolean;
  };

/**
 * Decide the window for one league-week. `anchor` is normally
 * matchups.week_start as currently stored (whether still the old nominal
 * value or an already-reconciled cut.open — weekCut is a fixpoint on its own
 * output, so either produces the identical result). `floor` is normally the
 * EARLIEST created_at across this league-week's matchup rows (the
 * draft-completion instant — see week-window.ts's FLOOR doc).
 */
export function planWeekWindow(
  now: Date,
  anchor: Date,
  floor: Date | null,
  sessions: ReadonlyArray<CalendarSession>,
  coverage: MarketCalendarCoverage | null,
  storedWeekStartIso: string,
  storedWeekEndIso: string,
  existingSnapshotCount: number,
): WeekWindowPlan {
  const cut = weekCut(anchor, floor, sessions, coverage);
  if (!cut.ok) return { action: 'refuse', reason: cut.reason };

  // Not yet due: this week's real open hasn't happened. Not an error — the
  // Tuesday run of a normal (non-holiday) week hits this every time, and
  // correctly no-ops (the coverage gate below would have healed nothing
  // different anyway, since Monday's run already wrote everyone reachable).
  if (now.getTime() < cut.open.getTime()) return { action: 'not_due' };

  // Compare INSTANTS, not strings: PostgREST returns timestamptz as '+00:00' while
  // toISOString() emits 'Z', so a string compare is never equal and a scored week
  // would be re-windowed on every run (S4).
  const matchesStored =
    Date.parse(storedWeekStartIso) === cut.open.getTime() && Date.parse(storedWeekEndIso) === cut.close.getTime();

  return {
    action: 'proceed',
    open: cut.open,
    close: cut.close,
    openSessionDate: cut.openSessionDate,
    closeSessionDate: cut.closeSessionDate,
    rewrite: existingSnapshotCount === 0 && !matchesStored,
  };
}
