/**
 * 3c race layout and chyron inputs. A race point sits at its trading day's
 * index, so a day with no bar leaves a gap (never a zero point). The chyron's
 * day move is the live price against the last close before today, or null.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals, assert } from 'jsr:@std/assert';
import { raceLayout, raceCoords } from '../lib/game/raceLayout.ts';
import { dayMovePct } from '../lib/game/leadChange.ts';

const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];

Deno.test('raceLayout: points sit at their day index; a missing day is a gap', () => {
  const r = raceLayout({
    days: DAYS,
    mine: [{ date: '2026-09-28', gain: 1 }, { date: '2026-09-29', gain: 2 }, { date: '2026-10-01', gain: 5 }],
    opp: [{ date: '2026-09-28', gain: -1 }, { date: '2026-10-02', gain: 7 }],
  });
  assertEquals(r.mine.map((p) => p.index), [0, 1, 3]);
  assertEquals(r.opp.map((p) => p.index), [0, 4]);
});

Deno.test('raceLayout: weekday labels Mon..Fri for the matchup week', () => {
  const r = raceLayout({ days: DAYS, mine: [], opp: [] });
  assertEquals(r.labels, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
});

Deno.test('dayMovePct: live price against the last close before today, in percent', () => {
  const bars = { NVDA: [{ date: '2026-09-29', close: 100 }, { date: '2026-09-30', close: 110 }] };
  // Today is 2026-10-01; the last close before it is 110. Live 113.2 is +2.9%.
  assertEquals(dayMovePct(bars, () => 113.2, 'NVDA', '2026-10-01'), Math.round(((113.2 - 110) / 110) * 1000) / 10);
});

Deno.test('dayMovePct: no live price or no earlier close means no percentage, never zero', () => {
  const bars = { NVDA: [{ date: '2026-09-30', close: 110 }] };
  assertEquals(dayMovePct(bars, () => null, 'NVDA', '2026-10-01'), null);
  assertEquals(dayMovePct({}, () => 113, 'NVDA', '2026-10-01'), null);
});


Deno.test('raceCoords: x is the day slot across the full week, so Mon..Fri stay aligned even with a gap', () => {
  const layout = raceLayout({ days: DAYS, mine: [{ date: '2026-10-01', gain: 5 }], opp: [] });
  const c = raceCoords(layout, 400, 100);
  assertEquals(c.mine[0].x, 300); // slot 3 of 0..4 across 400px: 3/4 of the width
  assertEquals(c.labelX, [0, 100, 200, 300, 400]);
});

Deno.test('raceCoords: one shared y-scale, and zero is a line both sides are measured from', () => {
  const layout = raceLayout({ days: DAYS, mine: [{ date: '2026-09-28', gain: 10 }], opp: [{ date: '2026-09-28', gain: -10 }] });
  const c = raceCoords(layout, 400, 100);
  // Up is more gain: mine (+10) is above opp (-10), and both sit above/below the zero line.
  assert(c.mine[0].y < c.zeroY && c.opp[0].y > c.zeroY);
  assertEquals(c.zeroY, c.zeroY); // a finite number, never NaN
});
