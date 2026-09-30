/**
 * buildSeasonGainSeries: Home's "Season gain, week by week" chart (D1,
 * Concept A — decided 2026-09-29). Plots the SCORED season, never
 * mark-to-market — see docs/superpowers/plans/2026-09-29-mobile-home-3b2.md
 * ("The numbers: one source per number, and the chart matches the hero").
 *
 * NO COSMETIC RAMP (Orchestrator ruling, 2026-09-30, superseding this
 * module's earlier `hasData:false` straight-line-ramp behavior): a past,
 * SCORED week contributes exactly ONE point — its own `matchups` gain,
 * at `weekEnd` — never a fabricated per-day interpolation. The series
 * opens with one more real point: Week 1's open, at 0, before anything
 * has happened. Only the CURRENT (unscored) week gets real per-day
 * granularity, from the caller's own fetched bars. A straight line drawn
 * between two real points is honest interpolation; a point that LOOKS
 * like a third data point but isn't one is not. Every `SeasonGainPoint`
 * is tagged `kind` so the renderer can tell which is which and never
 * label an interpolated position as if it were real.
 *
 * Each live day's contribution is computed with the SAME liveWeekScore()
 * helper Home/Matchup use for the live card — never a second,
 * independently-derived formula. The live week's last day is pinned to
 * `live.gain` — the caller's own already-computed live score, passed in
 * rather than recomputed here, so the chart's endpoint and the hero's
 * displayed gain are the same number by construction, never two
 * independently-rounded calls that could drift apart. A past week's
 * point needs no such pin: it's built directly from the source of truth
 * (`matchups.team_gain`), so there is nothing to compare it against or
 * disagree with.
 */

import { liveWeekScore, type LiveSnapshot, type LiveTrade } from './liveWeekScore';

export interface SeasonWeekInput {
  week: number;
  /** ISO. Only week[0]'s is read, for the series' opening 0-point. */
  weekStart: string;
  /** ISO. This week's single point's date, when it's a past, scored week. */
  weekEnd: string;
  /** The matchups.team_gain for this week, or null for the current,
   * not-yet-scored week. */
  scoredGain: number | null;
  /** Only meaningful for the CURRENT (unscored) week. */
  snapshots: LiveSnapshot[];
  trades: LiveTrade[];
  /** Ascending ISO trading-day dates within [weekStart, weekEnd) — from
   * historical-bars. Only meaningful for the CURRENT (unscored) week. */
  tradingDays: string[];
}

export interface SeasonGainSeriesInput {
  weeks: SeasonWeekInput[];
  /** date -> symbol -> close, for the current week's tradingDays only. */
  closesByDate: Record<string, Record<string, number>>;
  /** The current week's already-computed live gain — see the module doc.
   * Null when there is no live week (e.g. season complete). */
  live: { gain: number } | null;
}

export interface SeasonGainPoint {
  date: string;
  week: number;
  /** Cumulative season gain through this point (the chart's y value). */
  gain: number;
  /** 'weekly': a past week's single scored point, or the Week-1-open
   * anchor — there is no real data between it and its neighbors, only a
   * straight line. 'daily': a real trading day within the live,
   * unscored week. The renderer must never label a 'weekly' point's
   * neighboring gap as if it were also measured. */
  kind: 'weekly' | 'daily';
  /** This point's position on a TRADING-DAY timeline across the season —
   * the chart's x value (Design Lead ruling, 2026-09-30). Each week
   * (by its position in `weeks`, not its `week` number, which can skip
   * for playoffs) occupies TRADING_DAYS_PER_WEEK slots; a past week's
   * point sits at its own Friday slot, a live day sits at its own
   * weekday offset from that week's Monday. Positioning by array index
   * instead would give a live week's handful of days as much width as
   * whole past weeks — a visual lie about time. */
  dayIndex: number;
}

/** Trading days per week, used ONLY for x-axis spacing — a simplification
 * (Design Lead ruling, 2026-09-30: "otherwise 5") since past weeks no
 * longer carry a real per-week trading-day count (see the no-cosmetic-
 * ramp doc above). Never used for anything that affects a dollar figure. */
const TRADING_DAYS_PER_WEEK = 5;

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Calendar-day offset of `dateIso` from `weekStartIso`'s own date — safe
 * within one Mon-Fri span (no weekend can fall between them), so this is
 * also the trading-day offset: Monday=0, Tuesday=1, ..., Friday=4. */
function dayOffsetInWeek(weekStartIso: string, dateIso: string): number {
  const start = new Date(`${dateOnly(weekStartIso)}T00:00:00Z`).getTime();
  const day = new Date(`${dateOnly(dateIso)}T00:00:00Z`).getTime();
  return Math.round((day - start) / 86_400_000);
}

export interface SeasonGainSeriesResult {
  points: SeasonGainPoint[];
  /** Index into `points` where each week's points begin, parallel to `weeks`. */
  weekStartIdx: number[];
  /** Cumulative gain immediately BEFORE each week started, parallel to `weeks` — the 1W rebase base. */
  weekBase: number[];
}

