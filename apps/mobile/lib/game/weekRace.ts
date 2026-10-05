/**
 * weekRace: the Mon–Fri race chart's points for Matchup (3c). Each point is
 * the week's score AT THAT DAY'S CLOSE: the same liveWeekScore, with the
 * day's close as the price and only the trades made by that close. Days with
 * no bar are left out by the caller and so are absent here. Nothing is
 * interpolated or backdated (spec: "no interpolation").
 */
import { liveWeekScore, type LiveSnapshot, type LiveTrade } from '../home/liveWeekScore';

export interface RaceDay {
  /** YYYY-MM-DD, the trading day. */
  date: string;
  /** The instant that day's session closed; trades after it do not count. */
  closeAt: Date;
  /** That day's close for a symbol, or null when there is no bar. */
  price: (symbol: string) => number | null;
}

export interface RacePoint {
  date: string;
  gain: number;
}

export function weekRacePoints(snapshots: LiveSnapshot[], trades: LiveTrade[], days: RaceDay[]): RacePoint[] {
  // Every symbol the week touches. A day with a missing bar for ANY of them is
  // dropped whole: a point built from part of the lineup is a wrong number,
  // not a smaller one.
  const held = new Set<string>([
    ...snapshots.map((s) => s.symbol.toUpperCase()),
    ...trades.map((t) => t.symbol.toUpperCase()),
  ]);
  const points: RacePoint[] = [];
  for (const day of days) {
    if ([...held].some((symbol) => day.price(symbol) === null)) continue;
    const closeMs = day.closeAt.getTime();
    const byClose = trades.filter((t) => t.createdAt.getTime() <= closeMs);
    points.push({ date: day.date, gain: liveWeekScore(snapshots, byClose, day.price).gain });
  }
  return points;
}
