/**
 * Pure week-end closing decisions for snapshot-week-end.
 *
 * Extracted from the Deno.serve handler so the ALL-OR-NOTHING and
 * COMPLETE-ONLY-SKIP invariants can be unit-tested with no DB, no Alpaca and no
 * Deno runtime APIs — the same hermetic pattern as
 * ../snapshot-week-start/plan.ts, ../process-week-results/grouping.ts and
 * scoring-eligibility.ts. See close.test.ts for the regression coverage.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS ENCODES AGAINST (the last live instance of the partial-state
 * pattern documented in CLAUDE.md):
 *
 *   The old guard was existence-only:
 *     alreadyProcessed = existingSnapshots?.some(s => s.week_end_price != null)
 *
 *   ANY single end-priced row marked the WHOLE league-week done. So if a run
 *   priced some participants and then threw — a mid-loop Alpaca failure, a
 *   timeout, a bad symbol — the retry saw one end-priced row, skipped the
 *   league, and reported success. A partial week-end write could not be healed:
 *   the retry did not merely fail to fix it, it declined to look.
 *
 *   That also made retries into this function INEFFECTIVE even after
 *   schedule_snapshot_retry was fixed (20260727000000): the retry fires, hits
 *   the existence check, and no-ops. Fixing the retry mechanism did not fix
 *   recovery here; this module is what does.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT STRUCTURALLY SYMMETRICAL WITH snapshot-week-start/plan.ts
 *
 * This is the one place the two functions must diverge, so it is stated here
 * rather than smoothed over. week-START has ONE write path: insert a row per
 * (user, symbol) holding. week-END has TWO, and therefore "missing" has two
 * distinct kinds that must both be satisfied before a league-week is complete:
 *
 *   KIND 1 — an UNPRICED MONDAY ROW. A week_snapshots row already exists (it
 *            carries week_start_price from the Monday run) but week_end_price
 *            is still NULL. Resolution: UPDATE that row by id.
 *
 *   KIND 2 — a MID-WEEK BUY WITH NO ROW AT ALL. The participant holds a symbol
 *            that has no row for this league-week, because they bought it after
 *            Monday. Resolution: INSERT a new row carrying
 *            entered_mid_week = true, week_start_price = the weighted entry
 *            price, and week_end_price = the close.
 *
 * A coverage check that looked only at kind 1 would call a league complete
 * while a mid-week buy was still unrecorded; one that looked only at kind 2
 * would re-price nothing. Completeness here is therefore the conjunction of
 * both, evaluated per participant.
 *
 * ---------------------------------------------------------------------------
 * WHY COMPLETENESS IS PER PARTICIPANT (inherited from plan.ts, and load-bearing)
 *
 * buildCloseWork is all-or-nothing over the league: if ANY required symbol
 * lacks a close price, it returns missingSymbols and the caller writes NOTHING
 * this run. So a participant is only ever fully closed or not closed at all —
 * there is no within-participant partial to detect, which is what lets
 * completeness be measured per participant rather than per (user, symbol).
 *
 * entered_mid_week rows are DELIBERATELY NOT treated as evidence of coverage
 * for kind 1: such a row already carries its own week_end_price at insert time,
 * so it is complete on arrival and never needs an update pass.
 *
 * INHERENT LIMIT (same as plan.ts): a permanently unpriceable symbol — a
 * delisting between Monday and Friday is the realistic case — can never be
 * closed, so retries for that league exhaust and it falls through to the
 * downstream per-user gate (decideUserScorer -> 'unscoreable' in
 * ../process-week-results/scoring-eligibility.ts). That backstop is REQUIRED
 * regardless; this module only makes it fire rarely by never producing a
 * partial.
 *
 * These functions DECIDE ONLY. All logging, DB queries, price fetches, upserts
 * and retry scheduling stay in index.ts — this module has no side effects and
 * no runtime dependencies, so it is trivially and hermetically testable.
 */

/** A holding derived from drafts + trades for one participant. */
export interface Holding {
  symbol: string;
  quantity: number;
}

/** An existing week_snapshots row for the league-week being closed. */
export interface ExistingSnapshot {
  id: string;
  user_id: string;
  symbol: string;
  quantity: number;
  week_start_price: number | null;
  week_end_price: number | null;
  entered_mid_week?: boolean | null;
}

/** A row destined for week_snapshots (mid-week buy). Shape matches the columns written. */
export interface NewSnapshotRow {
  league_id: string;
  user_id: string;
  week_number: number;
  symbol: string;
  quantity: number;
  week_start_price: number;
  entered_mid_week: true;
  week_end_price: number;
}

/** An in-place close of an existing Monday row. */
export interface SnapshotUpdate {
  id: string;
  week_end_price: number;
}

export type Coverage = 'none_expected' | 'complete' | 'incomplete';

/**
 * Is this league-week already fully closed?
 *
 *   'none_expected' — nothing to do: no participant holds anything AND no row
 *                     exists. Distinguished from 'complete' so the caller can
 *                     log the benign case honestly instead of implying work.
 *   'complete'      — every existing row carries a week_end_price (kind 1
 *                     satisfied) AND every held (user, symbol) has a row
 *                     (kind 2 satisfied). Safe to skip.
 *   'incomplete'    — anything else, INCLUDING the partial state the old
 *                     existence-only guard misread as done. Heal it.
 */
