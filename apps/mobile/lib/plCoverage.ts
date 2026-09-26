/**
 * The one rule every P/L surface uses for a holding that has no price.
 *
 * Pure (no RN, no Supabase) so it runs under `deno test tests-deno/`.
 *
 * THE RULE: an unpriced holding is counted AT COST (zero gain) and COUNTED.
 * - Dropping it (the old chart) shrinks the basis, so a whole-portfolio value
 *   got paired with a gain/percent computed over a subset: "$8,124 · +29.29%"
 *   where the real figure was +8.15%.
 * - Valuing it at $0 (the old Home totals) books a phantom −100% loss the
 *   moment one quote is missing, and reads −100% on every cold load.
 * Counting it at cost keeps value − cost = gain and gain / cost = percent
 * reconciled, and `unpricedCount` states exactly what was assumed — the scope
 * of the verdict matches the scope of the evidence (CLAUDE.md, "Guards here are
 * keyed on ALL-OR-NOTHING state…").
 *
 * STALENESS: a carried-forward price older than MAX_PRICE_CARRY_DAYS counts as
 * unpriced. A 3-day weekend or holiday gap stays priced; a series truncated
 * months ago (historical-bars cut BA at 2026-01-05) does not get carried
 * forward as if it were current.
 */

export const MAX_PRICE_CARRY_DAYS = 7;

export interface CostedHolding {
  symbol: string;
  quantity: number;
  totalCost: number;
}

export interface HoldingsSummary {
  value: number;
  cost: number;
  gainLoss: number;
  gainLossPercent: number;
  pricedCount: number;
  unpricedCount: number;
}

function isUsablePrice(price: number | null | undefined): price is number {
  return typeof price === 'number' && Number.isFinite(price) && price > 0;
}

/** Summarise open holdings against current prices, unpriced counted at cost. */
export function summarizeHoldings(
  holdings: CostedHolding[],
  priceOf: (symbol: string) => number | null | undefined,
): HoldingsSummary {
  let value = 0;
  let cost = 0;
  let pricedCount = 0;
  let unpricedCount = 0;

  for (const h of holdings) {
    if (!(h.quantity > 0)) continue;
    const price = priceOf(h.symbol.toUpperCase());
    cost += h.totalCost;
    if (isUsablePrice(price)) {
      value += price * h.quantity;
      pricedCount++;
    } else {
      value += h.totalCost;
      unpricedCount++;
    }
  }

  const gainLoss = value - cost;
  return {
    value,
    cost,
    gainLoss,
    gainLossPercent: cost > 0 ? (gainLoss / cost) * 100 : 0,
    pricedCount,
    unpricedCount,
  };
}

// ---------------------------------------------------------------------------
// Historical series
// ---------------------------------------------------------------------------

export interface PositionEvent {
  date: string; // YYYY-MM-DD
  symbol: string;
  quantity: number; // positive for buy/draft, negative for sell
  cost: number; // total cost for a buy; ignored for a sell
}

