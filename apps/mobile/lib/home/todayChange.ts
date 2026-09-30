/**
 * todayChange: Home hero's "+$Z today" segment (D1: "+$343.59 · +2.86%
 * season gain · +$121.26 today"). Per-position rule (Orchestrator ruling,
 * 2026-09-29 — this is the partial-state trap again, handled per
 * position rather than as one aggregate):
 *   held since before today:  qty * (price - prevClose)
 *   bought today:             qty * (price - buyPrice)
 *   sold today:               proceeds - qty * prevClose
 *   a slot sold then rebought the same day: both rules apply, one per
 *     portion of the day's activity on that symbol.
 *
 * This is EXACTLY liveWeekScore's algorithm with "the week" shrunk to "one
 * day": a before-today holding is a week-start lot priced at yesterday's
 * close instead of Monday's open, and today's trades are the week's
 * trades. Reusing liveWeekScore, rather than re-deriving the same FIFO
 * logic, is what makes the same-day-round-trip case fall out for free —
 * a sell consumes the before-today lot first, then a rebuy opens a new
 * "mid-week" (here, mid-day) lot priced against the live price.
 *
 * A missing prevClose for a symbol is reported in `unpriced`, never
 * counted as $0 (CLAUDE.md "success signals": a missing price is not
 * zero). A non-trading day hides the whole segment (`total: null`) rather
 * than showing a stale or fabricated number.
 */

import { liveWeekScore, type LiveSnapshot, type LiveTrade } from './liveWeekScore';

export interface TodayPosition {
  symbol: string;
  /** Quantity held at the START of today, before any of today's trades —
   * i.e. yesterday's closing position. */
  quantityBeforeToday: number;
}

export interface TodayChangeResult {
  /** Null on a non-trading day (weekend/holiday) or when nothing could be
   * priced at all — the caller hides the "today" segment on null. */
  total: number | null;
  unpriced: string[];
}

export function todayChange(
  positionsBeforeToday: TodayPosition[],
  todaysTrades: LiveTrade[],
  price: (symbol: string) => number | null,
  prevClose: (symbol: string) => number | null,
  isTradingDay: boolean,
): TodayChangeResult {
  if (!isTradingDay) return { total: null, unpriced: [] };

  const snapshots: LiveSnapshot[] = [];
  const unpricedPrevClose: string[] = [];
  for (const p of positionsBeforeToday) {
    if (p.quantityBeforeToday <= 0) continue;
    const pc = prevClose(p.symbol);
    if (pc == null) {
      unpricedPrevClose.push(p.symbol);
      continue;
    }
    snapshots.push({ symbol: p.symbol, quantity: p.quantityBeforeToday, weekStartPrice: pc, enteredMidWeek: false });
  }

  const result = liveWeekScore(snapshots, todaysTrades, price);
  const unpriced = [...new Set([...unpricedPrevClose, ...result.unpriced])];

  return { total: result.gain, unpriced };
}