export function classifyCloseCoverage(
  userHoldings: Map<string, Holding[]>,
  existing: ExistingSnapshot[],
): Coverage {
  const anyHoldings = [...userHoldings.values()].some((hs) => hs.length > 0);
  if (!anyHoldings && existing.length === 0) return 'none_expected';

  // KIND 1: any existing row still lacking a close price?
  for (const row of existing) {
    if (row.week_end_price == null) return 'incomplete';
  }

  // KIND 2: any currently-held (user, symbol) with no row at all?
  const covered = new Set(
    existing.map((r) => `${r.user_id}:${(r.symbol ?? '').toUpperCase()}`),
  );
  for (const [userId, holdings] of userHoldings) {
    for (const h of holdings) {
      if (!covered.has(`${userId}:${h.symbol.toUpperCase()}`)) return 'incomplete';
    }
  }

  return 'complete';
}

/**
 * Weighted-average entry price for a mid-week purchase.
 *
 * Pure, and moved in here from index.ts so it is covered by the same hermetic
 * tests. Returns null when no priced buy exists, which the caller must treat as
 * "do not fabricate a cost basis" — week_start_price is NOT NULL and is read by
 * three UI surfaces as `quantity * week_start_price`, so a placeholder would
 * render a wrong cost basis rather than an obvious error.
 */
export function midWeekEntryPrice(
  userId: string,
  symbol: string,
  trades: Array<{ user_id: string; symbol: string; action: string; quantity: number; price: number }>,
): number | null {
  let qty = 0;
  let cost = 0;
  for (const t of trades) {
    if (t.user_id !== userId) continue;
    if ((t.symbol ?? '').toUpperCase() !== symbol.toUpperCase()) continue;
    if (t.action !== 'buy') continue;
    const q = Number(t.quantity);
    const p = Number(t.price);
    if (!(q > 0) || !(p > 0)) continue;
    qty += q;
    cost += q * p;
  }
  return qty > 0 ? cost / qty : null;
}

export interface CloseWork {
  /** Kind 1: existing Monday rows to be closed in place. */
  updates: SnapshotUpdate[];
  /** Kind 2: mid-week buys with no row yet. */
  inserts: NewSnapshotRow[];
  /**
   * Symbols required by the work above for which no usable close price exists.
   * NON-EMPTY MEANS ABORT: the caller must write NOTHING for this league this
   * run and let the retry re-attempt. Never write a subset.
   */
  missingSymbols: string[];
  /**
   * Mid-week positions with a close price but no derivable entry price. These
   * are NOT abortable — no amount of retrying invents a trade record — so they
   * are reported for logging and simply not written, rather than blocking the
   * rest of the league forever.
   */
  unbasedPositions: Array<{ userId: string; symbol: string }>;
}

/**
 * Build the complete set of writes for one league-week, all-or-nothing.
 *
 * The atomicity rule is the point: every symbol needed by EITHER kind must be
 * priced, or the whole league is refused. Pricing "the ones we could" is what
 * produced the unhealable partial in the first place.
 */
export function buildCloseWork(
  leagueId: string,
  weekNumber: number,
  userHoldings: Map<string, Holding[]>,
  existing: ExistingSnapshot[],
  prices: Map<string, number>,
  trades: Array<{ user_id: string; symbol: string; action: string; quantity: number; price: number }>,
): CloseWork {
  const updates: SnapshotUpdate[] = [];
  const inserts: NewSnapshotRow[] = [];
  const missing = new Set<string>();
  const unbasedPositions: Array<{ userId: string; symbol: string }> = [];

  const priceOf = (sym: string): number | null => {
    const p = prices.get(sym.toUpperCase());
    return typeof p === 'number' && p > 0 ? p : null;
  };

  // KIND 1 — close existing rows that are still open.
  for (const row of existing) {
    if (row.week_end_price != null) continue; // already closed; never rewrite
    const sym = (row.symbol ?? '').toUpperCase();
    const price = priceOf(sym);
    if (price === null) {
      missing.add(sym);
      continue;
    }
    updates.push({ id: row.id, week_end_price: price });
  }

  // KIND 2 — insert rows for mid-week buys that have no row at all.
  const covered = new Set(
    existing.map((r) => `${r.user_id}:${(r.symbol ?? '').toUpperCase()}`),
  );
  for (const [userId, holdings] of userHoldings) {
    for (const h of holdings) {
      const sym = h.symbol.toUpperCase();
      if (covered.has(`${userId}:${sym}`)) continue;

      const price = priceOf(sym);
      if (price === null) {
        missing.add(sym);
        continue;
      }

      const entryPrice = midWeekEntryPrice(userId, sym, trades);
      if (entryPrice === null) {
        // Priced, but no trade to derive a basis from. Not retryable.
        unbasedPositions.push({ userId, symbol: sym });
        continue;
      }

      inserts.push({
        league_id: leagueId,
        user_id: userId,
        week_number: weekNumber,
        symbol: sym,
        quantity: h.quantity,
        week_start_price: entryPrice,
        entered_mid_week: true,
        week_end_price: price,
      });
    }
  }

  const missingSymbols = [...missing];
  // ABORT: surface the reason, and hand back no work at all so a careless
  // caller cannot write a subset by ignoring missingSymbols.
  if (missingSymbols.length > 0) {
    return { updates: [], inserts: [], missingSymbols, unbasedPositions };
  }

  return { updates, inserts, missingSymbols, unbasedPositions };
}
