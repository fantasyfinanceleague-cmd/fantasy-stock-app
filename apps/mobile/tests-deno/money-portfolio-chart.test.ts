/**
 * lib/money/portfolioChart.ts — the Portfolio value line (W4, Game Night; Giorgio,
 * 2026-10-12: "the Portfolio chart with range pills: yes"). Pinned:
 *   - the season starts at the stake (every stock at its draft price);
 *   - each day's value is teamValue at that day's close, so the line's end IS the header;
 *   - a buy or sale moves money between stake/cash and holdings, never the line;
 *   - 1W lives on the Mon…Fri axis, starting at the last close before Monday;
 *   - 1M enters at the value on the window's first day.
 * Run: cd apps/mobile/tests-deno && deno test --allow-read --allow-env --allow-sys --allow-run .
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';
import { dailyValues, mondayOf, portfolioSeries, type ChartActivityRow } from '../lib/money/portfolioChart.ts';
import { standardWeekSessions } from '../lib/time/marketWeek.ts';

const STAKE = { stakeMode: 'budget_cap' as const, notionalPerSlot: null, numRounds: 2 };
// Drafted Mon Aug 31, 8:30 PM ET.
const DRAFT_AT = '2026-09-01T00:30:00.000Z';
const ROWS: ChartActivityRow[] = [
  { kind: 'draft', action: 'buy', symbol: 'NVDA', quantity: 1, price: 100, occurredAt: DRAFT_AT },
  { kind: 'draft', action: 'buy', symbol: 'AAPL', quantity: 1, price: 50, occurredAt: DRAFT_AT },
];
const BARS = {
  NVDA: [{ date: '2026-09-01', close: 110 }, { date: '2026-09-02', close: 120 }, { date: '2026-09-03', close: 90 }],
  AAPL: [{ date: '2026-09-01', close: 55 }, { date: '2026-09-02', close: 50 }, { date: '2026-09-03', close: 60 }],
};

Deno.test('the season starts at the stake, then each close prices the roster', () => {
  const d = dailyValues({ rows: ROWS, bars: BARS, stake: STAKE, todayEt: '2026-09-04' });
  assertEquals(d, [
    { date: '2026-08-31', value: 150 },
    { date: '2026-09-01', value: 165 },
    { date: '2026-09-02', value: 170 },
    { date: '2026-09-03', value: 150 },
  ]);
});

Deno.test('today is never a daily value: the live value is the line\'s last point (the header)', () => {
  const d = dailyValues({ rows: ROWS, bars: BARS, stake: STAKE, todayEt: '2026-09-03' });
  assertEquals(d.map((x) => x.date).includes('2026-09-03'), false);
  const s = portfolioSeries({ range: 'Season', daily: d, liveValue: 151.25, todayEt: '2026-09-03', now: new Date('2026-09-03T17:00:00Z'), sessions: [], draftAt: DRAFT_AT });
  assertEquals(s.points[s.points.length - 1], { t: 3, value: 151.25 });
  assertEquals(s.base, 150);
  assertEquals(s.axis, { kind: 'dated', start: '2026-08-31', end: '2026-09-03' });
});

Deno.test('a buy inside the budget does not move the line (money changes form, defect b)', () => {
  // Sep 2: buy one KO at $70 with budget headroom. The day's value is holdings only (no
  // negative cash), and KO is worth what was paid, so the value rises by exactly KO's $70…
  const rows = [...ROWS, { kind: 'trade' as const, action: 'buy' as const, symbol: 'KO', quantity: 1, price: 70, occurredAt: '2026-09-02T15:00:00Z' }];
  const bars = { ...BARS, KO: [{ date: '2026-09-02', close: 70 }, { date: '2026-09-03', close: 71 }] };
  const d = dailyValues({ rows, bars, stake: STAKE, todayEt: '2026-09-04' });
  assertEquals(d.find((x) => x.date === '2026-09-02')!.value, 170 + 70);
  // …and never dips below the roster's own worth, as negative cash would have made it.
  assertEquals(d.find((x) => x.date === '2026-09-03')!.value, 150 + 71);
});

Deno.test('a stock with no bar yet counts at cost, never $0', () => {
  const d = dailyValues({ rows: ROWS, bars: { NVDA: BARS.NVDA }, stake: STAKE, todayEt: '2026-09-04' });
  assertEquals(d.find((x) => x.date === '2026-09-02')!.value, 120 + 50);
});

Deno.test('1W: the Mon…Fri axis, from the last close before Monday', () => {
  // Week of Mon Sep 21; now Thu Sep 24, 1:37 PM ET.
  const daily = [
    { date: '2026-09-17', value: 1000 }, { date: '2026-09-18', value: 1010 },
    { date: '2026-09-21', value: 1020 }, { date: '2026-09-22', value: 1005 }, { date: '2026-09-23', value: 1030 },
  ];
  const now = new Date('2026-09-24T17:37:00Z');
  const s = portfolioSeries({ range: '1W', daily, liveValue: 1042, todayEt: '2026-09-24', now, sessions: standardWeekSessions('2026-09-24T16:00:00Z'), draftAt: null });
  assertEquals(s.axis, { kind: 'week' });
  assertEquals(s.base, 1010);
  assertEquals(s.points.slice(0, 4), [{ t: 0, value: 1010 }, { t: 1, value: 1020 }, { t: 2, value: 1005 }, { t: 3, value: 1030 }]);
  const live = s.points[s.points.length - 1];
  assertEquals(live.value, 1042);
  assertAlmostEquals(live.t, 3 + (4 * 60 + 7) / 390, 1e-9);
});

Deno.test('1W after the close: today\'s session ends at its day\'s end with the live value', () => {
  const daily = [{ date: '2026-09-18', value: 1010 }];
  const s = portfolioSeries({ range: '1W', daily, liveValue: 1001, todayEt: '2026-09-21', now: new Date('2026-09-21T21:00:00Z'), sessions: standardWeekSessions('2026-09-21T16:00:00Z'), draftAt: null });
  assertEquals(s.points, [{ t: 0, value: 1010 }, { t: 1, value: 1001 }]);
});

Deno.test('1M: the line enters at the value on the window\'s first day', () => {
  const daily = [{ date: '2026-08-31', value: 150 }, { date: '2026-09-10', value: 160 }, { date: '2026-10-05', value: 170 }];
  const s = portfolioSeries({ range: '1M', daily, liveValue: 175, todayEt: '2026-10-13', now: new Date('2026-10-13T17:00:00Z'), sessions: [], draftAt: DRAFT_AT });
  assertEquals(s.axis, { kind: 'dated', start: '2026-09-13', end: '2026-10-13' });
  assertEquals(s.points, [{ t: 0, value: 160 }, { t: 22, value: 170 }, { t: 30, value: 175 }]);
  assertEquals(s.base, 160);
});

Deno.test('a season drafted today is one point: the stake, on its full axis', () => {
  const s = portfolioSeries({ range: 'Season', daily: [{ date: '2026-10-13', value: 150 }], liveValue: 150, todayEt: '2026-10-13', now: new Date(), sessions: [], draftAt: null });
  assertEquals(s.points, [{ t: 0, value: 150 }]);
});

Deno.test('mondayOf: weekdays to their Monday; the weekend belongs to the week just ended', () => {
  assertEquals(mondayOf('2026-09-24'), '2026-09-21');
  assertEquals(mondayOf('2026-09-21'), '2026-09-21');
  assertEquals(mondayOf('2026-09-26'), '2026-09-21');
  assertEquals(mondayOf('2026-09-27'), '2026-09-21');
});

// ── The stock sheet's line (stockChartSeries.stockLineSeries, W4) ─────────────────────────
import { stockLineSeries } from '../lib/money/stockChartSeries.ts';

const STOCK_BARS = [
  { date: '2026-08-24', close: 90 }, { date: '2026-09-18', close: 100 },
  { date: '2026-09-21', close: 102 }, { date: '2026-09-22', close: 99 }, { date: '2026-09-23', close: 104 },
];

Deno.test('stock 1W: the Mon…Fri axis from Friday\'s close, the live price where the session is', () => {
  const now = new Date('2026-09-24T17:37:00Z');
  const s = stockLineSeries({ range: '1W', bars: STOCK_BARS, price: 106, todayEt: '2026-09-24', now, sessions: standardWeekSessions('2026-09-24T16:00:00Z') });
  assertEquals(s.axis, { kind: 'week' });
  assertEquals(s.base, 100);
  assertEquals(s.points.slice(0, 4), [{ t: 0, value: 100 }, { t: 1, value: 102 }, { t: 2, value: 99 }, { t: 3, value: 104 }]);
  assertEquals(s.points[4].value, 106);
});

Deno.test('stock 1M: a dated axis from the window\'s first close to today, the live price last', () => {
  const s = stockLineSeries({ range: '1M', bars: STOCK_BARS, price: 106, todayEt: '2026-09-24', now: new Date('2026-09-24T17:37:00Z'), sessions: [] });
  assertEquals(s.axis, { kind: 'dated', start: '2026-08-24', end: '2026-09-24', months: false });
  assertEquals(s.base, 90);
  assertEquals(s.points[s.points.length - 1], { t: 31, value: 106 });
});

Deno.test('stock 1Y: month labels; no price: the line stops at the last close (never a $0 point)', () => {
  const s = stockLineSeries({ range: '1Y', bars: STOCK_BARS, price: null, todayEt: '2026-09-24', now: new Date('2026-09-24T17:37:00Z'), sessions: [] });
  assertEquals(s.axis.kind === 'dated' && s.axis.months, true);
  assertEquals(s.points[s.points.length - 1].value, 104);
});

Deno.test('stock 1W after today\'s close (no bar yet): the session ends at its day\'s end on the price', () => {
  const now = new Date('2026-09-25T00:00:00Z'); // Thu 8 PM ET
  const s = stockLineSeries({ range: '1W', bars: STOCK_BARS, price: 106, todayEt: '2026-09-24', now, sessions: standardWeekSessions('2026-09-24T16:00:00Z') });
  assertEquals(s.points[s.points.length - 1], { t: 4, value: 106 });
});
