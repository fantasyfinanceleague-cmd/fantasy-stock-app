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
): ChartGeometry {
  const { padTop, padBottom, padLeft, padRight } = { ...DEFAULTS, ...options };
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const range = max - min || 1;

  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const x = (i: number) => padLeft + (series.length <= 1 ? 0 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => padTop + (1 - (v - min) / range) * innerH;

  const points: ChartPoint[] = series.map((v, i) => ({ x: x(i), y: y(v) }));

  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  const zeroY = y(0);
  const lastX = points.length > 0 ? points[points.length - 1].x : 0;
  const firstX = points.length > 0 ? points[0].x : 0;
  const areaPath = `${linePath} L${lastX.toFixed(2)},${zeroY.toFixed(2)} L${firstX.toFixed(2)},${zeroY.toFixed(2)} Z`;

  return { linePath, areaPath, zeroY, points, width, height };
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
