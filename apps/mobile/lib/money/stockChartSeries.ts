/**
 * stockChartSeries: the pure data behind the stock sheet's chart (3e, M2).
 * Ranges are daily bars only (Giorgio's chart-ranges ruling (A), 2026-09-30:
 * 1W/1M/3M/1Y, 1W default, NO 1D — overrides the older board mock and spec
 * text, which both still show 1D). A range reads real bars only: this never
 * synthesizes a point for a day with no bar (a closed market, a feed gap).
 */
import { formatMoney } from '../../components/sp/logic/money';

export interface DailyBar {
  /** YYYY-MM-DD. */
  date: string;
  close: number;
}

export type ChartRange = '1W' | '1M' | '3M' | '1Y';

/** Order matters: this is the segmented control's left-to-right order. */
export const CHART_RANGES: ChartRange[] = ['1W', '1M', '3M', '1Y'];
export const DEFAULT_CHART_RANGE: ChartRange = '1W';

const LOOKBACK_DAYS: Record<ChartRange, number> = {
  '1W': 7,
  '1M': 31,
  '3M': 93,
  '1Y': 366,
};

/** Calendar days to look back for a range — a window, not a trading-day count
 * (the bars themselves are already trading days only; weekends and holidays
 * have no row, so they fall out of the window on their own). */
export function rangeLookbackDays(range: ChartRange): number {
  return LOOKBACK_DAYS[range];
}

/** The bars within `range` of `now`, oldest first, real bars only — no
 * interpolation, no synthesized day. A bar dated exactly on the cutoff is
 * kept (>=), so "1W" from a Monday still includes the prior Monday's bar. */
export function barsForRange(bars: DailyBar[], range: ChartRange, now: Date): DailyBar[] {
  const cutoff = new Date(now.getTime() - rangeLookbackDays(range) * 86_400_000);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  return bars
    .filter((b) => b.date >= cutoffIso && b.date <= now.toISOString().slice(0, 10))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Each bar's close, relative to `baseline` (the previous close) — chartGeometry's
 * zero-baseline gain/loss math is reused unchanged by feeding it this delta series. */
export function deltaSeries(bars: DailyBar[], baseline: number): number[] {
  return bars.map((b) => b.close - baseline);
}

const SCRUB_DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };

/** The scrub's floating label: a date and the bar's actual price (never a
 * delta — M2's spec is "a floating price + time label", not a gain line). */
export function stockScrubLabel(bar: DailyBar): { primary: string; money: string } {
  const d = new Date(`${bar.date}T00:00:00Z`);
  const primary = Number.isNaN(d.getTime())
    ? bar.date
    : new Intl.DateTimeFormat('en-US', { ...SCRUB_DATE_FORMAT, timeZone: 'UTC' }).format(d);
  return { primary, money: formatMoney(bar.close) };
}
