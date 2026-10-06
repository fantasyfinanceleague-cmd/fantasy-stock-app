/**
 * Hermetic tests for lib/money/portfolioModel.ts (holdings and the stake) and
 * lib/money/prevClose.ts. Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { portfolioHoldings, portfolioSummary } from '../lib/money/portfolioModel.ts';
import { prevCloseFromBars } from '../lib/money/prevClose.ts';

Deno.test('holdings: a sold-out position is dropped; a partial sell keeps average cost', () => {
  const drafts = [
    { symbol: 'NVDA', entryPrice: 100, quantity: 20 },
    { symbol: 'TSLA', entryPrice: 200, quantity: 10 },
  ];
  const trades = [
    { symbol: 'TSLA', action: 'sell' as const, quantity: 10, price: 250 },
    { symbol: 'NVDA', action: 'sell' as const, quantity: 5, price: 150 },
  ];
  const h = portfolioHoldings(drafts, trades);
  assertEquals(h.map((x) => x.symbol), ['NVDA']);
  assertEquals(h[0].quantity, 15);
  // Average cost of 100 kept on the remaining 15 shares: 1,500.
  assertEquals(h[0].costBasis, 1500);
});

Deno.test('holdings: a SKIP row is never a holding', () => {
  const h = portfolioHoldings([{ symbol: 'SKIP', entryPrice: 0, quantity: 0 }], []);
  assertEquals(h, []);
});

Deno.test('the summary exposes the stake the gain is measured from', () => {
  const s = portfolioSummary({
    stakeMode: 'fixed_notional', notionalPerSlot: 2000, numRounds: 6, trades: [], price: () => 100,
    drafts: [{ symbol: 'AAA', entryPrice: 100, quantity: 20 }],
  });
  assertEquals(s.stake, 12000);
});

Deno.test('prev close: the last bar before today, never today itself', () => {
  const bars = [
    { date: '2026-10-01', close: 300 },
    { date: '2026-10-02', close: 306.68 },
    { date: '2026-10-05', close: 318.37 },
  ];
  assertEquals(prevCloseFromBars(bars, '2026-10-05'), 306.68);
});

Deno.test('prev close: no earlier bar is null, never a guess', () => {
  assertEquals(prevCloseFromBars([{ date: '2026-10-05', close: 318.37 }], '2026-10-05'), null);
  assertEquals(prevCloseFromBars([], '2026-10-05'), null);
});

Deno.test('prev close: a zero close is not a price', () => {
  assertEquals(prevCloseFromBars([{ date: '2026-10-02', close: 0 }, { date: '2026-10-01', close: 290 }], '2026-10-05'), 290);
});
