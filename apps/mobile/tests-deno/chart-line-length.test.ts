/**
 * buildChartGeometry's lineLength (B1, Design Lead gate 2026-10-05): the
 * season chart's draw-in dashes a SOLID line by its real length. Must equal
 * the sum of the segment lengths between the plotted points.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertAlmostEquals, assertEquals } from 'jsr:@std/assert';
import { buildChartGeometry, partialLinePath } from '../lib/home/chartGeometry.ts';

Deno.test('lineLength: one point has no length', () => {
  assertEquals(buildChartGeometry([5], 300, 100, {}).lineLength, 0);
});

Deno.test('lineLength: equals the sum of the plotted segment lengths', () => {
  const g = buildChartGeometry([0, 10, -4, 6], 300, 100, {});
  let expected = 0;
  for (let i = 1; i < g.points.length; i++) {
    expected += Math.hypot(g.points[i].x - g.points[i - 1].x, g.points[i].y - g.points[i - 1].y);
  }
  assertAlmostEquals(g.lineLength, expected, 1e-9);
  assertEquals(g.lineLength > 0, true);
});

Deno.test('lineLength: a straight, flat run is its horizontal width', () => {
  const g = buildChartGeometry([1, 1, 1, 1], 300, 100, {});
  const first = g.points[0].x;
  const last = g.points[g.points.length - 1].x;
  assertAlmostEquals(g.lineLength, last - first, 1e-9);
});

// The partial line used by the H2 draw-in (JS frame loop; SVG dash props are
// ignored on device). Its drawn length must track the fraction exactly.
function polylineLength(d: string): number {
  const pts = [...d.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

Deno.test('partialLinePath: fraction 0 draws nothing', () => {
  const g = buildChartGeometry([0, 10, -4, 6], 300, 100, {});
  assertEquals(partialLinePath(g.points, 0, g.lineLength), '');
});

Deno.test('partialLinePath: fraction 1 is the full line, identical to linePath', () => {
  const g = buildChartGeometry([0, 10, -4, 6], 300, 100, {});
  assertEquals(partialLinePath(g.points, 1, g.lineLength), g.linePath);
});

Deno.test('partialLinePath: drawn length equals fraction x lineLength, mid-segment included', () => {
  const g = buildChartGeometry([0, 10, -4, 6, 2], 300, 100, {});
  for (const f of [0.1, 0.37, 0.5, 0.83]) {
    assertAlmostEquals(polylineLength(partialLinePath(g.points, f, g.lineLength)), f * g.lineLength, 0.05);
  }
});

