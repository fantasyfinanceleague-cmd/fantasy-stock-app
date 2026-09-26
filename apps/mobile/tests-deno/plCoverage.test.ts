/**
 * Hermetic unit tests for lib/plCoverage.ts — the one rule every P/L surface
 * uses for a holding that has no price. No RN, no network — run:
 *
 *   cd apps/mobile/tests-deno && deno test .
 *
 * The bug these pin: the Home hero showed "$8,124.33" next to
 * "+$361.04 · +29.29%". The value covered all 20 holdings; the gain and percent
 * came from the chart's last point, which silently dropped every holding
 * without a historical bar from BOTH value and basis — 13 of 18, leaving a
 * $1,232.64 basis. The verdict's scope (whole portfolio) did not match the
 * evidence's scope (a subset). Rule now: an unpriced holding is counted AT
 * COST and COUNTED, so value − cost = gain always reconciles and the count
 * says exactly what was assumed.
 */
import { assertAlmostEquals, assertEquals } from 'jsr:@std/assert';
import {
  summarizeHoldings,
  buildPLSeries,
  decideHeroPL,
  unpricedNote,
  MAX_PRICE_CARRY_DAYS,
  type HoldingsSummary,
  type PeriodPL,
  type PositionEvent,
} from '../lib/plCoverage.ts';

const priceMap = (m: Record<string, number>) => (s: string) => m[s] ?? null;

function assertReconciles(s: HoldingsSummary) {
  assertAlmostEquals(s.value - s.cost, s.gainLoss, 1e-9);
  if (s.cost > 0) assertAlmostEquals((s.gainLoss / s.cost) * 100, s.gainLossPercent, 1e-9);
}

// ---------------------------------------------------------------------------
// summarizeHoldings
// ---------------------------------------------------------------------------

Deno.test('summarizeHoldings: one priced + one unpriced — unpriced counted at cost and counted', () => {
  const s = summarizeHoldings(
    [
      { symbol: 'AAPL', quantity: 1, totalCost: 150 },
      { symbol: 'MSFT', quantity: 1, totalCost: 400 },
    ],
    priceMap({ AAPL: 341.02 }),
  );
  assertAlmostEquals(s.value, 341.02 + 400, 1e-9);
  assertEquals(s.cost, 550);
  assertAlmostEquals(s.gainLoss, 191.02, 1e-9);
  assertEquals(s.pricedCount, 1);
  assertEquals(s.unpricedCount, 1);
  assertReconciles(s);
});

Deno.test('summarizeHoldings: cold load (no prices yet) reads flat, NOT -100%', () => {
  // Old useHomeData rule: unpriced → value 0 at full cost → {value 0, −100%}.
  const s = summarizeHoldings(
    [
      { symbol: 'AAPL', quantity: 1, totalCost: 150 },
      { symbol: 'MSFT', quantity: 2, totalCost: 800 },
    ],
    () => null,
  );
  assertEquals(s.value, 950);
  assertEquals(s.cost, 950);
  assertEquals(s.gainLoss, 0);
  assertEquals(s.gainLossPercent, 0);
  assertEquals(s.pricedCount, 0);
  assertEquals(s.unpricedCount, 2);
});

Deno.test('summarizeHoldings: zero / NaN / negative prices are unpriced, not a -100% loss', () => {
  const s = summarizeHoldings(
    [
      { symbol: 'A', quantity: 1, totalCost: 10 },
      { symbol: 'B', quantity: 1, totalCost: 10 },
      { symbol: 'C', quantity: 1, totalCost: 10 },
    ],
    priceMap({ A: 0, B: NaN, C: -5 }),
  );
  assertEquals(s.unpricedCount, 3);
  assertEquals(s.gainLoss, 0);
});

Deno.test('summarizeHoldings: closed positions (quantity <= 0) are ignored; empty is all zeros', () => {
  const s = summarizeHoldings([{ symbol: 'PLTR', quantity: 0, totalCost: 0 }], priceMap({ PLTR: 100 }));
  assertEquals(s, { value: 0, cost: 0, gainLoss: 0, gainLossPercent: 0, pricedCount: 0, unpricedCount: 0 });
});

