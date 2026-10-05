/**
 * chartGeometry: pure SVG path math for the Season card's chart (Phase
 * 3b-2). Mirrors the design board's GainChart function
 * (docs/design/screens/screens.jsx) byte-for-byte in approach: a zero
 * baseline, gain above / loss below, split by a clip rect at the zero
 * line rather than two separately-coloured line segments.
 *
 * Kept dependency-free (no react-native-svg, no reanimated) so it's
 * testable under Deno and shared between the live component and any
 * future web port, same reasoning as components/sp/logic/*.ts.
 */

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartGeometry {
  /** The line's `d` attribute. */
  linePath: string;
  /** Real length of linePath in px (sum of segment lengths). The draw-in
   * dash uses this, not a normalised pathLength -- react-native-svg ignores
   * pathLength at runtime, so a dash of "1" drew the line as dots. */
  lineLength: number;
  /** The filled area under/over the line, closed at the zero line — pass
   * this to two <Path>s, one clipped above zero (gain fill) and one
   * clipped below (loss fill), exactly like the board's two clipPaths. */
  areaPath: string;
  /** Pixel y of the zero line — the clip rects' boundary. */
  zeroY: number;
  /** One point per series value, in pixel space — for the scrub gesture's
   * hit-testing and the week-chip tick marks. */
  points: ChartPoint[];
  width: number;
  height: number;
}

export interface ChartGeometryOptions {
  padTop?: number;
  padBottom?: number;
  padLeft?: number;
  padRight?: number;
}

const DEFAULTS: Required<ChartGeometryOptions> = { padTop: 10, padBottom: 22, padLeft: 0, padRight: 0 };

export function buildChartGeometry(
  series: number[],
  width: number,
  height: number,
  options: ChartGeometryOptions = {},
  /** One x-position per series value (e.g. a trading-day index), used
   * instead of even index-spacing — Design Lead ruling, 2026-09-30: with
   * one point per past week but up to five per live week, spacing by
   * array index gave the live week's few days as much width as whole
   * past weeks, a visual lie about time. Omitted, this defaults to
   * `[0, 1, 2, ...]` — identical to the old even-spacing behavior. */
  positions?: number[],
): ChartGeometry {
  const { padTop, padBottom, padLeft, padRight } = { ...DEFAULTS, ...options };
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const range = max - min || 1;

  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const pos = positions ?? series.map((_, i) => i);
  const posMin = pos.length > 0 ? pos[0] : 0;
  const posRange = pos.length > 0 ? (pos[pos.length - 1] - posMin || 1) : 1;
  const x = (i: number) => padLeft + (pos.length <= 1 ? 0 : ((pos[i] - posMin) / posRange) * innerW);
  const y = (v: number) => padTop + (1 - (v - min) / range) * innerH;

  const points: ChartPoint[] = series.map((v, i) => ({ x: x(i), y: y(v) }));

  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  const zeroY = y(0);
  const lastX = points.length > 0 ? points[points.length - 1].x : 0;
  const firstX = points.length > 0 ? points[0].x : 0;
  const areaPath = `${linePath} L${lastX.toFixed(2)},${zeroY.toFixed(2)} L${firstX.toFixed(2)},${zeroY.toFixed(2)} Z`;

  let lineLength = 0;
  for (let i = 1; i < points.length; i++) {
    lineLength += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }

  return { linePath, areaPath, zeroY, points, width, height, lineLength };
}

/** The index of the series point closest to pixel x — the scrub gesture's
 * hit-test, and the source of the trading-day haptic tick (a changed
 * index fires one tick). */
export function nearestPointIndex(points: ChartPoint[], x: number): number {
  if (points.length === 0) return -1;
  let best = 0;
  let bestDist = Math.abs(points[0].x - x);
  for (let i = 1; i < points.length; i++) {
    const dist = Math.abs(points[i].x - x);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * partialLinePath: the season line drawn only up to `fraction` (0..1) of its
 * real length, as an SVG path. This is the H2 draw-in. The line is built point
 * by point, so the cut lands exactly on the line, mid-segment if need be.
 * fraction >= 1 returns the full line, the same string as linePath.
 */
export function partialLinePath(points: ChartPoint[], fraction: number, lineLength: number): string {
  if (points.length === 0 || fraction <= 0) return '';
  if (fraction >= 1 || lineLength <= 0) {
    return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  }
  const target = fraction * lineLength;
  const parts: string[] = [`M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + seg <= target) {
      parts.push(`L${b.x.toFixed(2)},${b.y.toFixed(2)}`);
      walked += seg;
      continue;
    }
    const t = seg > 0 ? (target - walked) / seg : 0;
    parts.push(`L${(a.x + (b.x - a.x) * t).toFixed(2)},${(a.y + (b.y - a.y) * t).toFixed(2)}`);
    break;
  }
  return parts.join(' ');
}

