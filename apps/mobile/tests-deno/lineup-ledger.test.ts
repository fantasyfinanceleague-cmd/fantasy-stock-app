/**
 * 3c Matchup: the per-stock ledger. liveWeekScore reports each stock's
 * dollar contribution (bySymbol), and lineupRows turns those into displayed
 * cents that sum to the displayed score EXACTLY (largest-remainder rounding).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';
import { liveWeekScore } from '../lib/home/liveWeekScore.ts';
import { lineupRows, scoreCents } from '../lib/game/lineupLedger.ts';

Deno.test('liveWeekScore: bySymbol splits the gain per stock and sums to it', () => {
  const r = liveWeekScore(
    [
      { symbol: 'NVDA', quantity: 10, weekStartPrice: 100, enteredMidWeek: false },
      { symbol: 'AAPL', quantity: 5, weekStartPrice: 200, enteredMidWeek: false },
    ],
    [],
    (s) => ({ NVDA: 112.5, AAPL: 198 })[s] ?? null,
  );
  assertAlmostEquals(r.bySymbol.NVDA, 125, 1e-9);
  assertAlmostEquals(r.bySymbol.AAPL, -10, 1e-9);
  assertAlmostEquals(Object.values(r.bySymbol).reduce((a, b) => a + b, 0), r.gain, 1e-9);
});

Deno.test('liveWeekScore: an unpriced stock is absent from bySymbol, not zero-filled', () => {
  const r = liveWeekScore(
    [{ symbol: 'PLTR', quantity: 3, weekStartPrice: 50, enteredMidWeek: false }],
    [],
    () => null,
  );
  assertEquals(r.bySymbol.PLTR, undefined);
  assertEquals(r.unpriced, ['PLTR']);
});

Deno.test('liveWeekScore: a mid-week round trip is attributed to its symbol', () => {
  const r = liveWeekScore(
    [],
    [
      { symbol: 'KO', action: 'buy', quantity: 2, price: 70, createdAt: new Date('2026-09-22T15:00:00Z') },
      { symbol: 'KO', action: 'sell', quantity: 2, price: 75, createdAt: new Date('2026-09-23T15:00:00Z') },
    ],
    () => null,
  );
  assertAlmostEquals(r.bySymbol.KO, 10, 1e-9);
});

Deno.test('scoreCents: the displayed total is the gain rounded to whole cents', () => {
  assertEquals(scoreCents(213.6), 21360);
  assertEquals(scoreCents(-38.875), -3887); // Math.round ties toward +inf, as formatSignedCurrency does
});

Deno.test('lineupRows: the rows sum to the displayed score exactly, to the cent', () => {
  // Three stocks whose cents each carry a fraction; naive per-row rounding
  // would print a total one cent off the scoreboard.
  const by = { A: 0.335, B: 0.335, C: 0.33 }; // total 1.00
  const rows = lineupRows(by, 1.0);
  assertEquals(rows.reduce((s, r) => s + r.cents, 0), scoreCents(1.0));
});

Deno.test('lineupRows: holds across many fractional contributions and negative totals', () => {
  const by: Record<string, number> = {};
  for (let i = 0; i < 17; i++) by[`S${i}`] = (i % 2 ? -1 : 1) * (1.2345 + i * 0.7771);
  const gain = Object.values(by).reduce((a, b) => a + b, 0);
  const rows = lineupRows(by, gain);
  assertEquals(rows.reduce((s, r) => s + r.cents, 0), scoreCents(gain));
  // Every row is within one cent of its exact value.
  for (const r of rows) assertAlmostEquals(r.cents / 100, by[r.symbol], 0.01 + 1e-9);
});

Deno.test('lineupRows: keeps the input order and shows an exact zero as zero', () => {
  const rows = lineupRows({ NVDA: 125.27, AAPL: 0, TSLA: -26.94 }, 98.33);
  assertEquals(rows.map((r) => r.symbol), ['NVDA', 'AAPL', 'TSLA']);
  assertEquals(rows[1].cents, 0);
});

Deno.test('lineupRows: an empty ledger is no rows and a zero total', () => {
  assertEquals(lineupRows({}, 0), []);
  assertEquals(scoreCents(0), 0);
});