export interface PLDataPoint {
  date: string; // YYYY-MM-DD
  value: number; // portfolio value (unpriced holdings at cost)
  cost: number; // cost basis of every open holding
  pl: number;
  plPercent: number;
  unpricedCount: number; // open holdings with no bar within MAX_PRICE_CARRY_DAYS
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Walk position events against daily closes and emit one point per date on
 * which either a price or a position changed. Event dates are part of the
 * timeline so a draft dated after the last bar (e.g. today, before today's bar
 * exists) still enters the series. Returns [] when there are no bars at all —
 * there is no shape to draw.
 *
 * @param priceLookup { 'YYYY-MM-DD': { SYMBOL: close } }
 */
export function buildPLSeries(
  events: PositionEvent[],
  priceLookup: Record<string, Record<string, number>>,
): PLDataPoint[] {
  if (Object.keys(priceLookup).length === 0) return [];

  const sortedEvents = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const dates = Array.from(new Set([...Object.keys(priceLookup), ...sortedEvents.map(e => e.date)])).sort();

  const positions: Record<string, { quantity: number; costBasis: number }> = {};
  const lastPrice: Record<string, { price: number; date: string }> = {};
  const series: PLDataPoint[] = [];
  let eventIndex = 0;

  for (const date of dates) {
    // Apply all events up to and including this date
    while (eventIndex < sortedEvents.length && sortedEvents[eventIndex].date <= date) {
      const event = sortedEvents[eventIndex];
      const pos = positions[event.symbol] ?? { quantity: 0, costBasis: 0 };

      if (event.quantity > 0) {
        pos.quantity += event.quantity;
        pos.costBasis += event.cost;
      } else if (pos.quantity > 0) {
        // Sell: reduce position at average cost
        const avgCost = pos.costBasis / pos.quantity;
        pos.quantity -= Math.abs(event.quantity);
        pos.costBasis = avgCost * pos.quantity;
      }

      if (pos.quantity <= 0) {
        delete positions[event.symbol];
      } else {
        positions[event.symbol] = pos;
      }
      eventIndex++;
    }

    for (const [symbol, price] of Object.entries(priceLookup[date] ?? {})) {
      if (isUsablePrice(price)) lastPrice[symbol] = { price, date };
    }

    let value = 0;
    let cost = 0;
    let unpricedCount = 0;
    for (const [symbol, pos] of Object.entries(positions)) {
      const last = lastPrice[symbol];
      cost += pos.costBasis;
      if (last && daysBetween(last.date, date) <= MAX_PRICE_CARRY_DAYS) {
        value += last.price * pos.quantity;
      } else {
        value += pos.costBasis;
        unpricedCount++;
      }
    }

    if (cost > 0) {
      const pl = value - cost;
      series.push({ date, value, cost, pl, plPercent: (pl / cost) * 100, unpricedCount });
    }
  }

  return series;
}

// ---------------------------------------------------------------------------
// Hero decision
// ---------------------------------------------------------------------------

export type Period = '1W' | '1M' | 'Season' | 'All';

export interface PeriodPL {
  gainLoss: number;
  gainLossPercent: number;
  isPositive: boolean;
  period: Period;
  /** Both window endpoints priced every open holding (unpricedCount 0). */
  complete: boolean;
}

export interface HeroPL {
  gainLoss: number;
  gainLossPercent: number;
  isPositive: boolean;
  /** Captions to render under the gain row; empty when nothing was assumed. */
  notes: string[];
}

export function unpricedNote(unpricedCount: number): string | null {
  if (unpricedCount <= 0) return null;
  return `${unpricedCount} ${unpricedCount === 1 ? 'holding' : 'holdings'} not yet priced · counted at cost`;
}

/**
 * Pick the gain row shown under a hero value that was computed by
 * summarizeHoldings. All/Season always read that same summary (live prices,
 * every holding) so gain and value share one scope; the chart only supplies
 * the 1W/1M delta, and only when both of its endpoints priced every holding.
 */
export function decideHeroPL(summary: HoldingsSummary, periodPL: PeriodPL | null): HeroPL {
  const notes: string[] = [];
  const shortWindow = periodPL !== null && (periodPL.period === '1W' || periodPL.period === '1M');

  let result: Omit<HeroPL, 'notes'>;
  if (shortWindow && periodPL.complete) {
    result = { gainLoss: periodPL.gainLoss, gainLossPercent: periodPL.gainLossPercent, isPositive: periodPL.isPositive };
  } else {
    result = { gainLoss: summary.gainLoss, gainLossPercent: summary.gainLossPercent, isPositive: summary.gainLoss >= 0 };
    if (shortWindow) notes.push(`${periodPL.period} price history incomplete · showing all-time`);
  }

  const note = unpricedNote(summary.unpricedCount);
  if (note) notes.push(note);

  return { ...result, notes };
}
