/**
 * portfolioChart (W4, Game Night): the Portfolio value line under the hero (§9C "Chart",
 * "The X axis"; Giorgio, 2026-10-12: "the Portfolio chart with range pills: yes"). Pure, so
 * tests-deno/money-portfolio-chart.test.ts pins it.
 *
 * What it plots: the team value (teamValue, the SAME formula as the header and Home) at each
 * trading day's close since the draft, then the live value now. Each day's value is
 * teamValue over the ledger rows up to that day, priced at that day's close (the last close
 * on or before it; a stock with no bar yet counts at cost, never $0). So the line's last point
 * is exactly the header's number, and a buy or a sale moves only the cash/stake split, never
 * the line (the money just changes form).
 *
 * The ranges (the board's Portfolio frame, A: 1W · 1M · Season, Season selected):
 *   - Season  dated axis from the draft day to today; the first point is the stake at cost.
 *   - 1M      dated axis over the last 30 days (or from the draft, if later).
 *   - 1W      the trading week on the Mon…Fri axis (§9C: "the whole trading week, Mon open →
 *             Fri close … the line stops at now and the days still to come stay empty"):
 *             the week starts at the last close before Monday, each closed session's value
 *             sits at its day's end, and a running session's live value at the fraction
 *             elapsed (playerCardModel.weekLine, the card's own week line).
 * The dashed base is the range's first value; the line's colour is the window's sign.
 */
import { teamValue, type StakeMode } from '../home/teamValue';
import { etDateOf } from '../game/matchupRoster';
import { weekLine, weekT } from '../game/playerCardModel';
import type { MarketCalendarSession } from '../time/marketWeek';
import { dayOffset, type AxisSpec } from '../../components/sp/logic/chartAxis';
import type { LinePointIn } from '../../components/sp/logic/lineChart';

export type PortfolioRange = '1W' | '1M' | 'Season';
/** The board's order, left to right. */
export const PORTFOLIO_RANGES: readonly PortfolioRange[] = ['1W', '1M', 'Season'];
export const DEFAULT_PORTFOLIO_RANGE: PortfolioRange = 'Season';

export interface ChartActivityRow {
  kind: 'draft' | 'trade';
  action: 'buy' | 'sell';
  symbol: string;
  quantity: number;
  price: number;
  /** ISO instant. */
  occurredAt: string;
}

export interface ChartStake {
  stakeMode: StakeMode;
  notionalPerSlot: number | null;
  numRounds: number | null;
}

export interface DailyValue {
  /** ET trading date, YYYY-MM-DD. */
  date: string;
  value: number;
}

type Bars = Record<string, readonly { date: string; close: number }[]>;

const cents = (v: number) => Math.round(v * 100) / 100;

/** The ET date a row happened on; rows with no readable instant are left out (never guessed). */
function rowDate(r: ChartActivityRow): string | null {
  return etDateOf(r.occurredAt);
}

/** teamValue over the rows that happened on or before `date`, priced by `priceOf`. */
function valueThrough(rows: readonly ChartActivityRow[], date: string, stake: ChartStake, priceOf: (symbol: string) => number | null): number {
  const upTo = rows.filter((r) => {
    const d = rowDate(r);
    return d !== null && d <= date;
  });
  return teamValue({
    stakeMode: stake.stakeMode,
    notionalPerSlot: stake.notionalPerSlot,
    numRounds: stake.numRounds,
    drafts: upTo.filter((r) => r.kind === 'draft').map((r) => ({ symbol: r.symbol.toUpperCase(), entryPrice: r.price, quantity: r.quantity })),
    trades: upTo.filter((r) => r.kind === 'trade').map((r) => ({ symbol: r.symbol.toUpperCase(), action: r.action, quantity: r.quantity, price: r.price })),
    price: priceOf,
  }).value;
}

/** The last close on or before `date` (bars ascending or not). */
function closeOnOrBefore(bars: readonly { date: string; close: number }[] | undefined, date: string): number | null {
  if (!bars) return null;
  let best: { date: string; close: number } | null = null;
  for (const b of bars) {
    if (!(b.close > 0) || b.date > date) continue;
    if (!best || b.date > best.date) best = b;
  }
  return best ? best.close : null;
}

