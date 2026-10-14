/**
 * Budget figures for budget and tier leagues (3e, D4 A). The cash spent matches
 * the server's userCashSpent formula; a sale refunds the budget, a buy spends it.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { budgetAfterBuy, budgetAfterSell, userCashSpentFromLedger } from '../lib/money/budgetFigures.ts';
import { parsePortfolioLedger } from '../lib/money/portfolioLedger.ts';

Deno.test('a sale refunds the budget at its proceeds; a buy spends one share', () => {
  assertEquals(budgetAfterSell(2251.64, 1, 248.36), 2500);
  assertEquals(budgetAfterBuy(2500, 104.2), 2395.8);
});

Deno.test('cash spent: draft costs plus buys, minus sale proceeds, for the caller only', () => {
  const ledger = parsePortfolioLedger({
    activity: [
      { kind: 'draft', user_id: 'me', symbol: 'NVDA', action: 'buy', quantity: 1, round: 1, pick_number: 1, occurred_at: '2026-09-13T14:00:00Z', total_value: 290.1, price: 290.1 },
      { kind: 'draft', user_id: 'other', symbol: 'AMZN', action: 'buy', quantity: 1, round: 1, pick_number: 2, occurred_at: '2026-09-13T14:01:00Z', total_value: 221.3, price: 221.3 },
      { kind: 'trade', user_id: 'me', symbol: 'NVDA', action: 'sell', quantity: 1, round: null, pick_number: null, occurred_at: '2026-10-01T14:00:00Z', total_value: 300, price: 300 },
      { kind: 'trade', user_id: 'me', symbol: 'SHOP', action: 'buy', quantity: 1, round: null, pick_number: null, occurred_at: '2026-10-02T14:00:00Z', total_value: 104.2, price: 104.2 },
    ],
    symbol_names: {}, members: [],
  })!;
  // 290.10 (draft) - 300 (sale) + 104.20 (buy) = 94.30
  assertEquals(userCashSpentFromLedger(ledger, 'me'), 94.3);
});

// ── W4 defect (d): the client's cap is the server's (`Number(rules.budgetAmount) || 0`) ──
import { budgetLeftOf, effectiveBudgetCap } from '../lib/money/budgetFigures.ts';

Deno.test('effectiveBudgetCap: a NULL or unparseable budget_amount in budget_cap is a $0 cap, as on the server', () => {
  assertEquals(effectiveBudgetCap('budget_cap', null), 0);
  assertEquals(effectiveBudgetCap('budget_cap', undefined), 0);
  assertEquals(effectiveBudgetCap('budget_cap', 'abc'), 0);
  assertEquals(effectiveBudgetCap('budget_cap', '2500'), 2500);
  assertEquals(effectiveBudgetCap('budget_cap', 2500), 2500);
});

Deno.test('effectiveBudgetCap: no other stake mode has a budget', () => {
  assertEquals(effectiveBudgetCap('price_tiers', 2500), null);
  assertEquals(effectiveBudgetCap('fixed_notional', null), null);
  assertEquals(effectiveBudgetCap(null, 2500), null);
});

Deno.test('budgetLeftOf: cap minus spent, to the cent, negative when over', () => {
  assertEquals(budgetLeftOf(2500, 2251.644), 248.36);
  assertEquals(budgetLeftOf(0, 120.5), -120.5);
});
