/**
 * Parity + behavior tests for lib/home/liveWeekScore.ts — the Home/Matchup
 * shared live-score helper (Phase 3b-2).
 *
 * liveWeekScore is a PORT of the server's calculateUserScore
 * (supabase/functions/process-week-results/user-score.ts), with the Friday
 * close swapped for a live price. This file cross-imports the real server
 * function (Deno-only; never bundled into the RN app — see
 * tests-deno/deno.json's header for the same pattern used by
 * shell-username.test.ts) and asserts liveWeekScore agrees with it exactly
 * when the live price equals the eventual Friday close.
 *
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';
import { liveWeekScore, type LiveSnapshot, type LiveTrade } from '../lib/home/liveWeekScore.ts';
import {
  calculateUserScore,
  type WeekSnapshot,
  type MidWeekTrade,
} from '../../../supabase/functions/process-week-results/user-score.ts';

const day = (iso: string) => new Date(iso);

/** Run both the server scorer and liveWeekScore over the same fixture, with
 * `closes` as both the server's persisted weekEndPrice per symbol and
 * liveWeekScore's live price() — the condition under which they must agree. */
function parity(
  snaps: { symbol: string; quantity: number; weekStartPrice: number; enteredMidWeek: boolean }[],
  trades: { symbol: string; action: 'buy' | 'sell'; quantity: number; price: number; createdAt: string }[],
  closes: Record<string, number>,
) {
  const serverSnaps: WeekSnapshot[] = snaps.map((s) => ({
    symbol: s.symbol,
    quantity: s.quantity,
    weekStartPrice: s.weekStartPrice,
    weekEndPrice: closes[s.symbol.toUpperCase()] ?? null,
    enteredMidWeek: s.enteredMidWeek,
  }));
  const serverTrades: MidWeekTrade[] = trades.map((t) => ({
    symbol: t.symbol, action: t.action, quantity: t.quantity, price: t.price, createdAt: day(t.createdAt),
  }));
  const serverResult = calculateUserScore('u1', serverSnaps, serverTrades);

  const mySnaps: LiveSnapshot[] = snaps.map((s) => ({
    symbol: s.symbol, quantity: s.quantity, weekStartPrice: s.weekStartPrice, enteredMidWeek: s.enteredMidWeek,
  }));
  const myTrades: LiveTrade[] = trades.map((t) => ({
    symbol: t.symbol, action: t.action, quantity: t.quantity, price: t.price, createdAt: day(t.createdAt),
  }));
  const myResult = liveWeekScore(mySnaps, myTrades, (sym) => closes[sym.toUpperCase()] ?? null);

  return { serverResult, myResult };
}

Deno.test('parity: held all week (Monday lot, no trades)', () => {
  const { serverResult, myResult } = parity(
    [{ symbol: 'NVDA', quantity: 10, weekStartPrice: 300, enteredMidWeek: false }],
    [],
    { NVDA: 321.9 },
  );
  assertAlmostEquals(myResult.gain, serverResult.dollarGain, 1e-9);
  assertAlmostEquals(myResult.pct, serverResult.percentGain, 1e-9);
  assertEquals(myResult.hasPositions, serverResult.hasPositions);
  assertEquals(myResult.unpriced, []);
});

Deno.test('parity: partial sell of a Monday lot', () => {
  const { serverResult, myResult } = parity(
    [{ symbol: 'AAPL', quantity: 10, weekStartPrice: 200, enteredMidWeek: false }],
    [{ symbol: 'AAPL', action: 'sell', quantity: 4, price: 210, createdAt: '2026-09-23T15:00:00Z' }],
    { AAPL: 214.8 },
  );
  assertAlmostEquals(myResult.gain, serverResult.dollarGain, 1e-9);
  assertAlmostEquals(myResult.pct, serverResult.percentGain, 1e-9);
});

Deno.test('parity: SOME Monday lots plus one mid-week buy (the partial-state case)', () => {
  const { serverResult, myResult } = parity(
    [
      { symbol: 'NVDA', quantity: 10, weekStartPrice: 300, enteredMidWeek: false },
      { symbol: 'AAPL', quantity: 5, weekStartPrice: 200, enteredMidWeek: true }, // mid-week entry row
    ],
    [{ symbol: 'AAPL', action: 'buy', quantity: 5, price: 200, createdAt: '2026-09-23T15:00:00Z' }],
    { NVDA: 321.9, AAPL: 214.8 },
  );
  assertAlmostEquals(myResult.gain, serverResult.dollarGain, 1e-9);
  assertAlmostEquals(myResult.pct, serverResult.percentGain, 1e-9);
  // The mid-week buy must NOT be double-counted (once from the
  // entered_mid_week row, once from the trade) — the server's own
  // regression, mirrored here.
  const expectedNvda = 10 * (321.9 - 300);
  const expectedAapl = 5 * (214.8 - 200);
  assertAlmostEquals(myResult.gain, expectedNvda + expectedAapl, 1e-9);
});

