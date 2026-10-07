/**
 * Hermetic tests for lib/money/stockChartSeries.ts (3e, M2 live chart).
 * Giorgio's chart-ranges ruling (A): 1W/1M/3M/1Y, 1W default, NO 1D.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  barsForRange,
  CHART_RANGES,
  DEFAULT_CHART_RANGE,
  deltaSeries,
  rangeLookbackDays,
  stockScrubLabel,
  type DailyBar,
} from '../lib/money/stockChartSeries.ts';

Deno.test("Giorgio's ruling (A): the ranges are 1W/1M/3M/1Y in that order, default 1W, no 1D", () => {
  assertEquals(CHART_RANGES, ['1W', '1M', '3M', '1Y']);
  assertEquals(DEFAULT_CHART_RANGE, '1W');
  assertEquals(CHART_RANGES.includes('1D' as never), false);
});

Deno.test('rangeLookbackDays: a calendar-day window per range', () => {
  assertEquals(rangeLookbackDays('1W'), 7);
  assertEquals(rangeLookbackDays('1M'), 31);
  assertEquals(rangeLookbackDays('3M'), 93);
  assertEquals(rangeLookbackDays('1Y'), 366);
});

const BARS: DailyBar[] = [
  { date: '2026-09-01', close: 100 },
  { date: '2026-09-20', close: 110 },
  { date: '2026-10-01', close: 120 },
  { date: '2026-10-05', close: 130 },
];
const NOW = new Date('2026-10-05T20:00:00Z');

Deno.test('barsForRange: 1W keeps only bars within 7 days, oldest first', () => {
  const r = barsForRange(BARS, '1W', NOW);
  assertEquals(r.map((b) => b.date), ['2026-10-01', '2026-10-05']);
});

Deno.test('barsForRange: 1M keeps the whole month window', () => {
  const r = barsForRange(BARS, '1M', NOW);
  assertEquals(r.map((b) => b.date), ['2026-09-20', '2026-10-01', '2026-10-05']);
});

Deno.test('barsForRange: never invents a bar for a day with no row (real bars only)', () => {
  const r = barsForRange(BARS, '1Y', NOW);
  assertEquals(r.length, BARS.length);
  for (const b of r) assertEquals(BARS.some((raw) => raw.date === b.date && raw.close === b.close), true);
});

Deno.test('barsForRange: a bar outside the window, even by one day, is excluded', () => {
  const bars: DailyBar[] = [{ date: '2026-09-27', close: 90 }, { date: '2026-09-28', close: 91 }];
  // NOW - 7 days = 2026-09-28T20:00Z -> cutoff date string 2026-09-28.
  const r = barsForRange(bars, '1W', NOW);
  assertEquals(r.map((b) => b.date), ['2026-09-28']);
});

Deno.test('deltaSeries: each close relative to the baseline (previous close)', () => {
  assertEquals(deltaSeries(BARS, 115), [-15, -5, 5, 15]);
});

Deno.test('deltaSeries: an empty series stays empty', () => {
  assertEquals(deltaSeries([], 100), []);
});

Deno.test('stockScrubLabel: a readable date and the bar\'s own price, never a delta', () => {
  const label = stockScrubLabel({ date: '2026-10-05', close: 353.85 });
  assertEquals(label.primary, 'Mon, Oct 5');
  assertEquals(label.money, '$353.85');
});

Deno.test('stockScrubLabel: an unparsable date falls back to the raw string', () => {
  const label = stockScrubLabel({ date: 'not-a-date', close: 10 });
  assertEquals(label.primary, 'not-a-date');
});

// Fixture seam (lib/money/stressFixture.ts stressChartBars): 3e's chart data,
// offline. Deterministic and weekend-free, same shape as a real bars response.
Deno.test('stressChartBars: 400 weekday-only bars, oldest first, ending before now', async () => {
  const { stressChartBars } = await import('../lib/money/stressFixture.ts');
  const now = new Date('2026-10-05T20:00:00Z'); // a Monday
  const bars = stressChartBars('S010', now);
  assertEquals(bars.length, 400);
  for (const b of bars) {
    const day = new Date(`${b.date}T00:00:00Z`).getUTCDay();
    assertEquals(day === 0 || day === 6, false, `weekend date ${b.date}`);
  }
  for (let i = 1; i < bars.length; i++) assertEquals(bars[i - 1].date < bars[i].date, true);
  assertEquals(bars[bars.length - 1].date < '2026-10-05', true);
});

Deno.test('stressChartBars: deterministic for the same symbol and now', async () => {
  const { stressChartBars } = await import('../lib/money/stressFixture.ts');
  const now = new Date('2026-10-05T20:00:00Z');
  assertEquals(stressChartBars('S010', now), stressChartBars('S010', now));
});

Deno.test('stressChartBars: an unknown symbol gets no bars, never guessed ones', async () => {
  const { stressChartBars } = await import('../lib/money/stressFixture.ts');
  assertEquals(stressChartBars('ZZZZ', new Date()), []);
});
