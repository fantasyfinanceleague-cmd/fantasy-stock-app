/**
 * stockChartSeries: the pure data behind the stock sheet's chart (3e, M2).
 * Ranges are daily bars only (Giorgio's chart-ranges ruling (A), 2026-09-30:
 * 1W/1M/3M/1Y, 1W default, NO 1D — overrides the older board mock and spec
 * text, which both still show 1D). A range reads real bars only: this never
 * synthesizes a point for a day with no bar (a closed market, a feed gap).
 */
import { formatMoney, formatPercent } from '../../components/sp/logic/money';
import { dayOffset, type AxisSpec } from '../../components/sp/logic/chartAxis';
import type { LinePointIn } from '../../components/sp/logic/lineChart';
import { weekLine } from '../game/playerCardModel';
import type { MarketCalendarSession } from '../time/marketWeek';

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

/** Each bar's close, relative to `baseline` — chartGeometry's zero-baseline
 * gain/loss math is reused unchanged by feeding it this delta series. */
export function deltaSeries(bars: DailyBar[], baseline: number): number[] {
  return bars.map((b) => b.close - baseline);
}

const PERIOD_LABEL: Record<ChartRange, string> = {
  '1W': 'A week ago',
  '1M': 'A month ago',
  '3M': '3 months ago',
  '1Y': 'A year ago',
};

const SHORT_DATE_FORMAT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

function shortDateLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return new Intl.DateTimeFormat('en-US', { ...SHORT_DATE_FORMAT, timeZone: 'UTC' }).format(d);
}

export interface ReferenceLine {
  /** The chart's baseline value — feed this to deltaSeries. */
  baseline: number;
  /** "A week ago $353.85", or "Sep 15 close $353.85" for the short-history edge case. */
  text: string;
}

/**
 * The chart's reference line (Design Lead ruling, 2026-10-06): the range's
 * FIRST close, not the previous close. Labelled by period ("A week ago $X")
 * UNLESS the price history itself starts later than the range's lookback (a
 * newly listed stock) — then the label names the bar's own date instead
 * ("Sep 15 close $X"), never the range name, since "a week ago" would claim
 * data that doesn't exist. `allBars` is the FULL fetched history (unsliced,
 * oldest first) — the short-history check needs to know what's missing, which
 * a pre-sliced `barsForRange` result can't say on its own.
 */
export function referenceLine(allBars: DailyBar[], range: ChartRange, now: Date): ReferenceLine | null {
  const rangeBars = barsForRange(allBars, range, now);
  if (rangeBars.length === 0) return null;
  const baselineBar = rangeBars[0];

  const cutoff = new Date(now.getTime() - rangeLookbackDays(range) * 86_400_000);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const earliestEver = allBars.reduce<string | null>((min, b) => (min === null || b.date < min ? b.date : min), null);
  const shortHistory = earliestEver === null || earliestEver > cutoffIso;

  const text = shortHistory
    ? `${shortDateLabel(baselineBar.date)} close ${formatMoney(baselineBar.close)}`
    : `${PERIOD_LABEL[range]} ${formatMoney(baselineBar.close)}`;
  return { baseline: baselineBar.close, text };
}

export interface ScrubLabel {
  /** A readable date ("Wed, Oct 1" / "Oct 1, 2025"), or "Today" for the latest point. */
  primary: string;
  price: string;
  /** Signed, vs the range's baseline (never the previous bar, never prevClose). */
  money: string;
  /** Signed, vs the range's baseline. */
  percent: string;
  /** For the caller's gain/loss colour — colour is never the only code (the
   * sign is already in `money` and `percent`). */
  gain: boolean;
}

const SCRUB_DATE_THIS_YEAR: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
const SCRUB_DATE_OTHER_YEAR: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

function scrubDateLabel(dateIso: string, now: Date): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateIso;
  // No year unless the bar isn't from this year (Design Lead ruling).
  const opts = d.getUTCFullYear() === now.getUTCFullYear() ? SCRUB_DATE_THIS_YEAR : SCRUB_DATE_OTHER_YEAR;
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(d);
}

/**
 * The scrub's floating label (Design Lead ruling, 2026-10-06): date, close,
 * and the change vs the range's baseline, signed, in gain/loss colour. The
 * latest point in the range reads "Today" instead of its date. Never calls
 * Intl's formatToParts — date-only strings don't carry the Hermes
 * hour/hourCycle gap formatToParts has, but this sidesteps it on principle
 * (Deno can't see that gap either way, so there is nothing to pin a test on).
 */
export function stockScrubLabel(bar: DailyBar, baseline: number, isLatest: boolean, now: Date): ScrubLabel {
  const delta = bar.close - baseline;
  const pct = baseline !== 0 ? (delta / baseline) * 100 : 0;
  return {
    primary: isLatest ? 'Today' : scrubDateLabel(bar.date, now),
    price: formatMoney(bar.close),
    money: formatMoney(delta, { sign: 'always' }),
    percent: formatPercent(pct, { sign: 'always' }),
    gain: delta >= 0,
  };
}

// ── Game Night (W4): the sheet's line on the §9C X axis ─────────────────────────────────

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function mondayOfIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysIso(iso, dow === 0 ? -6 : 1 - dow);
}

/**
 * The stock sheet's line for one range, on the Game Night Chart (§9C "The X axis"):
 *   - 1W: the trading week on the Mon…Fri axis ("1W on a stock"): from the last close before
 *     Monday, each closed session's close at its day's end, the live price at the fraction of
 *     a running session; the days to come stay empty.
 *   - 1M / 3M / 1Y: a dated axis from the range's first close to today ("MMM d"; 1Y in months),
 *     the closes in the window, then the live price as today's point.
 * The base (the dashed line) is the range's first value: the Design Lead's 2026-10-06 ruling
 * (the range's FIRST close, not the previous close) carried over. Real bars only: a day with no
 * bar is never invented.
 */
export function stockLineSeries(input: {
  range: ChartRange;
  bars: readonly DailyBar[];
  price: number | null;
  todayEt: string;
  now: Date;
  /** This week's sessions (the 1W axis). */
  sessions: readonly MarketCalendarSession[];
}): { points: LinePointIn[]; base: number; axis: AxisSpec } {
  const { range, price, todayEt, now, sessions } = input;
  const bars = [...input.bars].filter((b) => b.close > 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (range === '1W') {
    const monday = mondayOfIso(todayEt);
    const before = bars.filter((b) => b.date < monday);
    const week = bars.filter((b) => b.date >= monday);
    const startValue = before.length ? before[before.length - 1].close : week[0]?.close ?? price;
    if (startValue == null) return { points: [], base: 0, axis: { kind: 'week' } };
    const line = weekLine({ sessions, start: { t: 0, value: startValue }, bars: week, price, now });
    return { points: line.points, base: line.base, axis: { kind: 'week' } };
  }
  const cutoff = addDaysIso(todayEt, -rangeLookbackDays(range));
  const inWindow = bars.filter((b) => b.date >= cutoff && (price == null ? b.date <= todayEt : b.date < todayEt));
  const series = price != null ? [...inWindow, { date: todayEt, close: price }] : inWindow;
  const start = series[0]?.date ?? todayEt;
  return {
    points: series.map((b) => ({ t: dayOffset(start, b.date), value: b.close })),
    base: series[0]?.close ?? price ?? 0,
    axis: { kind: 'dated', start, end: todayEt < start ? start : todayEt, months: range === '1Y' },
  };
}
