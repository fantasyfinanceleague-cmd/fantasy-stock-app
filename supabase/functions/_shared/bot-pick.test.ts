/**
 * Hermetic unit tests for bot-pick.ts (mobile draft launch-blocker: server
 * chosen bot picks). No DB, no Alpaca, no Deno runtime APIs — run:
 *
 *   deno test supabase/functions/_shared/bot-pick.test.ts
 */

import { assertEquals } from 'jsr:@std/assert';
import type { BotSymbolCandidate } from './bot-pick.ts';
import { rankBotCandidates } from './bot-pick.ts';
import type { LeagueRules, PickRow, Slot, TradeRow } from './draft-validation.ts';

const baseRules: LeagueRules = {
  stakeMode: null,
  budgetAmount: null,
  notionalPerSlot: null,
  numRounds: 6,
};

function candidate(overrides: Partial<BotSymbolCandidate>): BotSymbolCandidate {
  return {
    symbol: 'AAA',
    lastPrice: 100,
    isDraftable: true,
    marketCap: 1_000_000,
    ...overrides,
  };
}

Deno.test('ranks by market cap descending', () => {
  const candidates = [
    candidate({ symbol: 'SMALL', marketCap: 10 }),
    candidate({ symbol: 'BIG', marketCap: 1000 }),
    candidate({ symbol: 'MID', marketCap: 100 }),
  ];
  const ranked = rankBotCandidates({
    rules: baseRules,
    slots: [],
    picks: [],
    trades: [],
    botId: 'bot-1',
    candidates,
  });
  assertEquals(ranked, ['BIG', 'MID', 'SMALL']);
});

Deno.test('ties broken alphabetically for determinism', () => {
  const candidates = [
    candidate({ symbol: 'ZZZ', marketCap: 500 }),
    candidate({ symbol: 'AAA', marketCap: 500 }),
  ];
  const ranked = rankBotCandidates({
    rules: baseRules,
    slots: [],
    picks: [],
    trades: [],
    botId: 'bot-1',
    candidates,
  });
  assertEquals(ranked, ['AAA', 'ZZZ']);
});

Deno.test('excludes non-draftable symbols unless allowUndraftable', () => {
  const candidates = [candidate({ symbol: 'PENNY', isDraftable: false })];
  const gated = rankBotCandidates({
    rules: baseRules,
    slots: [],
    picks: [],
    trades: [],
    botId: 'bot-1',
    candidates,
  });
  assertEquals(gated, []);

  const allowed = rankBotCandidates({
    rules: { ...baseRules, allowUndraftable: true },
    slots: [],
    picks: [],
    trades: [],
    botId: 'bot-1',
    candidates,
  });
  assertEquals(allowed, ['PENNY']);
});

Deno.test('excludes symbols with no cached price', () => {
  const candidates = [candidate({ symbol: 'NOPRICE', lastPrice: null })];
  const ranked = rankBotCandidates({
    rules: baseRules,
    slots: [],
    picks: [],
    trades: [],
    botId: 'bot-1',
    candidates,
  });
  assertEquals(ranked, []);
});

Deno.test('excludes symbols already owned anywhere in the league', () => {
  const candidates = [candidate({ symbol: 'AAPL' })];
  const picks: PickRow[] = [
    { user_id: 'other-user', symbol: 'AAPL', entry_price: 100, quantity: 1, pick_number: 1 },
  ];
  const ranked = rankBotCandidates({
    rules: baseRules,
    slots: [],
    picks,
    trades: [],
    botId: 'bot-1',
    candidates,
  });
  assertEquals(ranked, []);
});

Deno.test('budget_cap: excludes candidates over remaining budget', () => {
  const candidates = [
    candidate({ symbol: 'CHEAP', lastPrice: 40 }),
    candidate({ symbol: 'PRICEY', lastPrice: 90 }),
  ];
  const rules: LeagueRules = { ...baseRules, stakeMode: 'budget_cap', budgetAmount: 100 };
  const picks: PickRow[] = [
    { user_id: 'bot-1', symbol: 'ALREADY', entry_price: 60, quantity: 1, pick_number: 1 },
  ];
  const ranked = rankBotCandidates({
    rules,
    slots: [],
    picks,
    trades: [],
    botId: 'bot-1',
    candidates,
  });
  // remaining budget = 100 - 60 = 40; CHEAP fits exactly, PRICEY doesn't.
  assertEquals(ranked, ['CHEAP']);
});

Deno.test('excludes candidates that fit no slot bracket', () => {
  const slots: Slot[] = [
    { id: 's1', slotIndex: 0, slotCount: 1, priceMin: 0, priceMax: 50, categoryId: null },
  ];
  const candidates = [
    candidate({ symbol: 'CHEAP', lastPrice: 40 }),
    candidate({ symbol: 'EXPENSIVE', lastPrice: 500 }),
  ];
  const ranked = rankBotCandidates({
    rules: baseRules,
    slots,
    picks: [],
    trades: [],
    botId: 'bot-1',
    candidates,
  });
  assertEquals(ranked, ['CHEAP']);
});

Deno.test('slot-less league accepts any price', () => {
  const candidates = [candidate({ symbol: 'ANY', lastPrice: 9999 })];
  const ranked = rankBotCandidates({
    rules: baseRules,
    slots: [],
    picks: [],
    trades: [],
    botId: 'bot-1',
    candidates,
  });
  assertEquals(ranked, ['ANY']);
});

Deno.test('trades reduce a bot budget just like a real user', () => {
  const rules: LeagueRules = { ...baseRules, stakeMode: 'budget_cap', budgetAmount: 100 };
  const trades: TradeRow[] = [
    { user_id: 'bot-1', symbol: 'OLD', action: 'buy', quantity: 1, price: 95 },
  ];
  const candidates = [candidate({ symbol: 'CHEAP', lastPrice: 4 }), candidate({ symbol: 'MID', lastPrice: 6 })];
  const ranked = rankBotCandidates({
    rules,
    slots: [],
    picks: [],
    trades,
    botId: 'bot-1',
    candidates,
  });
  // remaining = 100 - 95 = 5; CHEAP (4) fits, MID (6) doesn't.
  assertEquals(ranked, ['CHEAP']);
});
