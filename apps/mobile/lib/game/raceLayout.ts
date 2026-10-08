/**
 * raceLayout (3c): places each side's race points at their trading-day
 * index, so the chart's x-axis is the matchup week's real days. A day with no
 * point is a GAP (weekRacePoints dropped it), never a zero point.
 */
import type { RacePoint } from './weekRace';

export interface RaceLayout {
  labels: string[];
  mine: { index: number; gain: number }[];
  opp: { index: number; gain: number }[];
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon" for a YYYY-MM-DD string, from its calendar date (no timezone). */
function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function raceLayout(input: { days: string[]; mine: RacePoint[]; opp: RacePoint[] }): RaceLayout {
  const index = new Map(input.days.map((d, i) => [d, i] as const));
  const place = (points: RacePoint[]) =>
    points.flatMap((p) => {
      const i = index.get(p.date);
      return i === undefined ? [] : [{ index: i, gain: p.gain }];
    });
  return {
    labels: input.days.map(weekdayOf),
    mine: place(input.mine),
    opp: place(input.opp),
  };
}

export interface RaceCoords {
  mine: { x: number; y: number }[];
  opp: { x: number; y: number }[];
  /** Pixel x of each weekday label, one slot per trading day of the week. */
  labelX: number[];
  zeroY: number;
}

/**
 * Pixel coordinates for the race: x is the day SLOT across the full week (so a
 * gap leaves a gap and Mon..Fri always line up), y is one shared scale for
 * both sides, with zero marked. Pad keeps the ends off the frame.
 */
export function raceCoords(layout: RaceLayout, width: number, height: number, pad = 8): RaceCoords {
  const slots = Math.max(layout.labels.length - 1, 1);
  const x = (index: number) => (index / slots) * width;
  const all = [...layout.mine.map((p) => p.gain), ...layout.opp.map((p) => p.gain), 0];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const y = (gain: number) => pad + ((hi - gain) / span) * (height - 2 * pad);
  return {
    mine: layout.mine.map((p) => ({ x: x(p.index), y: y(p.gain) })),
    opp: layout.opp.map((p) => ({ x: x(p.index), y: y(p.gain) })),
    labelX: layout.labels.map((_, i) => x(i)),
    zeroY: y(0),
  };
}