Deno.test('summarizeHoldings: regression — the real 20-holding account reconciles to +$612.13 / +8.15%', () => {
  // Per-league holdings and live quotes as logged from the populated test
  // account on 2026-09-26 (NVTS appears in two leagues as two holdings).
  const holdings = [
    ['AAL', 1, 16.77, 13.87], ['BA', 1, 47.51, 198.09], ['INTC', 1, 43.16, 123], ['GRAB', 1, 4.23, 3.14],
    ['JPM', 2.916472, 1000, 342.88], ['AMZN', 4.005929, 1000, 249.63],
    ['NVTS', 74.822297, 1000.37, 12.19],
    ['BAC', 17.646021, 1000, 56.67], ['NVTS', 82.034454, 1000, 12.19], ['LOW', 5.284854, 1000, 189.22],
    ['IONQ', 1, 43.42, 45.4],
    ['AAPL', 1, 150, 341.02], ['MSFT', 1, 400, 516.155],
    ['NFLX', 1, 98.62, 71.14], ['PSKY', 1, 13.41, 9.96], ['DE', 1, 475.43, 690.08],
    ['H', 1, 161.08, 158.405], ['AI', 1, 18.36, 10.67], ['CMG', 1, 39.84, 31.32],
  ] as const;
  const prices: Record<string, number> = {};
  for (const [sym, , , px] of holdings) prices[sym] = px;
  const s = summarizeHoldings(
    holdings.map(([symbol, quantity, totalCost]) => ({ symbol, quantity, totalCost })),
    priceMap(prices),
  );
  assertAlmostEquals(s.value, 8124.33, 0.01);
  assertAlmostEquals(s.cost, 7512.20, 0.01);
  assertAlmostEquals(s.gainLoss, 612.13, 0.01);
  assertAlmostEquals(s.gainLossPercent, 8.15, 0.01);
  assertEquals(s.unpricedCount, 0);
  assertReconciles(s);
});

// ---------------------------------------------------------------------------
// buildPLSeries
// ---------------------------------------------------------------------------

const buy = (date: string, symbol: string, quantity: number, cost: number): PositionEvent =>
  ({ date, symbol, quantity, cost });
const sell = (date: string, symbol: string, quantity: number): PositionEvent =>
  ({ date, symbol, quantity: -quantity, cost: 0 });

Deno.test('buildPLSeries: holding without a bar is counted at cost, not dropped from value AND basis', () => {
  const series = buildPLSeries(
    [buy('2026-09-21', 'AAPL', 1, 150), buy('2026-09-21', 'MSFT', 1, 400)],
    { '2026-09-21': { AAPL: 341.02 } },
  );
  assertEquals(series.length, 1);
  const p = series[0];
  assertAlmostEquals(p.value, 741.02, 1e-9);
  assertEquals(p.cost, 550); // the old loop reported 150 here
  assertAlmostEquals(p.pl, 191.02, 1e-9);
  assertEquals(p.unpricedCount, 1);
});

Deno.test('buildPLSeries: a draft dated after the last bar still enters the series (BAC case)', () => {
  // Bars end Fri 2026-09-25; BAC/LOW drafted 2026-09-26 (UTC). The old loop
  // only walked bar dates, so those events were never applied.
  const series = buildPLSeries(
    [
      buy('2026-09-24', 'AAPL', 1, 150),
      buy('2026-09-26', 'BAC', 17.646021, 1000),
      buy('2026-09-26', 'LOW', 5.284854, 1000),
    ],
    {
      '2026-09-24': { AAPL: 340, BAC: 56 },
      '2026-09-25': { AAPL: 341.02, BAC: 56.67 },
    },
  );
  const last = series[series.length - 1];
  assertEquals(last.date, '2026-09-26');
  assertAlmostEquals(last.cost, 2150, 1e-9);
  // BAC priced from Friday's carried close; LOW has no bars → at cost, counted.
  assertAlmostEquals(last.value, 341.02 + 17.646021 * 56.67 + 1000, 1e-6);
  assertEquals(last.unpricedCount, 1);
});

Deno.test('buildPLSeries: Fri → Mon carry-forward stays priced (weekend gap)', () => {
  const series = buildPLSeries(
    [buy('2026-09-18', 'AAPL', 1, 150), buy('2026-09-21', 'MSFT', 1, 400)],
    { '2026-09-18': { AAPL: 200 }, '2026-09-21': { MSFT: 410 } },
  );
  const mon = series.find(p => p.date === '2026-09-21')!;
  assertEquals(mon.unpricedCount, 0);
  assertAlmostEquals(mon.value, 200 + 410, 1e-9);
});

Deno.test(`buildPLSeries: carry of exactly ${MAX_PRICE_CARRY_DAYS} days is priced; one more is unpriced`, () => {
  const series = buildPLSeries(
    [buy('2026-09-01', 'A', 1, 10), buy('2026-09-01', 'B', 1, 10)],
    {
      '2026-09-01': { A: 20, B: 20 },
      '2026-09-08': { B: 21 }, // A last priced 7 days ago → still priced
      '2026-09-09': { B: 22 }, // A last priced 8 days ago → unpriced
    },
  );
  const d8 = series.find(p => p.date === '2026-09-08')!;
  const d9 = series.find(p => p.date === '2026-09-09')!;
  assertEquals(d8.unpricedCount, 0);
  assertAlmostEquals(d8.value, 20 + 21, 1e-9);
  assertEquals(d9.unpricedCount, 1);
  assertAlmostEquals(d9.value, 10 + 22, 1e-9); // A back to cost, not $20 forever
});

