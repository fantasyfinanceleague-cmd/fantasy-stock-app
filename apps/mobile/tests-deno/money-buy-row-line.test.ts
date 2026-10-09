/**
 * Hermetic tests for lib/money/buyRowLine.ts (3e, E-4). One test per branch
 * of the Design Lead's verbatim copy (2026-10-06).
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { buyRowLine } from '../lib/money/buyRowLine.ts';

const base = { sales: [], budgetLeft: null, rosterFull: false, openSlotLabels: [] };

// fixed_notional: per-slot sales, never a total.
Deno.test('fixed_notional, no open sale: every slot is invested', () => {
  assertEquals(buyRowLine({ ...base, stakeMode: 'fixed_notional' }), {
    text: 'Every slot is invested. Sell a holding to free one.',
  });
});

Deno.test('fixed_notional, one open sale: the exact amount and symbol', () => {
  assertEquals(
    buyRowLine({ ...base, stakeMode: 'fixed_notional', sales: [{ symbol: 'jpm', amount: 969.98 }] }),
    { text: '$969.98 from your JPM sale is ready to invest.' },
  );
});

Deno.test('fixed_notional, two open sales: both named, plural verb', () => {
  assertEquals(
    buyRowLine({
      ...base,
      stakeMode: 'fixed_notional',
      sales: [{ symbol: 'JPM', amount: 969.98 }, { symbol: 'AAPL', amount: 250 }],
    }),
    { text: '$969.98 from JPM and $250.00 from AAPL are ready to invest.' },
  );
});

Deno.test('fixed_notional, three or more open sales: a count, no per-sale breakdown', () => {
  assertEquals(
    buyRowLine({
      ...base,
      stakeMode: 'fixed_notional',
      sales: [{ symbol: 'JPM', amount: 1 }, { symbol: 'AAPL', amount: 2 }, { symbol: 'TSLA', amount: 3 }],
    }),
    { text: "Cash from 3 sales is ready to invest. You'll pick which one pays." },
  );
});

// budget_cap: pooled, roster-full checked before the budget figure.
Deno.test('budget_cap, roster full: the ruled roster_full line, not a budget figure', () => {
  assertEquals(buyRowLine({ ...base, stakeMode: 'budget_cap', rosterFull: true, budgetLeft: 500 }), {
    text: 'Your roster is full. Sell a holding first.',
  });
});

Deno.test('budget_cap, room on the roster: the budget left, formatted', () => {
  assertEquals(buyRowLine({ ...base, stakeMode: 'budget_cap', budgetLeft: 1234 }), {
    text: '$1,234.00 of your budget is left to spend.',
  });
});

Deno.test('budget_cap, budget unreadable (no league budget_amount or no cashSpent): no line, not a guess', () => {
  assertEquals(buyRowLine({ ...base, stakeMode: 'budget_cap', budgetLeft: null }), null);
});

// price_tiers: per-slot, labels straight from tierContract's slotLabelFor.
Deno.test('price_tiers, no open slot: every slot is filled', () => {
  assertEquals(buyRowLine({ ...base, stakeMode: 'price_tiers' }), {
    text: 'Every slot is filled. Sell a holding to free one.',
  });
});

Deno.test('price_tiers, one open slot (a price band): "Your $X is open."', () => {
  assertEquals(buyRowLine({ ...base, stakeMode: 'price_tiers', openSlotLabels: ['$100–$200 slot'] }), {
    text: 'Your $100–$200 slot is open.',
  });
});

Deno.test('price_tiers, one open slot (a category): "Your Tech slot is open."', () => {
  assertEquals(buyRowLine({ ...base, stakeMode: 'price_tiers', openSlotLabels: ['Tech slot'] }), {
    text: 'Your Tech slot is open.',
  });
});

Deno.test('price_tiers, one open slot (Flex, neither band nor category): "Your Flex slot is open."', () => {
  assertEquals(buyRowLine({ ...base, stakeMode: 'price_tiers', openSlotLabels: ['Flex slot'] }), {
    text: 'Your Flex slot is open.',
  });
});

Deno.test('price_tiers, two open slots: both named, "slot" -> "slots"', () => {
  assertEquals(
    buyRowLine({ ...base, stakeMode: 'price_tiers', openSlotLabels: ['$100–$200 slot', '$400–$800 slot'] }),
    { text: 'Your $100–$200 and $400–$800 slots are open.' },
  );
});

Deno.test('price_tiers, three or more open slots: a count, no per-slot breakdown', () => {
  assertEquals(
    buyRowLine({ ...base, stakeMode: 'price_tiers', openSlotLabels: ['$100–$200 slot', 'Tech slot', 'Flex slot'] }),
    { text: '3 of your slots are open.' },
  );
});

// An unknown/legacy stake mode: no line, never a guess.
Deno.test('stakeMode null (legacy): no line', () => {
  assertEquals(buyRowLine({ ...base, stakeMode: null }), null);
});