Deno.test('parity: buy then sell the same symbol mid-week (FIFO round trip)', () => {
  const { serverResult, myResult } = parity(
    [],
    [
      { symbol: 'SHOP', action: 'buy', quantity: 20, price: 100, createdAt: '2026-09-22T15:00:00Z' },
      { symbol: 'SHOP', action: 'sell', quantity: 20, price: 108, createdAt: '2026-09-24T15:00:00Z' },
    ],
    { SHOP: 110 }, // irrelevant: the position was fully closed before week end
  );
  assertAlmostEquals(myResult.gain, serverResult.dollarGain, 1e-9);
  assertAlmostEquals(myResult.gain, 20 * (108 - 100), 1e-9);
});

Deno.test('parity: all-cash (no snapshots, no trades)', () => {
  const { serverResult, myResult } = parity([], [], {});
  assertEquals(myResult.gain, 0);
  assertEquals(myResult.hasPositions, serverResult.hasPositions);
  assertEquals(myResult.hasPositions, false);
});

Deno.test('parity: sell a Monday lot then rebuy the same symbol mid-week', () => {
  const { serverResult, myResult } = parity(
    [{ symbol: 'TSLA', quantity: 10, weekStartPrice: 262, enteredMidWeek: false }],
    [
      { symbol: 'TSLA', action: 'sell', quantity: 10, price: 255, createdAt: '2026-09-22T15:00:00Z' },
      { symbol: 'TSLA', action: 'buy', quantity: 8, price: 250, createdAt: '2026-09-23T15:00:00Z' },
    ],
    { TSLA: 248 },
  );
  assertAlmostEquals(myResult.gain, serverResult.dollarGain, 1e-9);
});

Deno.test('an unpriced symbol is listed, not silently dropped', () => {
  const result = liveWeekScore(
    [{ symbol: 'ZZZZ', quantity: 5, weekStartPrice: 50, enteredMidWeek: false }],
    [],
    () => null, // no quote available
  );
  assertEquals(result.unpriced, ['ZZZZ']);
  // Consistent with the server's own behavior: an unpriced-at-end symbol
  // contributes nothing to EITHER side, so pct stays a fair ratio — but the
  // caller is told, via `unpriced`, rather than presenting a number that
  // silently assumed it saw everything.
  assertEquals(result.gain, 0);
  assertEquals(result.startValue, 0);
});

Deno.test('the data.js Thursday-live sample matches the board number', () => {
  // KS.MATCHUP.live.you (Roberto, Thu 1:37 PM ET): NVDA/AAPL/CRM/TSLA/COST/V
  // week-start (mon) -> thu, fixed-notional qty = 2000/draft price.
  const H = [
    { t: 'NVDA', draft: 290.1, mon: 300.2, thu: 318.37 },
    { t: 'AAPL', draft: 198.6, mon: 205.1, thu: 211.42 },
    { t: 'CRM', draft: 262.4, mon: 268.0, thu: 271.35 },
    { t: 'TSLA', draft: 262.8, mon: 251.9, thu: 248.36 },
    { t: 'COST', draft: 905.2, mon: 912.4, thu: 918.1 },
    { t: 'V', draft: 281.5, mon: 284.2, thu: 286.1 },
  ];
  const cents = (v: number) => Math.round(v * 100) / 100;
  const snaps: LiveSnapshot[] = H.map((h) => {
    const qty = Math.round((2000 / h.draft) * 1e4) / 1e4;
    return { symbol: h.t, quantity: qty, weekStartPrice: h.mon, enteredMidWeek: false };
  });
  const result = liveWeekScore(snaps, [], (sym) => H.find((h) => h.t === sym)!.thu);
  const expectedGain = H.reduce((sum, h) => {
    const qty = Math.round((2000 / h.draft) * 1e4) / 1e4;
    return cents(sum + cents(qty * (h.thu - h.mon)));
  }, 0);
  assertAlmostEquals(result.gain, expectedGain, 0.01);
});
