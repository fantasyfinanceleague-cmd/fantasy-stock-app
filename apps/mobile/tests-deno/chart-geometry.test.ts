/**
 * Tests for lib/home/chartGeometry.ts — the Season card's chart math.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';
import { buildChartGeometry, nearestPointIndex } from '../lib/home/chartGeometry.ts';

Deno.test('a flat-zero series places the zero line at the bottom of the padded area (min=max=0 -> range defaults to 1, matching the board formula)', () => {
  const g = buildChartGeometry([0, 0, 0], 100, 100, { padTop: 0, padBottom: 0 });
  assertAlmostEquals(g.zeroY, 100, 1e-6);
});

Deno.test('an all-positive series keeps the zero line at the bottom of the padded area', () => {
  const g = buildChartGeometry([10, 20, 30], 100, 100, { padTop: 0, padBottom: 0 });
  // max=30, min=0 (0 is always included) -> zero maps to y=100 (bottom).
  assertAlmostEquals(g.zeroY, 100, 1e-6);
});

Deno.test('points are evenly spaced across the width, first at x=0 and last at x=width', () => {
  const g = buildChartGeometry([0, 5, 10, 5, 0], 200, 100);
  assertEquals(g.points.length, 5);
  assertAlmostEquals(g.points[0].x, 0, 1e-6);
  assertAlmostEquals(g.points[4].x, 200, 1e-6);
  assertAlmostEquals(g.points[2].x, 100, 1e-6);
});

Deno.test('a single-point series does not divide by zero and places the point at x=padLeft', () => {
  const g = buildChartGeometry([42], 200, 100, { padLeft: 5 });
  assertEquals(g.points.length, 1);
  assertAlmostEquals(g.points[0].x, 5, 1e-6);
});

Deno.test('the line path starts with M and every subsequent point uses L', () => {
  const g = buildChartGeometry([0, 10, -5], 100, 100);
  const commands = g.linePath.split(' ').map((seg) => seg[0]);
  assertEquals(commands, ['M', 'L', 'L']);
});

Deno.test('the area path closes back down to the zero line at both ends', () => {
  const g = buildChartGeometry([10, 20], 100, 100, { padTop: 0, padBottom: 0 });
  assertEquals(g.areaPath.endsWith('Z'), true);
  // Two "L...,<zeroY>" closing segments should be present.
  const zeroYStr = g.zeroY.toFixed(2);
  const closingSegments = g.areaPath.split(' ').filter((seg) => seg.includes(zeroYStr));
  assertEquals(closingSegments.length >= 2, true);
});

Deno.test('nearestPointIndex finds the closest x, including exact and off-grid queries', () => {
  const g = buildChartGeometry([0, 10, 20, 10, 0], 200, 100);
  assertEquals(nearestPointIndex(g.points, 0), 0);
  assertEquals(nearestPointIndex(g.points, 100), 2);
  assertEquals(nearestPointIndex(g.points, 60), 1); // closer to x=50 (i=1) than x=100 (i=2)
  assertEquals(nearestPointIndex(g.points, 200), 4);
});

Deno.test('nearestPointIndex on an empty series returns -1', () => {
  assertEquals(nearestPointIndex([], 50), -1);
});
