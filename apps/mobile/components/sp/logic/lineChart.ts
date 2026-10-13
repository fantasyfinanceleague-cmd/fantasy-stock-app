// Stockpile — the Game Night line chart's geometry (§9C `Chart`, rule 6: "A line stops at
// now, over a labelled X axis"). Pure: no RN, tested in tests-deno/line-chart.test.ts.
//
// One line, positioned by TIME on the axis's domain (chartAxis.ts): a week chart's domain
// is the whole week, so on Thursday the line ends at x ≈ 4/5 and Friday stays empty; a
// dated chart's domain ends at now. A dashed base line (zero gain, or the start price) runs
// edge to edge. No fill, no grid, no Y axis. The end dot sits on the last REAL point.
//
// Designed short states (never a blank frame):
//   - 0 points: the base line and the axis, no line, no dot.
//   - 1 point: the dot alone, on the base line's level when it IS the base.

export interface LinePointIn {
  /** Position on the axis domain (week: 0..5 trading days; dated: days since start). */
  t: number;
  value: number;
}

export interface LinePoint {
  x: number;
  y: number;
}

export interface LineGeometry {
  points: LinePoint[];
  /** '' for 0 or 1 point (nothing to stroke). */
  path: string;
  /** Real stroke length, for the draw-in (react-native-svg ignores pathLength). */
  length: number;
  baseY: number;
  /** The end dot; null with no points. */
  end: LinePoint | null;
  /** x of a domain position — the axis labels use the same mapping. */
  toX: (t: number) => number;
}

export interface LineBox {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export type LineTone = 'gain' | 'loss' | 'zero';

/** §9C: the line is `gain` or `loss` by the WINDOW's sign (last vs base); flat is `zero`
 * (money flat is never green or red, §9A). */
export function lineTone(points: LinePointIn[], base: number): LineTone {
  if (points.length === 0) return 'zero';
  const last = points[points.length - 1].value;
  if (last > base) return 'gain';
  if (last < base) return 'loss';
  return 'zero';
}

export function buildLine(points: LinePointIn[], domain: readonly [number, number], base: number, box: LineBox): LineGeometry {
  const innerW = Math.max(0, box.width - box.padLeft - box.padRight);
  const innerH = Math.max(0, box.height - box.padTop - box.padBottom);
  const [d0, d1] = domain;
  const span = d1 - d0;
  // A zero-length axis (a dated range whose start IS now — a stock bought today) puts its one
  // point at now, the RIGHT end (Design Lead, W4 gate).
  const toX = (t: number) => box.padLeft + (span > 0 ? ((Math.min(Math.max(t, d0), d1) - d0) / span) * innerW : innerW);

  const values = points.map((p) => p.value);
  // One point: the scale is centred on the dashed base, so the dot sits above or below it by
  // its own move (the base line never hugs an edge).
  const half = points.length === 1 ? Math.abs(values[0] - base) : 0;
  const min = points.length === 1 ? base - half : Math.min(base, ...values);
  const max = points.length === 1 ? base + half : Math.max(base, ...values);
  const range = max - min;
  // A flat window (every value = base) draws on the vertical middle, not the floor.
  const toY = (v: number) => box.padTop + (range > 0 ? (1 - (v - min) / range) * innerH : innerH / 2);

  const px: LinePoint[] = points.map((p) => ({ x: toX(p.t), y: toY(p.value) }));
  const path = px.length >= 2 ? px.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') : '';
  let length = 0;
  for (let i = 1; i < px.length; i++) length += Math.hypot(px[i].x - px[i - 1].x, px[i].y - px[i - 1].y);

  return { points: px, path, length, baseY: toY(base), end: px.length ? px[px.length - 1] : null, toX };
}