function priceOn(closesByDate: Record<string, Record<string, number>>, date: string, symbol: string): number | null {
  return closesByDate[date]?.[symbol.toUpperCase()] ?? null;
}

function endOfDay(date: string): number {
  return new Date(`${date}T23:59:59.999Z`).getTime();
}

/** Round to the cent — dollar amounts are compared/accumulated at cent
 * precision throughout (matching data.js's `cents()` and the server's
 * `.toFixed(2)` logs), so IEEE-754 noise from repeated float addition
 * never shows up as a false chart wiggle. */
function cents(v: number): number {
  return Math.round(v * 100) / 100;
}

export function buildSeasonGainSeries(input: SeasonGainSeriesInput): SeasonGainSeriesResult {
  const points: SeasonGainPoint[] = [];
  const weekStartIdx: number[] = [];
  const weekBase: number[] = [];
  let base = 0; // 0 at Week 1's open — no draft/deposit jump.

  for (let wi = 0; wi < input.weeks.length; wi++) {
    const week = input.weeks[wi];
    const weekBaseDayIndex = wi * TRADING_DAYS_PER_WEEK;
    weekStartIdx.push(points.length);
    weekBase.push(base);

    if (wi === 0) {
      points.push({ date: week.weekStart, week: week.week, gain: 0, kind: 'weekly', dayIndex: weekBaseDayIndex });
    }

    const isCurrentWeek = week.scoredGain === null;

    if (!isCurrentWeek) {
      // A past, scored week: one real point, pinned directly to the
      // source of truth, positioned at its own Friday slot. No bar-
      // derived value is computed for it, so there is nothing to
      // compare or claim a mismatch against.
      base = cents(base + week.scoredGain!);
      points.push({
        date: week.weekEnd, week: week.week, gain: base, kind: 'weekly',
        dayIndex: weekBaseDayIndex + TRADING_DAYS_PER_WEEK - 1,
      });
      continue;
    }

    // The live, unscored week: real per-day granularity from the
    // caller's fetched bars, each positioned at its own weekday offset.
    const days = week.tradingDays;
    for (let di = 0; di < days.length; di++) {
      const date = days[di];
      const isLastDay = di === days.length - 1;
      const dayIndex = weekBaseDayIndex + dayOffsetInWeek(week.weekStart, date);

      if (isLastDay && input.live) {
        // The live hero's own number — never recomputed here.
        points.push({ date, week: week.week, gain: cents(base + input.live.gain), kind: 'daily', dayIndex });
        continue;
      }

      const tradesUpToDay = week.trades.filter((t) => t.createdAt.getTime() <= endOfDay(date));
      const dayResult = liveWeekScore(week.snapshots, tradesUpToDay, (sym) => priceOn(input.closesByDate, date, sym));
      points.push({ date, week: week.week, gain: cents(base + dayResult.gain), kind: 'daily', dayIndex });
    }

    if (input.live) base = cents(base + input.live.gain);
  }

  return { points, weekStartIdx, weekBase };
}

export type SeasonWindow = '1W' | '1M' | 'Season';

/**
 * Windowed view of a built series.
 * - 'Season': every point, as-is (already 0-based from Week 1's open).
 * - '1W': the week at `weekIndex`'s own points, rebased to 0 at that
 *   week's start — its endpoint is exactly liveWeekScore's result for
 *   that week (the this-week card's score), never re-derived.
 * - '1M': every point within the last 30 CALENDAR days of the series'
 *   final point, rebased to 0 at the window's own first point. A point
 *   count (e.g. "the last 21 points") no longer corresponds to a day
 *   count now that a past week contributes one point instead of one per
 *   trading day, so the window is cut by date, not by index.
 */
export function windowSeries(
  result: SeasonGainSeriesResult,
  window: SeasonWindow,
  weekIndex: number,
): SeasonGainPoint[] {
  if (window === 'Season') return result.points;

  if (window === '1W') {
    const start = result.weekStartIdx[weekIndex];
    const end = weekIndex + 1 < result.weekStartIdx.length ? result.weekStartIdx[weekIndex + 1] : result.points.length;
    const base = result.weekBase[weekIndex];
    return result.points.slice(start, end).map((p) => ({ ...p, gain: cents(p.gain - base) }));
  }

  // '1M'
  const WINDOW_DAYS = 30;
  if (result.points.length === 0) return [];
  const lastDate = result.points[result.points.length - 1].date;
  const cutoff = new Date(`${lastDate}T00:00:00Z`).getTime() - WINDOW_DAYS * 86_400_000;
  const slice = result.points.filter((p) => new Date(`${p.date}T00:00:00Z`).getTime() >= cutoff);
  if (slice.length === 0) return slice;
  const base = slice[0].gain;
  return slice.map((p) => ({ ...p, gain: cents(p.gain - base) }));
}
