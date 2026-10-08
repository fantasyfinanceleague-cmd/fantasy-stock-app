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
  referenceLine,
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

// Design Lead ruling, 2026-10-06: the reference line is the range's FIRST close, not
// the previous close; "A week ago $X" etc., unless the history itself starts later
// than the range (a newly listed stock), which gets its own date instead.
const FULL_HISTORY: DailyBar[] = [
  { date: '2025-10-01', close: 90 },
  { date: '2026-09-01', close: 100 },
  { date: '2026-09-20', close: 110 },
  { date: '2026-10-01', close: 120 },
  { date: '2026-10-05', close: 130 },
];

Deno.test('referenceLine: full history, 1W names the period, baseline is the first bar in range', () => {
  const r = referenceLine(FULL_HISTORY, '1W', NOW);
  assertEquals(r, { baseline: 120, text: 'A week ago $120.00' });
});

Deno.test('referenceLine: one label per range, all four periods', () => {
  assertEquals(referenceLine(FULL_HISTORY, '1M', NOW)?.text, 'A month ago $110.00');
  assertEquals(referenceLine(FULL_HISTORY, '3M', NOW)?.text, '3 months ago $100.00');
  // 2025-10-01 falls OUTSIDE 1Y's own 366-day window from 2026-10-05, so 1Y's baseline
  // is the earliest bar actually inside it (2026-09-01), not the full history's first bar.
  assertEquals(referenceLine(FULL_HISTORY, '1Y', NOW)?.text, 'A year ago $100.00');
});

Deno.test('referenceLine: short history (a newly listed stock) names the bar\'s own date, never the range', () => {
  // The whole history starts 2026-09-20: inside 1W's 7-day window (full coverage there),
  // but later than 1Y's ~366-day cutoff (short history for 1Y).
  const shortHistory: DailyBar[] = [
    { date: '2026-09-20', close: 105 },
    { date: '2026-10-01', close: 120 },
    { date: '2026-10-05', close: 130 },
  ];
  assertEquals(referenceLine(shortHistory, '1Y', NOW), { baseline: 105, text: 'Sep 20 close $105.00' });
  // Not the short-history case for 1W: there IS a bar before its cutoff, so "A week ago" stands.
  assertEquals(referenceLine(shortHistory, '1W', NOW)?.text, 'A week ago $120.00');
});

Deno.test('referenceLine: no bars in range at all returns null', () => {
  assertEquals(referenceLine([], '1W', NOW), null);
});

Deno.test('stockScrubLabel: date, price, and the change vs the range baseline, signed', () => {
  const label = stockScrubLabel({ date: '2026-10-01', close: 306.68 }, 301.85, false, NOW);
  assertEquals(label.primary, 'Thu, Oct 1');
  assertEquals(label.price, '$306.68');
  assertEquals(label.money, '+$4.83');
  assertEquals(label.percent, '+1.60%');
  assertEquals(label.gain, true);
});

Deno.test('stockScrubLabel: a loss is signed negative and gain is false', () => {
  const label = stockScrubLabel({ date: '2026-10-01', close: 95 }, 100, false, NOW);
  assertEquals(label.money.startsWith('−'), true); // the shared formatter's minus sign
  assertEquals(label.percent, '−5.00%');
  assertEquals(label.gain, false);
});

Deno.test('stockScrubLabel: the latest point in the range reads "Today", not its date', () => {
  const label = stockScrubLabel({ date: '2026-10-05', close: 130 }, 120, true, NOW);
  assertEquals(label.primary, 'Today');
});

Deno.test('stockScrubLabel: no year for a bar from the current year', () => {
  assertEquals(stockScrubLabel({ date: '2026-10-01', close: 1 }, 1, false, NOW).primary, 'Thu, Oct 1');
});

Deno.test('stockScrubLabel: a year shown, no weekday, for a bar from a different year', () => {
  assertEquals(stockScrubLabel({ date: '2025-10-01', close: 1 }, 1, false, NOW).primary, 'Oct 1, 2025');
});

Deno.test('stockScrubLabel: an unparsable date falls back to the raw string', () => {
  assertEquals(stockScrubLabel({ date: 'not-a-date', close: 10 }, 10, false, NOW).primary, 'not-a-date');
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
