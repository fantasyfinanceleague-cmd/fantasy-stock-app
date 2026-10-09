/**
 * Hermetic tests for lib/money/portfolioModel.ts (holdings and the stake) and
 * lib/money/prevClose.ts. Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { myHoldingsFromLedger, portfolioHoldings, portfolioSummary, stockPosition } from '../lib/money/portfolioModel.ts';
import { prevCloseFromBars } from '../lib/money/prevClose.ts';
import type { PortfolioLedger } from '../lib/money/portfolioLedger.ts';

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

// C-4 (Design Lead gate, key screen 5): "Your position" on the stock sheet.
function row(over: Partial<PortfolioLedger['activity'][number]>): PortfolioLedger['activity'][number] {
  return {
    kind: 'draft', user_id: 'm01', symbol: 'NVDA', action: 'buy', quantity: 10,
    round: 1, pick_number: 1, occurred_at: '2026-09-01T14:30:00Z', total_value: 1000, price: 100,
    ...over,
  };
}

Deno.test('myHoldingsFromLedger: only the caller\'s own rows, same cost-basis math as Portfolio', () => {
  const ledger: PortfolioLedger = {
    activity: [
      row({ user_id: 'm01', symbol: 'NVDA', price: 100, quantity: 10 }),
      row({ user_id: 'm02', symbol: 'NVDA', price: 999, quantity: 10 }), // another manager's NVDA: never counted
      row({ user_id: 'm01', kind: 'trade', action: 'sell', symbol: 'NVDA', price: 150, quantity: 4 }),
    ],
    symbol_names: {},
    members: [],
  };
  const h = myHoldingsFromLedger(ledger, 'm01');
  assertEquals(h.length, 1);
  assertEquals(h[0].symbol, 'NVDA');
  assertEquals(h[0].quantity, 6);
  assertEquals(h[0].costBasis, 600); // average cost of 100 kept on the remaining 6 shares
});

Deno.test('myHoldingsFromLedger: a row with no price is left out of the cost basis, like every other ledger reader', () => {
  const ledger: PortfolioLedger = {
    activity: [row({ price: null })],
    symbol_names: {},
    members: [],
  };
  assertEquals(myHoldingsFromLedger(ledger, 'm01'), []);
});

Deno.test('stockPosition: avg entry, value and gain from the cost basis and the live price', () => {
  const p = stockPosition({ symbol: 'NVDA', quantity: 10, costBasis: 1000 }, 150);
  assertEquals(p.quantity, 10);
  assertEquals(p.avgEntry, 100);
  assertEquals(p.value, 1500);
  assertEquals(p.gain, 500);
  assertEquals(p.gainPct, 50);
});

Deno.test('stockPosition: a loss is negative, never clamped to zero', () => {
  const p = stockPosition({ symbol: 'NVDA', quantity: 10, costBasis: 1000 }, 80);
  assertEquals(p.gain, -200);
  assertEquals(p.gainPct, -20);
});
