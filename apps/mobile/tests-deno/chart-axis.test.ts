/**
 * The Game Night chart's X axis + line (§9C "The X axis" and rule 6; Design Lead ruling
 * 2026-10-12 on Giorgio's "a real X axis with dates", this-week charts "Mon…Fri").
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  axisDomain, axisRangeLabel, dayOffset, estimateLabelWidth, formatAxisDate, labelsOverlap, layoutAxis, pointName,
  WEEK_DOMAIN, type AxisLabel, type AxisSpec,
} from '../components/sp/logic/chartAxis.ts';
import { buildLine, lineTone } from '../components/sp/logic/lineChart.ts';

const W = 390; // an iPhone's width: the chart runs edge to edge
const lin = (spec: AxisSpec, width = W) => {
  const [a, b] = axisDomain(spec);
  return (t: number) => (b > a ? ((t - a) / (b - a)) * width : 0);
};
const texts = (ls: AxisLabel[]) => ls.map((l) => l.text);
const inPlot = (ls: AxisLabel[], width = W) => ls.every((l) => l.left >= 0 && l.left + l.width <= width + 0.001);

// ── week ──────────────────────────────────────────────────────────────────────────

Deno.test('week: Mon · Tue · Wed · Thu · Fri under each day\'s slot, the whole week even mid-week', () => {
  const spec: AxisSpec = { kind: 'week' };
  assertEquals(axisDomain(spec), [0, 5]);
  const ls = layoutAxis(spec, W, lin(spec));
  assertEquals(texts(ls), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  // Each label is centred in its fifth of the week.
  ls.forEach((l, i) => assertEquals(Math.round(l.x), Math.round(((i + 0.5) / 5) * W)));
  assert(inPlot(ls));
  assert(!labelsOverlap(ls));
});

Deno.test('week: at Accessibility XL the interior days drop first (Mon·Wed·Fri, then Mon·Fri)', () => {
  const spec: AxisSpec = { kind: 'week' };
  const at = (scale: number, width = W) => texts(layoutAxis(spec, width, lin(spec, width), (s) => estimateLabelWidth(s, scale)));
  assertEquals(at(3.1), ['Mon', 'Wed', 'Fri']);
  assertEquals(at(3.1, 220), ['Mon', 'Fri']);
  assertEquals(at(6, 160), ['Fri']); // last resort: one label, where the week ends
});

Deno.test('week: pointName names the trading day a position falls in (a close belongs to its day)', () => {
  const spec: AxisSpec = { kind: 'week' };
  assertEquals(pointName(spec, 0), 'Mon'); // Monday's open
  assertEquals(pointName(spec, 1), 'Mon'); // Monday's close
  assertEquals(pointName(spec, 1.4), 'Tue');
  assertEquals(pointName(spec, 3), 'Wed');
  assertEquals(pointName(spec, 5), 'Fri');
  assertEquals(axisRangeLabel(spec, 3.6), 'from Mon to Thu');
  assertEquals(axisRangeLabel(spec, 0), 'Mon');
  assertEquals(axisRangeLabel(spec), 'from Mon to Fri');
});

// ── dated ─────────────────────────────────────────────────────────────────────────

Deno.test('dated: five evenly spaced dates, first at the start (left), last at now (right), "MMM d"', () => {
  const spec: AxisSpec = { kind: 'dated', start: '2026-09-29', end: '2026-10-09' };
  assertEquals(axisDomain(spec), [0, 10]);
  const ls = layoutAxis(spec, W, lin(spec));
  assertEquals(texts(ls), ['Sep 29', 'Oct 2', 'Oct 4', 'Oct 7', 'Oct 9']); // 2.5 days rounds to the 3rd
  assertEquals(ls[0].align, 'left');
  assertEquals(ls[0].left, 0);
  assertEquals(ls[ls.length - 1].align, 'right');
  assertEquals(ls[ls.length - 1].left + ls[ls.length - 1].width, W);
  assert(inPlot(ls));
  assert(!labelsOverlap(ls));
});

Deno.test('dated: XL with the longest month names drops interior labels, never the ends, never overlaps', () => {
  const spec: AxisSpec = { kind: 'dated', start: '2026-09-28', end: '2026-12-31' };
  for (const scale of [1, 1.35, 2, 3.1]) {
    const ls = layoutAxis(spec, W, lin(spec), (s) => estimateLabelWidth(s, scale));
    assert(!labelsOverlap(ls), `overlap at ${scale}`);
    assert(inPlot(ls), `leaves the plot at ${scale}`);
    assert(ls.length >= 2, `${scale}: kept both ends`);
    assertEquals(ls[0].text, 'Sep 28');
    assertEquals(ls[ls.length - 1].text, 'Dec 31');
    assert(ls.length <= 5);
  }
  const xl = layoutAxis(spec, W, lin(spec), (s) => estimateLabelWidth(s, 3.1));
  assert(xl.length < 5, 'XL dropped something');
});

Deno.test('dated: 3–5 labels; dates that round to the same day collapse rather than repeat', () => {
  const short: AxisSpec = { kind: 'dated', start: '2026-10-05', end: '2026-10-07' };
  const ls = layoutAxis(short, W, lin(short));
  assertEquals(texts(ls), ['Oct 5', 'Oct 6', 'Oct 7']);
  const two: AxisSpec = { kind: 'dated', start: '2026-10-05', end: '2026-10-06' };
  assertEquals(texts(layoutAxis(two, W, lin(two))), ['Oct 5', 'Oct 6']);
});

Deno.test('dated: 1Y uses months', () => {
  const spec: AxisSpec = { kind: 'dated', start: '2025-10-09', end: '2026-10-09', months: true };
  const ls = layoutAxis(spec, W, lin(spec));
  assertEquals(texts(ls), ['Oct', 'Jan', 'Apr', 'Jul', 'Oct']);
  assertEquals(ls[0].text, 'Oct');
  assertEquals(ls[ls.length - 1].text, 'Oct');
  assert(ls.every((l) => /^[A-Z][a-z]{2}$/.test(l.text)));
});

Deno.test('dated: maxLabels 2 (Home: the start under the first mark, today at the live end)', () => {
  const spec: AxisSpec = { kind: 'dated', start: '2026-09-29', end: '2026-11-06', maxLabels: 2 };
  assertEquals(texts(layoutAxis(spec, W, lin(spec))), ['Sep 29', 'Nov 6']);
});

Deno.test('dated: a single day (0/1 point) still draws its axis — one label, at the start', () => {
  const spec: AxisSpec = { kind: 'dated', start: '2026-10-12', end: '2026-10-12' };
  assertEquals(axisDomain(spec), [0, 0]);
  const ls = layoutAxis(spec, W, lin(spec));
  assertEquals(texts(ls), ['Oct 12']);
  assertEquals(ls[0].left, 0);
  assertEquals(axisRangeLabel(spec), 'Oct 12');
});

Deno.test('dated: names and offsets', () => {
  assertEquals(formatAxisDate('2026-09-29'), 'Sep 29');
  assertEquals(formatAxisDate('2026-01-03', true), 'Jan');
  assertEquals(dayOffset('2026-09-29', '2026-10-09'), 10);
  assertEquals(dayOffset('2026-03-07', '2026-03-09'), 2); // across the DST change: calendar days, no zone
  const spec: AxisSpec = { kind: 'dated', start: '2026-09-29', end: '2026-10-09' };
  assertEquals(pointName(spec, 8), 'Oct 7');
  assertEquals(axisRangeLabel(spec), 'from Sep 29 to Oct 9');
});

// ── the line ──────────────────────────────────────────────────────────────────────

const BOX = { width: W, height: 120, padLeft: 0, padRight: 12, padTop: 12, padBottom: 12 };

Deno.test('line: a week line stops at now — Thursday ends 4/5 of the way, Friday stays empty', () => {
  const pts = [{ t: 0, value: 100 }, { t: 1, value: 101 }, { t: 2, value: 99 }, { t: 3, value: 103 }, { t: 3.6, value: 104 }];
  const g = buildLine(pts, WEEK_DOMAIN, 100, BOX);
  const innerW = W - 12;
  assertEquals(g.end!.x, (3.6 / 5) * innerW);
  assert(g.end!.x < innerW, 'the line does not reach Friday');
  assert(g.path.startsWith('M0.00,'));
  assert(g.length > 0);
});

Deno.test('line: the base line sits at the base value; points above it are above it', () => {
  const g = buildLine([{ t: 0, value: 100 }, { t: 5, value: 110 }], WEEK_DOMAIN, 100, BOX);
  assertEquals(g.points[0].y, g.baseY);
  assert(g.points[1].y < g.baseY);
});

Deno.test('line: 0 points — the base line only (no path, no dot); 1 point — the dot alone', () => {
  const none = buildLine([], WEEK_DOMAIN, 0, BOX);
  assertEquals(none.path, '');
  assertEquals(none.end, null);
  assert(Number.isFinite(none.baseY));
  const one = buildLine([{ t: 0, value: 0 }], WEEK_DOMAIN, 0, BOX); // Monday morning: a dot at the open
  assertEquals(one.path, '');
  assertEquals(one.end, { x: 0, y: one.baseY });
});

Deno.test('line: a flat window draws mid-height, not on the floor', () => {
  const g = buildLine([{ t: 0, value: 5 }, { t: 2, value: 5 }], WEEK_DOMAIN, 5, BOX);
  assertEquals(g.baseY, 12 + (120 - 24) / 2);
});

Deno.test('line: tone by the window\'s sign — gain, loss, and flat is zero (never green or red)', () => {
  assertEquals(lineTone([{ t: 0, value: 1 }, { t: 1, value: 3 }], 1), 'gain');
  assertEquals(lineTone([{ t: 0, value: 1 }, { t: 1, value: 0.5 }], 1), 'loss');
  assertEquals(lineTone([{ t: 0, value: 1 }, { t: 1, value: 1 }], 1), 'zero');
  assertEquals(lineTone([], 1), 'zero');
});
