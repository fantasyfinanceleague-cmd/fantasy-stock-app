/**
 * Hermetic tests for lib/money/reviewModel.ts (3e): the review's lines, headline
 * and button for sell and buy, per league mode. Run with:
 * cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { buyReviewOneShare, buyReviewPerSlot, sellReview } from '../lib/money/reviewModel.ts';
import { JPM_PROCEEDS, VIST_BUY, VIST_PRICE } from './fixtures/jpm-sale.ts';
import { formatMoney } from '../components/sp/logic/money.ts';
import { formatShares } from '../lib/money/formatShares.ts';

Deno.test('sell: a whole position, named "Sell JPM", with the slot comparison and the note', () => {
  const r = sellReview({ symbol: 'JPM', quantity: 2.916472, price: 333.25, slotNotional: 2000 });
  assertEquals(r.buttonLabel, 'Sell JPM');
  assertEquals(r.buttonRole, 'sell');
  assertEquals(r.lines[0], { label: 'Sell', value: '2.9165 JPM' });
  // The dollars are the server's arithmetic (the fixture derives them).
  assertEquals(r.lines[2], { label: 'You get', value: formatMoney(JPM_PROCEEDS) });
  assertEquals(r.lines[3].label, "Vs. the slot's $2,000.00");
  assertEquals(r.lines[3].value, '−$1,028.09');
  assertEquals(r.lines[3].tone, 'loss');
  assertEquals(r.card, `${formatMoney(JPM_PROCEEDS)} stays in this slot, ready to invest in any stock. It doesn't earn until you buy.`);
  assertEquals(r.caption, 'Prices can move before the order fills.');
});

Deno.test('sell: a sale that returns exactly the slot is zero, grey, unsigned', () => {
  const r = sellReview({ symbol: 'X', quantity: 10, price: 200, slotNotional: 2000 });
  assertEquals(r.lines[3].value, '$0.00');
  assertEquals(r.lines[3].tone, 'zero');
});

Deno.test('sell, budget league: "all you hold", the budget back and the budget left after, no slot line', () => {
  const r = sellReview({ symbol: 'TSLA', quantity: 1, price: 248.36, budget: { before: 2251.64, after: 2500 } });
  assertEquals(r.lines.map((l) => l.label), ['Sell', 'Price', 'Back to your budget', 'Budget left after']);
  assertEquals(r.lines[0].value, '1 TSLA · all you hold');
  assertEquals(r.lines[3].value, '$2,500.00');
});

Deno.test('buy, per slot: "Buy $X of VIST" (derived), the shares are approximate, paid from the slot, left in it', () => {
  const r = buyReviewPerSlot({ symbol: 'VIST', amount: JPM_PROCEEDS, price: VIST_PRICE, quantity: VIST_BUY!.quantity, sourceLabel: 'JPM slot', leftInSlot: 0 });
  assertEquals(r.headline, `Buy ${formatMoney(JPM_PROCEEDS)} of VIST`);
  assertEquals(r.buttonLabel, 'Buy VIST');
  assertEquals(r.lines[0].value, `≈ ${formatShares(VIST_BUY!.quantity)} VIST`);
  assertEquals(r.lines[2], { label: 'Paid from', value: `JPM slot · ${formatMoney(JPM_PROCEEDS)}` });
  assertEquals(r.lines[3], { label: 'Left in the slot', value: '$0.00', tone: 'zero' });
});

Deno.test('buy, budget league: one share, the budget now and the budget left after', () => {
  const r = buyReviewOneShare({ symbol: 'SHOP', price: 104.2, budget: { before: 2500, after: 2395.8 } });
  assertEquals(r.lines[0].value, '1 SHOP');
  assertEquals(r.lines[2], { label: 'Budget now', value: '$2,500.00' });
  assertEquals(r.lines[3], { label: 'Budget left after', value: '$2,395.80' });
});

Deno.test('every review says prices can move, and never says Confirm or OK', () => {
  for (const r of [
    sellReview({ symbol: 'A', quantity: 1, price: 10, slotNotional: 2000 }),
    buyReviewPerSlot({ symbol: 'B', amount: 100, price: 10, quantity: 10, sourceLabel: 'A slot', leftInSlot: 0 }),
    buyReviewOneShare({ symbol: 'C', price: 10, budget: { before: 100, after: 90 } }),
  ]) {
    assertEquals(r.caption, 'Prices can move before the order fills.');
    assertEquals(/confirm|^ok$/i.test(r.buttonLabel), false);
  }
});