/** The first day of the season: the earliest draft row's ET date (null: nothing drafted). */
export function draftDateOf(rows: readonly ChartActivityRow[]): string | null {
  let first: string | null = null;
  for (const r of rows) {
    if (r.kind !== 'draft') continue;
    const d = rowDate(r);
    if (d && (!first || d < first)) first = d;
  }
  return first;
}

/**
 * The value at the draft (the stake at cost), then at each trading day's close after the draft
 * day and before today. Trading days are the dates any held-or-ever-held symbol has a bar.
 */
export function dailyValues(input: { rows: readonly ChartActivityRow[]; bars: Bars; stake: ChartStake; todayEt: string }): DailyValue[] {
  const { rows, bars, stake, todayEt } = input;
  const start = draftDateOf(rows);
  if (!start) return [];
  // The draft day: every stock at its draft price, so the value is the stake.
  const out: DailyValue[] = [{ date: start, value: cents(valueThrough(rows, start, stake, () => null)) }];
  const dates = new Set<string>();
  for (const series of Object.values(bars)) {
    for (const b of series) if (b.date > start && b.date < todayEt && b.close > 0) dates.add(b.date);
  }
  for (const date of [...dates].sort()) {
    const value = valueThrough(rows, date, stake, (sym) => closeOnOrBefore(bars[sym] ?? bars[sym.toUpperCase()], date));
    out.push({ date, value: cents(value) });
  }
  return out;
}

export interface PortfolioSeries {
  points: LinePointIn[];
  base: number;
  axis: AxisSpec;
}

function maxIso(a: string, b: string): string {
  return a > b ? a : b;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The Monday of `iso`'s week (Saturday and Sunday belong to the week just ended). */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun … 6 Sat
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

/**
 * The line for one range. `liveValue` is the header's value now (null: no live point, the
 * line stops at the last close). `now` places the live point on the week axis.
 */
export function portfolioSeries(input: {
  range: PortfolioRange;
  daily: readonly DailyValue[];
  liveValue: number | null;
  todayEt: string;
  now: Date;
  /** This week's sessions (the week axis); empty → a standard Mon–Fri week. */
  sessions: readonly MarketCalendarSession[];
  /** The draft's instant, so a season drafted this week starts its week line at the draft. */
  draftAt: string | null;
}): PortfolioSeries {
  const { range, daily, liveValue, todayEt, now, sessions, draftAt } = input;
  const start = daily[0]?.date ?? todayEt;

  if (range === '1W') {
    const monday = mondayOf(todayEt);
    const before = daily.filter((d) => d.date < monday);
    const drafted = daily[0];
    // Held into the week: Monday starts at the last close before it. Drafted this week: the
    // line starts at the draft (its time on the axis; the stake at cost).
    const draftT = drafted && drafted.date >= monday && draftAt ? weekT(new Date(draftAt), sessions) : null;
    const weekStart = before.length
      ? { t: 0, value: before[before.length - 1].value }
      : drafted
        ? { t: draftT ?? 0, value: drafted.value }
        : null;
    if (!weekStart) return { points: [], base: 0, axis: { kind: 'week' } };
    const bars = daily.filter((d) => d.date >= monday).map((d) => ({ date: d.date, close: d.value }));
    // A closed session today has no daily value yet (daily stops before today): its close is
    // the live value.
    if (liveValue != null && !bars.some((b) => b.date === todayEt)) bars.push({ date: todayEt, close: liveValue });
    const line = weekLine({ sessions, start: weekStart, bars, price: liveValue, now });
    return { points: line.points, base: line.base, axis: { kind: 'week' } };
  }

  const from = range === '1M' ? maxIso(start, addDays(todayEt, -30)) : start;
  // 1M: the value entering the window is its first point (the last close on or before `from`).
  const inside = daily.filter((d) => d.date >= from);
  const entering = [...daily].reverse().find((d) => d.date <= from);
  const first = entering && (!inside.length || inside[0].date > from) ? [{ date: from, value: entering.value }, ...inside] : inside;
  const series = liveValue != null && todayEt >= from ? [...first.filter((d) => d.date < todayEt), { date: todayEt, value: liveValue }] : first;
  const axisStart = series[0]?.date ?? from;
  const points = series.map((d) => ({ t: dayOffset(axisStart, d.date), value: d.value }));
  return {
    points,
    base: points[0]?.value ?? liveValue ?? 0,
    axis: { kind: 'dated', start: axisStart, end: todayEt < axisStart ? axisStart : todayEt },
  };
}
