/**
 * buildSeasonGainSeries: Home's "Season gain, week by week" chart (D1,
 * Concept A — decided 2026-09-29). Plots the SCORED season, never
 * mark-to-market — see docs/superpowers/plans/2026-09-29-mobile-home-3b2.md
 * ("The numbers: one source per number, and the chart matches the hero").
 *
 * One point per TRADING DAY, taken directly from the day list the caller
 * supplies (from historical-bars) — weekends and holidays are simply
 * absent from that list, which is what keeps them flat by construction,
 * with no synthetic zero-change point ever inserted for them.
 *
 * The series starts at 0 at Week 1's open: nothing before Week 1 is ever
 * plotted, so there is no "draft price vs. Monday open" jump.
 *
 * Each day's within-week contribution is computed with the SAME
 * liveWeekScore() helper Home/Matchup use for the live card — never a
 * second, independently-derived formula. A completed week's LAST trading
 * day is then PINNED to the real `matchups` gain (the source of truth):
 * the bar-derived value is reported alongside it in `pinned`, and a
 * disagreement over one cent is counted in `mismatches` rather than
 * hidden.
 *
 * The CURRENT (unscored) week's last day is pinned the same way, but to
 * `live.gain` — the caller's own already-computed live score, passed in
 * rather than recomputed here, so the chart's endpoint and the hero's
 * displayed gain are the same number by construction, never two
 * independently-rounded calls that could drift apart.
 */

import { liveWeekScore, type LiveSnapshot, type LiveTrade } from './liveWeekScore';

export interface SeasonWeekInput {
  week: number;
  /** The matchups.team_gain for this week, or null for the current,
   * not-yet-scored week. */
  scoredGain: number | null;
  /** This week's Monday-lot snapshots (constant across the week). */
  snapshots: LiveSnapshot[];
  /** This week's trades, any time within the week. */
  trades: LiveTrade[];
  /** Ascending ISO trading-day dates within [weekStart, weekEnd) — from
   * historical-bars. Empty is valid (a bye week with no market data
   * needed still advances the running total via `scoredGain`). */
  tradingDays: string[];
  /**
   * False for a COMPLETED week whose per-day snapshots/trades were not
   * fetched (the request-budget tradeoff: Home's live state fetches only
   * the CURRENT week's ledger — see the plan's F1 — so a past week's
   * intra-week shape is drawn as a plain straight-line ramp from the
   * week's start to its scored end, exactly the same simplification the
   * design board itself makes with its cosmetic DAY_SHAPES). When false,
   * `snapshots`/`trades`/`closesByDate` for this week are ignored, and
   * NO entry is added to `pinned` — there is no independently-fetched bar
   * value to compare against, so no comparison is claimed (CLAUDE.md
   * "verdict scope must match evidence scope": reporting a "mismatch"
   * against data we deliberately didn't fetch would be a false claim,
   * not a finding). Defaults to true. */
  hasData?: boolean;
}

export interface SeasonGainSeriesInput {
  weeks: SeasonWeekInput[];
  /** date -> symbol -> close, covering every symbol referenced by every
   * week's snapshots/trades for every date in that week's tradingDays. */
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
}

export interface PinnedWeek {
  week: number;
  /** What liveWeekScore computed from the day's close price. */
  barGain: number;
  /** What the source of truth (matchups, or the live hero) says. */
  scoredGain: number;
  diff: number;
}

export interface SeasonGainSeriesResult {
  points: SeasonGainPoint[];
  /** Index into `points` where each week's points begin, parallel to `weeks`. */
  weekStartIdx: number[];
  /** Cumulative gain immediately BEFORE each week started, parallel to `weeks` — the 1W rebase base. */
  weekBase: number[];
  pinned: PinnedWeek[];
  /** Count of `pinned` entries whose diff exceeds one cent. */
  mismatches: number;
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
 * never shows up as a false chart wiggle or a spurious mismatch count. */
function cents(v: number): number {
  return Math.round(v * 100) / 100;
}

export function buildSeasonGainSeries(input: SeasonGainSeriesInput): SeasonGainSeriesResult {
  const points: SeasonGainPoint[] = [];
  const weekStartIdx: number[] = [];
  const weekBase: number[] = [];
  const pinned: PinnedWeek[] = [];
  let mismatches = 0;
  let base = 0; // 0 at Week 1's open — no draft/deposit jump.

  for (let wi = 0; wi < input.weeks.length; wi++) {
    const week = input.weeks[wi];
    weekStartIdx.push(points.length);
    weekBase.push(base);

    const isCurrentWeek = week.scoredGain === null;
    const days = week.tradingDays;
    const hasData = week.hasData ?? true;

    for (let di = 0; di < days.length; di++) {
      const date = days[di];
      const isLastDay = di === days.length - 1;

      if (isLastDay && isCurrentWeek && input.live) {
        // The live hero's own number — never recomputed here.
        points.push({ date, week: week.week, gain: cents(base + input.live.gain) });
        continue;
      }

      if (!hasData && week.scoredGain !== null) {
        // No independently-fetched ledger for this week: a plain
        // straight-line ramp to the scored end, no pin/mismatch claimed.
        const fraction = (di + 1) / days.length;
        points.push({ date, week: week.week, gain: cents(base + week.scoredGain * fraction) });
        continue;
      }

      const tradesUpToDay = week.trades.filter((t) => t.createdAt.getTime() <= endOfDay(date));
      const dayResult = liveWeekScore(week.snapshots, tradesUpToDay, (sym) => priceOn(input.closesByDate, date, sym));
      let dayGain = dayResult.gain;

      if (isLastDay && week.scoredGain !== null) {
        const diff = cents(Math.abs(dayGain - week.scoredGain));
        pinned.push({ week: week.week, barGain: dayGain, scoredGain: week.scoredGain, diff });
        if (diff > 0.01) mismatches += 1;
        dayGain = week.scoredGain; // pin to the source of truth
      }

      points.push({ date, week: week.week, gain: cents(base + dayGain) });
    }

    // Advance the running total by this week's FINAL contribution — the
    // scored gain when known, otherwise the live gain (both already
    // reflected in the last point pushed above, when one existed; a
    // zero-tradingDays week still needs this to keep later weeks correct).
    if (week.scoredGain !== null) {
      base = cents(base + week.scoredGain);
    } else if (input.live) {
      base = cents(base + input.live.gain);
    }
  }

  return { points, weekStartIdx, weekBase, pinned, mismatches };
}

export type SeasonWindow = '1W' | '1M' | 'Season';

/**
 * Windowed view of a built series.
 * - 'Season': every point, as-is (already 0-based from Week 1's open).
 * - '1W': the week at `weekIndex`'s own points, rebased to 0 at that
 *   week's start — its endpoint is exactly liveWeekScore's result for
 *   that week (the this-week card's score), never re-derived.
 * - '1M': the last 21 trading days (or fewer, if the series is shorter),
 *   rebased to 0 at the window's own first point.
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
  const WINDOW_DAYS = 21;
  const slice = result.points.slice(Math.max(0, result.points.length - WINDOW_DAYS));
  if (slice.length === 0) return slice;
  const base = slice[0].gain;
  return slice.map((p) => ({ ...p, gain: cents(p.gain - base) }));
}
