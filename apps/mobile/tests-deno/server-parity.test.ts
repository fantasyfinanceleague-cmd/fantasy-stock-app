/**
 * Parity between the client's money decisions and the server's own validator
 * (supabase/functions/_shared/draft-validation.ts). The client never sizes a
 * trade or counts budget with its own rules alone: each assertion here runs
 * the SAME inputs through the server module and the client module and demands
 * the same answer. A drift fails here, before a review ever shows a wrong
 * number. Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  fixedNotionalFunding,
  userCashSpent,
  validateTradeAdd,
  type LeagueRules,
  type PickRow,
  type TradeRow,
} from '../../../supabase/functions/_shared/draft-validation.ts';
import { buyQuantity, fixedNotionalShares } from '../lib/money/buyQuantity.ts';
import { cashSpent } from '../lib/money/cashSpent.ts';

// record-trade rounds the fill to cents ONCE, before validating and sizing
// (index.ts: price = Math.round(fill.price * 100) / 100). The parity inputs
// must do the same, or the server and client see different prices.
const cents = (v: number) => Math.round(v * 100) / 100;

const USER = 'user-1';
const OTHER = 'user-2';

function pick(over: Partial<PickRow> & { symbol: string; entry_price: number; quantity: number }): PickRow {
  return { user_id: USER, pick_number: 1, slot_id: null, ...over };
}

function trade(over: Partial<TradeRow> & { id: string; symbol: string; action: 'buy' | 'sell' }): TradeRow {
  return {
    user_id: USER,
    quantity: 1,
    price: 100,
    total_value: undefined,
    created_at: '2026-10-05T14:00:00Z',
    funded_by_trade_id: null,
    ...over,
  };
}

const FIXED: LeagueRules = { stakeMode: 'fixed_notional', budgetAmount: null, notionalPerSlot: 2000, numRounds: 6, allowUndraftable: true };

Deno.test('parity: fixed_notional buy funded by a sale sizes exactly like the server (test_0925 shape)', () => {
  // Six draft picks at $2,000 each; JPM sold whole for 971.92; a buy of VIST at $66.42.
  const picks: PickRow[] = [
    pick({ symbol: 'JPM', entry_price: 204.9, quantity: 2000 / 204.9, pick_number: 1 }),
    pick({ symbol: 'AAPL', entry_price: 198.6, quantity: 2000 / 198.6, pick_number: 2 }),
  ];
  const trades: TradeRow[] = [
    trade({ id: 'sell-jpm', symbol: 'JPM', action: 'sell', quantity: 2.916472, price: 333.25, total_value: 971.92 }),
  ];
  const decision = validateTradeAdd({
    rules: FIXED, slots: [], picks, trades, userId: USER, symbol: 'VIST', price: cents(66.4175),
    eligibleCategories: new Set(), isDraftable: true, soldTradeId: null,
  });
  if (!decision.legal) throw new Error(`server refused: ${decision.reason}`);

  const client = buyQuantity({ kind: 'proceeds', amount: 971.92, price: cents(66.4175) });
  assertEquals(client, decision.quantity);
  assertEquals(decision.stakeAmount, 971.92);
  assertEquals(decision.fundedByTradeId, 'sell-jpm');
});

Deno.test('parity: the server funding sources the client shows are the ones it spends', () => {
  const picks: PickRow[] = [pick({ symbol: 'TSLA', entry_price: 262.8, quantity: 2000 / 262.8, pick_number: 1 })];
  const trades: TradeRow[] = [
    trade({ id: 'tsla-sell', symbol: 'TSLA', action: 'sell', quantity: 7.6105, price: 248.36, total_value: 1890.12 }),
    trade({ id: 'v-sell', symbol: 'V', action: 'sell', quantity: 3.5, price: 285.04, total_value: 997.64, created_at: '2026-10-05T15:00:00Z' }),
  ];
  const funding = fixedNotionalFunding(USER, picks, trades);
  assertEquals(funding.open.map((o) => o.tradeId), ['tsla-sell', 'v-sell']);
  assertEquals(funding.unfilledSlots, 0);
});

Deno.test('parity: a one-share (budget_cap) buy is exactly 1 share, the server quantity', () => {
  const rules: LeagueRules = { stakeMode: 'budget_cap', budgetAmount: 2500, notionalPerSlot: null, numRounds: 6, allowUndraftable: true };
  const picks: PickRow[] = [pick({ symbol: 'NVDA', entry_price: 290.1, quantity: 1, pick_number: 1 })];
  const decision = validateTradeAdd({
    rules, slots: [], picks, trades: [], userId: USER, symbol: 'SHOP', price: 104.2,
    eligibleCategories: new Set(), isDraftable: true, soldTradeId: null,
  });
  if (!decision.legal) throw new Error(`server refused: ${decision.reason}`);
  assertEquals(buyQuantity({ kind: 'one_share' }), decision.quantity);
});

Deno.test('parity: budget_cap cash spent (sales refund the budget) matches userCashSpent', () => {
  const picks: PickRow[] = [
    pick({ symbol: 'NVDA', entry_price: 290.1, quantity: 1, pick_number: 1 }),
    pick({ symbol: 'TSLA', entry_price: 262.8, quantity: 1, pick_number: 2 }),
    pick({ symbol: 'SKIP', entry_price: 0, quantity: 0, pick_number: 3 }),
    pick({ symbol: 'XOM', entry_price: 110, quantity: 1, pick_number: 4, user_id: OTHER }),
  ];
  const trades: TradeRow[] = [
    trade({ id: 't1', symbol: 'TSLA', action: 'sell', quantity: 1, price: 248.36 }),
    trade({ id: 't2', symbol: 'SHOP', action: 'buy', quantity: 1, price: 104.2 }),
  ];
  const server = userCashSpent(USER, picks, trades);
  const client = cashSpent(USER, picks, trades);
  assertEquals(Math.round(client * 100) / 100, Math.round(server * 100) / 100);
});

Deno.test('parity: fixedNotionalShares agrees with the server rounding on a cents-boundary price', () => {
  // A raw fill of 66.4149 must round to 66.41 before sizing, exactly as record-trade does.
  const picks: PickRow[] = [pick({ symbol: 'JPM', entry_price: 204.9, quantity: 2000 / 204.9, pick_number: 1 })];
  const trades: TradeRow[] = [trade({ id: 'sell', symbol: 'JPM', action: 'sell', quantity: 2.916472, price: 333.25, total_value: 971.92 })];
  const decision = validateTradeAdd({
    rules: FIXED, slots: [], picks, trades, userId: USER, symbol: 'X', price: cents(66.4149),
    eligibleCategories: new Set(), isDraftable: true, soldTradeId: null,
  });
  if (!decision.legal) throw new Error(`server refused: ${decision.reason}`);
  assertEquals(fixedNotionalShares(971.92, 66.4149)?.quantity, decision.quantity);
});