Deno.test('buildPLSeries: stale price from a truncated series is not carried for months (BA case)', () => {
  // historical-bars truncated BA at 2026-01-05 ($228.12); the old loop carried
  // that close to 2026-09-25 while BA traded near $198.
  const series = buildPLSeries(
    [buy('2025-12-12', 'BA', 1, 47.51), buy('2025-12-12', 'AAPL', 1, 150)],
    { '2026-01-05': { BA: 228.12, AAPL: 250 }, '2026-09-25': { AAPL: 341.02 } },
  );
  const last = series[series.length - 1];
  assertEquals(last.date, '2026-09-25');
  assertEquals(last.unpricedCount, 1);
  assertAlmostEquals(last.value, 47.51 + 341.02, 1e-9);
});

Deno.test('buildPLSeries: partial sell keeps average cost; selling to zero removes the position', () => {
  const series = buildPLSeries(
    [
      buy('2026-09-21', 'A', 4, 400),
      sell('2026-09-22', 'A', 1),
      buy('2026-09-22', 'B', 1, 50),
      sell('2026-09-23', 'A', 3),
    ],
    {
      '2026-09-21': { A: 110, B: 50 },
      '2026-09-22': { A: 120, B: 55 },
      '2026-09-23': { A: 130, B: 60 },
    },
  );
  const d22 = series.find(p => p.date === '2026-09-22')!;
  assertEquals(d22.cost, 300 + 50);
  assertAlmostEquals(d22.value, 3 * 120 + 55, 1e-9);
  const d23 = series.find(p => p.date === '2026-09-23')!;
  assertEquals(d23.cost, 50);
  assertEquals(d23.value, 60);
});

Deno.test('buildPLSeries: no bars at all yields no series (no shape to draw)', () => {
  assertEquals(buildPLSeries([buy('2026-09-21', 'A', 1, 10)], {}), []);
});

// ---------------------------------------------------------------------------
// decideHeroPL / unpricedNote
// ---------------------------------------------------------------------------

const summary = (over: Partial<HoldingsSummary> = {}): HoldingsSummary => ({
  value: 8124.33, cost: 7512.2, gainLoss: 612.13, gainLossPercent: 8.148, pricedCount: 20, unpricedCount: 0, ...over,
});
const period = (over: Partial<PeriodPL>): PeriodPL => ({
  gainLoss: 0, gainLossPercent: 0, isPositive: true, period: 'All', complete: true, ...over,
});

Deno.test('decideHeroPL: regression — All never pairs the full value with a chart-subset gain', () => {
  // The reported screen: chart said +361.04 / +29.29% over a 1,232.64 basis.
  const hero = decideHeroPL(summary(), period({ period: 'All', gainLoss: 361.04, gainLossPercent: 29.29, complete: false }));
  assertEquals(hero.gainLoss, 612.13);
  assertEquals(hero.gainLossPercent, 8.148);
  assertEquals(hero.notes, []);
});

Deno.test('decideHeroPL: Season also reads the live whole-portfolio summary', () => {
  const hero = decideHeroPL(summary(), period({ period: 'Season', gainLoss: 1, gainLossPercent: 1 }));
  assertEquals(hero.gainLoss, 612.13);
});

Deno.test('decideHeroPL: 1W with complete endpoints uses the chart delta', () => {
  const hero = decideHeroPL(summary(), period({ period: '1W', gainLoss: -42.5, gainLossPercent: -0.52, isPositive: false }));
  assertEquals(hero.gainLoss, -42.5);
  assertEquals(hero.isPositive, false);
  assertEquals(hero.notes, []);
});

Deno.test('decideHeroPL: 1M with a partial endpoint falls back to all-time and says so', () => {
  const hero = decideHeroPL(summary(), period({ period: '1M', gainLoss: 5, gainLossPercent: 40, complete: false }));
  assertEquals(hero.gainLoss, 612.13);
  assertEquals(hero.notes.length, 1);
  assertEquals(hero.notes, ['Not enough 1M price history yet, showing all time']);
});

Deno.test('decideHeroPL: no chart yet → summary', () => {
  assertEquals(decideHeroPL(summary(), null).gainLoss, 612.13);
});

Deno.test('decideHeroPL: unpriced holdings add the at-cost note (singular and plural)', () => {
  assertEquals(decideHeroPL(summary({ unpricedCount: 1 }), null).notes, ['1 holding counted at cost (no live price yet)']);
  assertEquals(unpricedNote(3), '3 holdings counted at cost (no live price yet)');
  assertEquals(unpricedNote(0), null);
});
