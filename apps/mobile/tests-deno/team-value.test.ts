/**
 * Tests for lib/home/teamValue.ts — the Home hero's big number (D1: "the
 * big number is team value"). Portfolio (3e) reuses the same helper
 * (Orchestrator ruling, 2026-09-29). Run:
 *   cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';
import { teamValue, type TeamValueInput } from '../lib/home/teamValue.ts';

function base(overrides: Partial<TeamValueInput>): TeamValueInput {
  return {
    stakeMode: 'fixed_notional',
    notionalPerSlot: 2000,
    numRounds: 6,
    drafts: [],
    trades: [],
    price: () => null,
    ...overrides,
  };
}

Deno.test('fixed_notional: stake = notionalPerSlot * numRounds; a skipped slot is cash', () => {
  // 5 of 6 slots drafted at exactly $2000 notional each; slot 6 skipped.
  const drafts = [
    { symbol: 'NVDA', entryPrice: 290.1, quantity: 2000 / 290.1 },
    { symbol: 'AAPL', entryPrice: 198.6, quantity: 2000 / 198.6 },
    { symbol: 'CRM', entryPrice: 262.4, quantity: 2000 / 262.4 },
    { symbol: 'TSLA', entryPrice: 262.8, quantity: 2000 / 262.8 },
    { symbol: 'COST', entryPrice: 905.2, quantity: 2000 / 905.2 },
  ];
  const prices: Record<string, number> = { NVDA: 321.9, AAPL: 214.8, CRM: 274.1, TSLA: 250.1, COST: 921.7 };
  const result = teamValue(base({ drafts, price: (s) => prices[s] ?? null }));
  assertAlmostEquals(result.stake, 12000, 1e-6);
  // cash = stake - draftCost ~= 2000 (the skipped 6th slot), since the 5
  // filled slots each cost ~exactly $2000 notional.
  assertAlmostEquals(result.cash, 2000, 1);
  const holdingsValue = drafts.reduce((sum, d) => sum + d.quantity * prices[d.symbol], 0);
  assertAlmostEquals(result.value, holdingsValue + result.cash, 0.01);
  assertEquals(result.cashWentNegative, false);
});

Deno.test('price_tiers: stake = drafted roster cost basis, one share per pick', () => {
  const drafts = [
    { symbol: 'JPM', entryPrice: 204.9, quantity: 1 },
    { symbol: 'DIS', entryPrice: 104.2, quantity: 1 },
  ];
  const prices: Record<string, number> = { JPM: 216.3, DIS: 100.2 };
  const result = teamValue(base({ stakeMode: 'price_tiers', notionalPerSlot: null, numRounds: null, drafts, price: (s) => prices[s] ?? null }));
  assertAlmostEquals(result.stake, 204.9 + 104.2, 1e-9);
  assertAlmostEquals(result.cash, 0, 1e-9); // no trades since draft
  assertAlmostEquals(result.value, 216.3 + 100.2, 1e-9);
});

Deno.test('budget_cap: cash can go NEGATIVE when the budget headroom (beyond draft cost) is spent — flagged, not smoothed', () => {
  const drafts = [{ symbol: 'JPM', entryPrice: 1000, quantity: 1 }]; // draftCost = 1000 = stake
  // A further buy with no matching sell — legal under budget_cap when
  // budgetAmount > draftCost, but this helper only knows the draft-cost
  // stake, so the extra spend must show as negative cash, not be hidden.
  const trades = [{ symbol: 'DIS', action: 'buy' as const, quantity: 1, price: 500 }];
  const prices: Record<string, number> = { JPM: 1100, DIS: 510 };
  const result = teamValue(base({ stakeMode: 'budget_cap', notionalPerSlot: null, numRounds: null, drafts, trades, price: (s) => prices[s] ?? null }));
  assertAlmostEquals(result.cash, -500, 1e-9);
  assertEquals(result.cashWentNegative, true);
  // value still adds up: holdings + cash, negative cash included, not clamped.
  assertAlmostEquals(result.value, 1100 + 510 - 500, 1e-9);
});

Deno.test('legacy NULL stake_mode is treated as one-share (draft-cost stake), like price_tiers', () => {
  const drafts = [{ symbol: 'KO', entryPrice: 68.1, quantity: 1 }];
  const result = teamValue(base({ stakeMode: null, notionalPerSlot: null, numRounds: null, drafts, price: () => 69.85 }));
  assertAlmostEquals(result.stake, 68.1, 1e-9);
});

Deno.test('an unpriced current holding counts at its cost basis and is listed, never $0', () => {
  const drafts = [{ symbol: 'ZZZZ', entryPrice: 50, quantity: 10 }];
  const result = teamValue(base({ stakeMode: 'price_tiers', drafts, price: () => null }));
  assertEquals(result.unpriced, ['ZZZZ']);
  assertAlmostEquals(result.value, 500 + result.cash, 1e-9); // cost basis (50*10), not $0
});

Deno.test('a sell reduces cash-tracked holdings and adds proceeds to cash', () => {
  const drafts = [{ symbol: 'TSLA', entryPrice: 262.8, quantity: 10 }]; // draftCost = 2628, stake (fixed_notional here) = notional*rounds
  const trades = [{ symbol: 'TSLA', action: 'sell' as const, quantity: 10, price: 250 }];
  const result = teamValue(base({ drafts, trades, notionalPerSlot: 2628, numRounds: 1, price: () => null }));
  // stake=2628, draftCost=2628 -> cash(0)=0; sell adds 2500 proceeds.
  assertAlmostEquals(result.cash, 2500, 1e-9);
  assertAlmostEquals(result.value, 0 + 2500, 1e-9); // no holdings left
});
