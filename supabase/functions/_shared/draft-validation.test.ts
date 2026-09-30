/**
 * Hermetic unit tests for draft-validation.ts (Phase 3, DR-001 /
 * SIMULATOR_MIGRATION_SPEC). No DB, no Alpaca, no Deno runtime APIs — run:
 *
 *   deno test supabase/functions/_shared/draft-validation.test.ts
 *
 * Covers the spec's required Phase 3 cases:
 *   - fixed-notional fractional quantities
 *   - tier bracket edges (price exactly at a boundary)
 *   - cap-mode remaining-budget math across a full draft
 *   - mid-week add scoring (integration with snapshot-week-end/close.ts —
 *     proves a record-trade row feeds the EXISTING mechanism unforked)
 *   - turn enforcement (snake order, bots, skips)
 *   - duplicate-pick rejection (and drop-frees-symbol league-wide)
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import {
  assignSlot,
  checkStoredOrder,
  effectiveCategoryIds,
  currentTurn,
  fillQuantity,
  fixedNotionalFunding,
  leagueOwnedSymbols,
  type LeagueRules,
  orderFromRows,
  type PickRow,
  resolveFunding,
  SKIP_SYMBOL,
  type Slot,
  type TradeRow,
  userCashSpent,
  userNetHoldings,
  validatePick,
  validateSkip,
  validateTradeAdd,
  validateTradeDrop,
} from './draft-validation.ts';
import { buildCloseWork, type Holding } from '../snapshot-week-end/close.ts';
// Feasibility-coverage predicate — the SAME pure function the web client imports
// from @fantasy-stock/shared. Imported here by its repo-relative path so this
// hermetic suite exercises the real thing, not a copy.
import { coverageIsPartial, ENRICHMENT_COVERAGE_THRESHOLD } from '../../../packages/shared/constants/index.ts';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const RULES_LEGACY: LeagueRules = {
  stakeMode: null,
  budgetAmount: null,
  notionalPerSlot: null,
  numRounds: 3,
};

const rules = (over: Partial<LeagueRules>): LeagueRules => ({ ...RULES_LEGACY, ...over });

let pickCounter = 0;
function pick(userId: string, symbol: string, price: number, extra: Partial<PickRow> = {}): PickRow {
  pickCounter += 1;
  return {
    user_id: userId,
    symbol,
    entry_price: price,
    quantity: 1,
    pick_number: pickCounter,
    slot_id: null,
    ...extra,
  };
}
function skipRow(userId: string): PickRow {
  return pick(userId, SKIP_SYMBOL, 0, { quantity: 0 });
}
function trade(
  userId: string,
  symbol: string,
  action: 'buy' | 'sell',
  quantity: number,
  price: number,
  extra: Partial<TradeRow> = {},
): TradeRow {
  return { user_id: userId, symbol, action, quantity, price, ...extra };
}
function slot(id: string, slotIndex: number, over: Partial<Slot> = {}): Slot {
  return { id, slotIndex, slotCount: 1, priceMin: null, priceMax: null, categoryId: null, ...over };
}

/** No category eligibility — the right value for bracket-only/slot-less tests. */
const NO_CATS = new Set<string>();

// Reset the pick counter per test so pick_numbers are deterministic.
function freshPicks(): void {
  pickCounter = 0;
}

// ---------------------------------------------------------------------------
// Stored draft order (league_draft_order) — nothing derives an order any more
// ---------------------------------------------------------------------------

Deno.test('orderFromRows: sorts by position, never by row arrival', () => {
  assertEquals(
    orderFromRows([
      { position: 3, user_id: 'carol' },
      { position: 1, user_id: 'bot-1' },
      { position: 2, user_id: 'alice' },
    ]),
    ['bot-1', 'alice', 'carol'],
  );
  assertEquals(orderFromRows([]), []);
});

Deno.test('checkStoredOrder: exact permutation of the members only', () => {
  const members = ['carol', 'alice', 'bot-1'];
  assertEquals(checkStoredOrder(['bot-1', 'carol', 'alice'], members), { ok: true });
  assertEquals(checkStoredOrder([], members), { ok: false, reason: 'missing' });
  assertEquals(checkStoredOrder(['carol', 'alice'], members), { ok: false, reason: 'not_permutation' }); // a member missing
  assertEquals(checkStoredOrder(['carol', 'alice', 'bot-1', 'dave'], members), { ok: false, reason: 'not_permutation' }); // a non-member
  assertEquals(checkStoredOrder(['carol', 'carol', 'alice'], members), { ok: false, reason: 'not_permutation' }); // dup hides a missing one
});

Deno.test('turn math reads the STORED order: a non-commissioner-first order is honored', () => {
  // commissioner 'carol' drafts third; the old derivation would have put her first.
  const order = ['bot-1', 'alice', 'carol'];
  assertEquals(currentTurn(0, order, 2)?.pickerId, 'bot-1');
  assertEquals(currentTurn(2, order, 2)?.pickerId, 'carol');
  assertEquals(currentTurn(3, order, 2)?.pickerId, 'carol'); // snake: round 2 starts from the end
  assertEquals(currentTurn(5, order, 2)?.pickerId, 'bot-1');
  assertEquals(validateSkip('carol', order, 0, 2), { legal: false, reason: 'not_your_turn' });
  assertEquals(validateSkip('bot-1', order, 0, 2), { legal: true, round: 1, pickNumber: 1 });
});

// ---------------------------------------------------------------------------
// Turn enforcement (snake)
// ---------------------------------------------------------------------------

Deno.test('currentTurn: snake order forward, reversed, forward across 3 rounds', () => {
  const order = ['a', 'b', 'c'];
  const expected = ['a', 'b', 'c', 'c', 'b', 'a', 'a', 'b', 'c'];
  for (let i = 0; i < expected.length; i++) {
    const t = currentTurn(i, order, 3);
    assert(t, `turn ${i} should exist`);
    assertEquals(t.pickerId, expected[i], `pick ${i + 1}`);
    assertEquals(t.pickNumber, i + 1);
    assertEquals(t.round, Math.floor(i / 3) + 1);
  }
  assertEquals(currentTurn(9, order, 3), null, 'draft complete after n*rounds picks');
});

Deno.test('validatePick: refuses when it is not the picker\'s turn', () => {
  freshPicks();
  const d = validatePick({
    rules: RULES_LEGACY,
    slots: [],
    order: ['a', 'b'],
    picks: [],
    trades: [],
    pickerId: 'b', // pick 1 belongs to 'a'
    symbol: 'AAPL',
    price: 100,
    eligibleCategories: NO_CATS,
  });
  assertEquals(d, { legal: false, reason: 'not_your_turn' });
});

Deno.test('validatePick: refuses when the draft is complete', () => {
  freshPicks();
  const picks = [pick('a', 'AAPL', 10), pick('b', 'MSFT', 10)];
  const d = validatePick({
    rules: rules({ numRounds: 1 }),
    slots: [],
    order: ['a', 'b'],
    picks,
    trades: [],
    pickerId: 'a',
    symbol: 'TSLA',
    price: 100,
    eligibleCategories: NO_CATS,
  });
  assertEquals(d, { legal: false, reason: 'draft_complete' });
});

Deno.test('turn enforcement: SKIP rows consume turns (turn math counts them)', () => {
  const order = ['a', 'bot-1', 'b'];
  // After a's pick and bot-1's skip, it is b's turn.
  const t = currentTurn(2, order, 2);
  assert(t);
  assertEquals(t.pickerId, 'b');
});

Deno.test('validateSkip: only the current picker\'s turn can be skipped', () => {
  const order = ['a', 'bot-1'];
  assertEquals(validateSkip('bot-1', order, 0, 2), { legal: false, reason: 'not_your_turn' });
  const ok = validateSkip('bot-1', order, 1, 2);
  assert(ok.legal);
  assertEquals(ok.pickNumber, 2);
});

// ---------------------------------------------------------------------------
// Duplicate-pick rejection + drop-frees-symbol
// ---------------------------------------------------------------------------

Deno.test('validatePick: rejects a symbol already drafted by ANYONE in the league', () => {
  freshPicks();
  const picks = [pick('a', 'AAPL', 100)];
  const d = validatePick({
    rules: RULES_LEGACY,
    slots: [],
    order: ['a', 'b'],
    picks,
    trades: [],
    pickerId: 'b',
    symbol: 'aapl', // case-insensitive
    price: 100,
    eligibleCategories: NO_CATS,
  });
  assertEquals(d, { legal: false, reason: 'symbol_owned' });
});

Deno.test('leagueOwnedSymbols: SKIP rows never count as ownership', () => {
  freshPicks();
  assertEquals(leagueOwnedSymbols([skipRow('a')], []).size, 0);
});

Deno.test('leagueOwnedSymbols: a full drop frees the symbol league-wide', () => {
  freshPicks();
  const picks = [pick('a', 'AAPL', 100)];
  const sold = [trade('a', 'AAPL', 'sell', 1, 110)];
  assert(leagueOwnedSymbols(picks, []).has('AAPL'));
  assertEquals(leagueOwnedSymbols(picks, sold).size, 0);
});

Deno.test('leagueOwnedSymbols: one user\'s sell cannot offset another user\'s holding', () => {
  freshPicks();
  // b holds AAPL via trade; a sells AAPL they acquired and re-sold earlier.
  const picks = [pick('a', 'AAPL', 100)];
  const trades = [
    trade('a', 'AAPL', 'sell', 1, 100), // a's position: 0
    trade('b', 'AAPL', 'buy', 1, 100), // b's position: 1
  ];
  assert(leagueOwnedSymbols(picks, trades).has('AAPL'), 'b still owns AAPL');
});

// ---------------------------------------------------------------------------
// Fixed-notional fractional quantities
// ---------------------------------------------------------------------------

Deno.test('fillQuantity: fixed_notional buys notional/price, fractional', () => {
  const r = rules({ stakeMode: 'fixed_notional', notionalPerSlot: 1000 });
  assertEquals(fillQuantity(r, 250), 4);
  assertEquals(fillQuantity(r, 333.33), Math.round((1000 / 333.33) * 1e6) / 1e6);
  // High-priced share -> fraction well below 1
  const q = fillQuantity(r, 4000);
  assertEquals(q, 0.25);
});

Deno.test('fillQuantity: rounds to 6 dp (week_snapshots numeric(12,6) precision)', () => {
  const r = rules({ stakeMode: 'fixed_notional', notionalPerSlot: 1000 });
  const q = fillQuantity(r, 3);
  assertEquals(q, 333.333333);
});

Deno.test('fillQuantity: tiers, cap and legacy modes are one share per pick', () => {
  assertEquals(fillQuantity(rules({ stakeMode: 'price_tiers' }), 999), 1);
  assertEquals(fillQuantity(rules({ stakeMode: 'budget_cap' }), 999), 1);
  assertEquals(fillQuantity(RULES_LEGACY, 999), 1);
});

Deno.test('validatePick: fixed_notional pick carries the fractional quantity', () => {
  freshPicks();
  const d = validatePick({
    rules: rules({ stakeMode: 'fixed_notional', notionalPerSlot: 1000 }),
    slots: [],
    order: ['a'],
    picks: [],
    trades: [],
    pickerId: 'a',
    symbol: 'BRK.A',
    price: 4000,
    eligibleCategories: NO_CATS,
  });
  assert(d.legal);
  assertEquals(d.quantity, 0.25);
});

// ---------------------------------------------------------------------------
// Tier bracket edges
// ---------------------------------------------------------------------------

const TIER_SLOTS: Slot[] = [
  slot('s-low', 0, { priceMin: null, priceMax: 50 }),
  slot('s-mid', 1, { priceMin: 50, priceMax: 200 }),
  slot('s-high', 2, { priceMin: 200, priceMax: null }),
];

Deno.test('assignSlot: price exactly at a bracket boundary is LEGAL (inclusive)', () => {
  // 50 fits s-low's ceiling (first fit by slot_index) AND s-mid's floor.
  assertEquals(assignSlot(TIER_SLOTS, [], 50, NO_CATS)?.id, 's-low');
  // With s-low occupied, 50 falls through to s-mid via its inclusive floor.
  assertEquals(assignSlot(TIER_SLOTS, ['s-low'], 50, NO_CATS)?.id, 's-mid');
  // 200 at s-mid's inclusive ceiling.
  assertEquals(assignSlot(TIER_SLOTS, ['s-low'], 200, NO_CATS)?.id, 's-mid');
});

Deno.test('assignSlot: price outside every unfilled bracket is refused', () => {
  // 30 only fits s-low; with s-low full there is no eligible slot.
  assertEquals(assignSlot(TIER_SLOTS, ['s-low'], 30, NO_CATS), null);
});

Deno.test('assignSlot: slotCount capacity is respected', () => {
  const slots = [slot('s2', 0, { slotCount: 2, priceMax: 100 })];
  assertEquals(assignSlot(slots, ['s2'], 50, NO_CATS)?.id, 's2', 'one of two filled');
  assertEquals(assignSlot(slots, ['s2', 's2'], 50, NO_CATS), null, 'both filled');
});

Deno.test('assignSlot: category slot requires eligibility (live as of Phase 4)', () => {
  const slots = [slot('s-cat', 0, { categoryId: 'cat-tech', priceMax: 100 })];
  // Eligible symbol fits; ineligible or unclassified (empty set) does not.
  assertEquals(assignSlot(slots, [], 50, new Set(['cat-tech']))?.id, 's-cat');
  assertEquals(assignSlot(slots, [], 50, new Set(['cat-food'])), null);
  assertEquals(assignSlot(slots, [], 50, NO_CATS), null);
});

Deno.test('assignSlot: unclassified symbol is flex-only; flex slot accepts anything', () => {
  const slots = [
    slot('s-cat', 0, { categoryId: 'cat-tech' }),
    slot('s-flex', 1), // no filter
  ];
  // Unclassified: skips the category slot, lands in flex.
  assertEquals(assignSlot(slots, [], 50, NO_CATS)?.id, 's-flex');
  // Eligible: prefers the earlier (category) slot by slot_index first-fit.
  assertEquals(assignSlot(slots, [], 50, new Set(['cat-tech']))?.id, 's-cat');
});

Deno.test('assignSlot: category + bracket are a conjunction', () => {
  const slots = [slot('s-cat', 0, { categoryId: 'cat-tech', priceMin: 100 })];
  assertEquals(assignSlot(slots, [], 50, new Set(['cat-tech'])), null, 'right category, wrong bracket');
  assertEquals(assignSlot(slots, [], 150, new Set(['cat-tech']))?.id, 's-cat');
});

Deno.test('effectiveCategoryIds: overrides REPLACE the rule; rule is the fallback; else empty', () => {
  assertEquals(effectiveCategoryIds(['a', 'b'], 'c'), new Set(['a', 'b']), 'overrides win outright');
  assertEquals(effectiveCategoryIds([], 'c'), new Set(['c']), 'rule fallback');
  assertEquals(effectiveCategoryIds([], null), new Set(), 'unclassified -> empty (flex-only)');
});

Deno.test('validatePick: multi-eligibility (override set) fits a category slot', () => {
  freshPicks();
  const slots = [slot('s-media', 0, { categoryId: 'cat-media' })];
  const d = validatePick({
    rules: rules({ stakeMode: 'price_tiers', numRounds: 1 }),
    slots,
    order: ['a'],
    picks: [],
    trades: [],
    pickerId: 'a',
    symbol: 'AMZN',
    price: 200,
    eligibleCategories: effectiveCategoryIds(['cat-retail', 'cat-tech', 'cat-media'], null),
  });
  assert(d.legal);
  assertEquals(d.slotId, 's-media');
});

Deno.test('validatePick: unclassified symbol refused when only category slots remain', () => {
  freshPicks();
  const slots = [slot('s-tech', 0, { categoryId: 'cat-tech' })];
  const d = validatePick({
    rules: rules({ stakeMode: 'price_tiers', numRounds: 1 }),
    slots,
    order: ['a'],
    picks: [],
    trades: [],
    pickerId: 'a',
    symbol: 'NEWIPO',
    price: 20,
    eligibleCategories: effectiveCategoryIds([], null),
  });
  assertEquals(d, { legal: false, reason: 'no_eligible_slot' });
});

Deno.test('validatePick: tiers league refuses a price no unfilled slot accepts', () => {
  freshPicks();
  const picks = [pick('a', 'CHEAP', 20, { slot_id: 's-low' })];
  const d = validatePick({
    rules: rules({ stakeMode: 'price_tiers', numRounds: 3 }),
    slots: TIER_SLOTS,
    order: ['a'],
    picks,
    trades: [],
    pickerId: 'a',
    symbol: 'PENNY',
    price: 30, // only fits s-low, already occupied
    eligibleCategories: NO_CATS,
  });
  assertEquals(d, { legal: false, reason: 'no_eligible_slot' });
});

// ---------------------------------------------------------------------------
// Cap-mode remaining budget across a full draft
// ---------------------------------------------------------------------------

Deno.test('budget_cap: remaining budget enforced across a full draft sequence', () => {
  freshPicks();
  const r = rules({ stakeMode: 'budget_cap', budgetAmount: 300, numRounds: 3 });
  const order = ['a', 'b'];
  const picks: PickRow[] = [];
  const draftFor = (who: string, sym: string, price: number) =>
    validatePick({ rules: r, slots: [], order, picks, trades: [], pickerId: who, symbol: sym, price, eligibleCategories: NO_CATS });

  // Round 1: a spends 150, b spends 100 (snake: a, b | b, a | a, b)
  let d = draftFor('a', 'AAA', 150);
  assert(d.legal);
  picks.push(pick('a', 'AAA', 150));
  d = draftFor('b', 'BBB', 100);
  assert(d.legal);
  picks.push(pick('b', 'BBB', 100));

  // Round 2 (reversed): b again. b has 200 left; 250 is over.
  d = draftFor('b', 'CCC', 250);
  assertEquals(d, { legal: false, reason: 'over_budget' });
  d = draftFor('b', 'CCC', 200); // exactly the remaining budget: legal
  assert(d.legal);
  picks.push(pick('b', 'CCC', 200));

  // a has 150 left.
  d = draftFor('a', 'DDD', 150.01);
  assertEquals(d, { legal: false, reason: 'over_budget' });
  d = draftFor('a', 'DDD', 150);
  assert(d.legal);
  picks.push(pick('a', 'DDD', 150));

  // Round 3: a is fully spent — every positive price is now over budget.
  d = draftFor('a', 'EEE', 0.01);
  assertEquals(d, { legal: false, reason: 'over_budget' });
});

Deno.test('userCashSpent: SKIP rows cost nothing; sells refund', () => {
  freshPicks();
  const picks = [pick('a', 'AAA', 100), skipRow('a')];
  assertEquals(userCashSpent('a', picks, []), 100);
  const trades = [trade('a', 'AAA', 'sell', 1, 90)];
  assertEquals(userCashSpent('a', picks, trades), 10);
});

// ---------------------------------------------------------------------------
// Add/drop trades
// ---------------------------------------------------------------------------

Deno.test('validateTradeAdd: refuses a symbol owned anywhere in the league', () => {
  freshPicks();
  const picks = [pick('b', 'AAPL', 100)];
  const d = validateTradeAdd({
    rules: rules({ numRounds: 3 }),
    slots: [],
    picks,
    trades: [],
    userId: 'a',
    symbol: 'AAPL',
    price: 100,
    eligibleCategories: NO_CATS,
  });
  assertEquals(d, { legal: false, reason: 'symbol_owned' });
});

Deno.test('validateTradeAdd: legal after a league-wide drop freed the symbol', () => {
  freshPicks();
  const picks = [pick('b', 'AAPL', 100)];
  const trades = [trade('b', 'AAPL', 'sell', 1, 105)];
  const d = validateTradeAdd({
    rules: rules({ numRounds: 3 }),
    slots: [],
    picks,
    trades,
    userId: 'a',
    symbol: 'AAPL',
    price: 100,
    eligibleCategories: NO_CATS,
  });
  assert(d.legal);
});

Deno.test('validateTradeAdd: roster_full until a drop frees a spot', () => {
  freshPicks();
  const r = rules({ numRounds: 2 });
  const picks = [pick('a', 'AAA', 10), pick('a', 'BBB', 10)];
  let d = validateTradeAdd({ rules: r, slots: [], picks, trades: [], userId: 'a', symbol: 'CCC', price: 10, eligibleCategories: NO_CATS });
  assertEquals(d, { legal: false, reason: 'roster_full' });
  const trades = [trade('a', 'BBB', 'sell', 1, 12)];
  d = validateTradeAdd({ rules: r, slots: [], picks, trades, userId: 'a', symbol: 'CCC', price: 10, eligibleCategories: NO_CATS });
  assert(d.legal);
});

Deno.test('validateTradeAdd: budget_cap counts sells as refunds', () => {
  freshPicks();
  const r = rules({ stakeMode: 'budget_cap', budgetAmount: 100, numRounds: 3 });
  const picks = [pick('a', 'AAA', 90)];
  // 90 spent, 10 left: a 20 add is over budget...
  let d = validateTradeAdd({ rules: r, slots: [], picks, trades: [], userId: 'a', symbol: 'BBB', price: 20, eligibleCategories: NO_CATS });
  assertEquals(d, { legal: false, reason: 'over_budget' });
  // ...until dropping AAA at 85 refunds: 100 - 90 + 85 = 95 available.
  const trades = [trade('a', 'AAA', 'sell', 1, 85)];
  d = validateTradeAdd({ rules: r, slots: [], picks, trades, userId: 'a', symbol: 'BBB', price: 20, eligibleCategories: NO_CATS });
  assert(d.legal);
});

Deno.test('validateTradeAdd: dropped pick frees its tier slot for the add', () => {
  freshPicks();
  const r = rules({ stakeMode: 'price_tiers', numRounds: 3 });
  const picks = [pick('a', 'CHEAP', 20, { slot_id: 's-low' })];
  // Slot occupied while CHEAP is held:
  let d = validateTradeAdd({ rules: r, slots: TIER_SLOTS, picks, trades: [], userId: 'a', symbol: 'PENNY', price: 30, eligibleCategories: NO_CATS });
  assertEquals(d, { legal: false, reason: 'no_eligible_slot' });
  // Dropping CHEAP frees s-low, so the 30 add fits:
  const trades = [trade('a', 'CHEAP', 'sell', 1, 21)];
  d = validateTradeAdd({ rules: r, slots: TIER_SLOTS, picks, trades, userId: 'a', symbol: 'PENNY', price: 30, eligibleCategories: NO_CATS });
  assert(d.legal);
});

Deno.test('validateTradeDrop: whole position, refused when not owned', () => {
  freshPicks();
  const picks = [pick('a', 'AAPL', 100, { quantity: 1 })];
  const trades = [trade('a', 'AAPL', 'buy', 0.5, 110)];
  const d = validateTradeDrop('a', 'AAPL', picks, trades);
  assert(d.legal);
  assertEquals(d.quantity, 1.5, 'drops the ENTIRE net position');
  assertEquals(validateTradeDrop('b', 'AAPL', picks, trades), { legal: false, reason: 'not_owned' });
});

Deno.test('validateTradeDrop: sub-rounding float residual is not a droppable position', () => {
  freshPicks();
  // Net position is a float residual below 5e-7: rounds to 0 at the 6-dp
  // precision actually written, so the drop must refuse rather than hand the
  // DB a quantity that violates CHECK (quantity > 0).
  const picks = [pick('a', 'AAPL', 100, { quantity: 1.0000001 })];
  const trades = [trade('a', 'AAPL', 'sell', 1, 100)];
  assertEquals(validateTradeDrop('a', 'AAPL', picks, trades), { legal: false, reason: 'not_owned' });
});

Deno.test('userNetHoldings: fractional quantities net exactly', () => {
  freshPicks();
  const picks = [pick('a', 'VOO', 400, { quantity: 2.5 })];
  const trades = [trade('a', 'VOO', 'sell', 2.5, 410)];
  assertEquals(userNetHoldings('a', picks, trades).size, 0);
});

// ---------------------------------------------------------------------------
// Mid-week add scoring — integration with snapshot-week-end/close.ts.
// Proves a trades row EXACTLY as record-trade writes it feeds the existing
// entered_mid_week mechanism: no fork, per the spec.
// ---------------------------------------------------------------------------

Deno.test('mid-week add: record-trade buy row produces the entered_mid_week snapshot', () => {
  // User a drafted AAPL (Monday row exists, priced). Mid-week, record-trade
  // adds MSFT: holdings gain MSFT, and a 'buy' trades row appears.
  const userHoldings = new Map<string, Holding[]>([
    ['a', [{ symbol: 'AAPL', quantity: 1 }, { symbol: 'MSFT', quantity: 2.5 }]],
  ]);
  const existing = [{
    id: 'snap-1',
    user_id: 'a',
    symbol: 'AAPL',
    quantity: 1,
    week_start_price: 100,
    week_end_price: null,
  }];
  const prices = new Map([['AAPL', 110], ['MSFT', 420]]);
  // The row shape record-trade inserts (user_id stringified, action 'buy'):
  const tradesRows = [{ user_id: 'a', symbol: 'MSFT', action: 'buy', quantity: 2.5, price: 400 }];

  const work = buildCloseWork('lg', 3, userHoldings, existing, prices, tradesRows);

  assertEquals(work.missingSymbols, []);
  assertEquals(work.updates, [{ id: 'snap-1', week_end_price: 110 }]);
  assertEquals(work.inserts, [{
    league_id: 'lg',
    user_id: 'a',
    week_number: 3,
    symbol: 'MSFT',
    quantity: 2.5,
    week_start_price: 400, // weighted entry from the buy trade
    entered_mid_week: true,
    week_end_price: 420,
  }]);
});

Deno.test('mid-week add: multiple buys weight the entry price (record-trade shape)', () => {
  const userHoldings = new Map<string, Holding[]>([
    ['a', [{ symbol: 'MSFT', quantity: 3 }]],
  ]);
  const prices = new Map([['MSFT', 500]]);
  const tradesRows = [
    { user_id: 'a', symbol: 'MSFT', action: 'buy', quantity: 1, price: 400 },
    { user_id: 'a', symbol: 'MSFT', action: 'buy', quantity: 2, price: 460 },
  ];
  const work = buildCloseWork('lg', 3, userHoldings, [], prices, tradesRows);
  assertEquals(work.inserts.length, 1);
  assertEquals(work.inserts[0].week_start_price, (400 * 1 + 460 * 2) / 3);
});

// ---------------------------------------------------------------------------
// is_draftable enforcement (DR-001 draftable universe + allow_undraftable
// commissioner override). The gate lives in the pure validator so it is tested
// here; the edge functions pass an EXPLICIT boolean read from symbols.
// ---------------------------------------------------------------------------

Deno.test('validatePick: a non-draftable symbol is refused by default', () => {
  freshPicks();
  const d = validatePick({
    rules: rules({ numRounds: 3 }), // allowUndraftable undefined -> false
    slots: [],
    order: ['a'],
    picks: [],
    trades: [],
    pickerId: 'a',
    symbol: 'PENNYX', // fresh + unowned: the not_draftable gate is what refuses
    price: 5,
    eligibleCategories: NO_CATS,
    isDraftable: false,
  });
  assertEquals(d, { legal: false, reason: 'not_draftable' });
});

Deno.test('validatePick: allow_undraftable override permits a non-draftable pick', () => {
  freshPicks();
  const d = validatePick({
    rules: rules({ numRounds: 3, allowUndraftable: true }),
    slots: [],
    order: ['a'],
    picks: [],
    trades: [],
    pickerId: 'a',
    symbol: 'PENNYX',
    price: 5,
    eligibleCategories: NO_CATS,
    isDraftable: false,
  });
  assert(d.legal);
});

Deno.test('validatePick: draftability is backward-compatible (undefined stays legal)', () => {
  freshPicks();
  // Edge functions always pass an explicit boolean; an OMITTED flag must never
  // refuse, so every pre-DR-001 test and call site keeps working.
  const d = validatePick({
    rules: rules({ numRounds: 3 }),
    slots: [],
    order: ['a'],
    picks: [],
    trades: [],
    pickerId: 'a',
    symbol: 'AAPL',
    price: 100,
    eligibleCategories: NO_CATS,
    // isDraftable omitted
  });
  assert(d.legal);
});

Deno.test('validateTradeAdd: a non-draftable buy is refused by default', () => {
  freshPicks();
  const d = validateTradeAdd({
    rules: rules({ numRounds: 3 }),
    slots: [],
    picks: [],
    trades: [],
    userId: 'a',
    symbol: 'PENNYX',
    price: 5,
    eligibleCategories: NO_CATS,
    isDraftable: false,
  });
  assertEquals(d, { legal: false, reason: 'not_draftable' });
});

Deno.test('validateTradeAdd: allow_undraftable override permits a non-draftable buy', () => {
  freshPicks();
  const d = validateTradeAdd({
    rules: rules({ numRounds: 3, allowUndraftable: true }),
    slots: [],
    picks: [],
    trades: [],
    userId: 'a',
    symbol: 'PENNYX',
    price: 5,
    eligibleCategories: NO_CATS,
    isDraftable: false,
  });
  assert(d.legal);
});

// ---------------------------------------------------------------------------
// fixed_notional slot proceeds (2026-09-29 product rule): a rebuy reinvests
// exactly the SALE PROCEEDS of the slot it fills, not a fresh notional stake.
// See fixedNotionalFunding/resolveFunding above draft-validation.ts and the
// migration header at
// supabase/migrations/20261006000000_trades_funded_by_trade_id.sql.
// ---------------------------------------------------------------------------

const FN_RULES = (over: Partial<LeagueRules> = {}) =>
  rules({ stakeMode: 'fixed_notional', notionalPerSlot: 2000, numRounds: 3, ...over });

Deno.test('fixedNotionalFunding: a full sell opens proceeds at its stored price × quantity', () => {
  const picks = [pick('a', 'AAPL', 160, { quantity: 12.5 })];
  const trades = [trade('a', 'AAPL', 'sell', 12.5, 120, { id: 't-sell-1', created_at: '2026-10-05T10:00:00Z' })];
  const funding = fixedNotionalFunding('a', picks, trades);
  assertEquals(funding, { open: [{ tradeId: 't-sell-1', symbol: 'AAPL', amount: 1500 }], unfilledSlots: 0 });
});

Deno.test('fixedNotionalFunding: prefers the row\'s stored total_value over re-derived price × quantity', () => {
  const picks = [pick('a', 'AAPL', 160, { quantity: 12.5 })];
  // A contrived mismatch: total_value (what was actually recorded, rounded to
  // cents) differs slightly from price*quantity (what re-deriving would give).
  // The stored value must win — it's the sale's own recorded proceeds.
  const trades = [
    trade('a', 'AAPL', 'sell', 12.5, 120, { id: 't-sell-1', created_at: '2026-10-05T10:00:00Z', total_value: 1499.99 }),
  ];
  const funding = fixedNotionalFunding('a', picks, trades);
  assertEquals(funding.open, [{ tradeId: 't-sell-1', symbol: 'AAPL', amount: 1499.99 }]);
});

Deno.test('fixedNotionalFunding: falls back to price × quantity when total_value is absent (hermetic test shape)', () => {
  const picks = [pick('a', 'AAPL', 160, { quantity: 12.5 })];
  const trades = [trade('a', 'AAPL', 'sell', 12.5, 120, { id: 't-sell-1', created_at: '2026-10-05T10:00:00Z' })];
  assertEquals(fixedNotionalFunding('a', picks, trades).open[0].amount, 1500);
});

Deno.test('fixedNotionalFunding: two sells stay open in FIFO (chronological, not array) order', () => {
  const picks = [pick('a', 'AAA', 100, { quantity: 20 }), pick('a', 'BBB', 100, { quantity: 20 })];
  const trades = [
    // Listed newest-first; the walk must still resolve chronologically.
    trade('a', 'BBB', 'sell', 20, 90, { id: 't-2', created_at: '2026-10-05T12:00:00Z' }),
    trade('a', 'AAA', 'sell', 20, 80, { id: 't-1', created_at: '2026-10-05T09:00:00Z' }),
  ];
  const funding = fixedNotionalFunding('a', picks, trades);
  assertEquals(funding.open.map((o) => o.tradeId), ['t-1', 't-2']);
});

Deno.test('fixedNotionalFunding: a voluntary SKIP is an unfilled slot until a NULL-linked buy claims it', () => {
  const picks = [pick('a', 'AAA', 100, { quantity: 20 }), skipRow('a'), skipRow('a')];
  assertEquals(fixedNotionalFunding('a', picks, []), { open: [], unfilledSlots: 2 });

  const trades = [trade('a', 'BBB', 'buy', 20, 100, { created_at: '2026-10-05T09:00:00Z' })];
  assertEquals(fixedNotionalFunding('a', picks, trades).unfilledSlots, 1);
});

Deno.test('fixedNotionalFunding: an explicit funded_by_trade_id consumes exactly that sale, not FIFO order', () => {
  const picks = [pick('a', 'AAA', 100, { quantity: 20 }), pick('a', 'BBB', 100, { quantity: 20 })];
  const trades = [
    trade('a', 'AAA', 'sell', 20, 80, { id: 't-1', created_at: '2026-10-05T09:00:00Z' }),
    trade('a', 'BBB', 'sell', 20, 90, { id: 't-2', created_at: '2026-10-05T10:00:00Z' }),
    // Explicitly claims t-2 even though t-1 is the FIFO default.
    trade('a', 'CCC', 'buy', 18, 100, { created_at: '2026-10-05T11:00:00Z', funded_by_trade_id: 't-2' }),
  ];
  assertEquals(fixedNotionalFunding('a', picks, trades).open.map((o) => o.tradeId), ['t-1']);
});

Deno.test('fixedNotionalFunding: a pre-fix anomaly buy (no proceeds, no unfilled slot) consumes nothing', () => {
  // A fully-drafted roster, no sale at all, yet a NULL-linked buy row exists
  // — only reachable from the OLD bug (an overbuy with no legality gate).
  // The walk must not crash or fabricate a consumption for it.
  const picks = [pick('a', 'AAA', 100), pick('a', 'BBB', 100), pick('a', 'CCC', 100)];
  const trades = [trade('a', 'DDD', 'buy', 20, 100, { created_at: '2026-10-05T09:00:00Z' })];
  assertEquals(fixedNotionalFunding('a', picks, trades), { open: [], unfilledSlots: 0 });
});

Deno.test('resolveFunding: reinvest proceeds first even when an unfilled slot also exists', () => {
  const state = { open: [{ tradeId: 't-1', symbol: 'AAA', amount: 1500 }], unfilledSlots: 1 };
  assertEquals(resolveFunding(state, 2000), {
    ok: true,
    source: { kind: 'proceeds', tradeId: 't-1', amount: 1500 },
  });
});

Deno.test('resolveFunding: an unfilled slot funds a fresh buy at full notional once proceeds run out', () => {
  assertEquals(resolveFunding({ open: [], unfilledSlots: 1 }, 2000), {
    ok: true,
    source: { kind: 'unfilled_slot', amount: 2000 },
  });
});

Deno.test('resolveFunding: an explicit sold_trade_id not among open proceeds is proceeds_unavailable', () => {
  const state = { open: [{ tradeId: 't-1', symbol: 'AAA', amount: 1500 }], unfilledSlots: 0 };
  assertEquals(resolveFunding(state, 2000, 't-does-not-exist'), { ok: false, reason: 'proceeds_unavailable' });
  assertEquals(resolveFunding({ open: [], unfilledSlots: 1 }, 2000, 't-1'), { ok: false, reason: 'proceeds_unavailable' });
});

Deno.test('resolveFunding: no open proceeds and no unfilled slot is no_proceeds', () => {
  assertEquals(resolveFunding({ open: [], unfilledSlots: 0 }, 2000), { ok: false, reason: 'no_proceeds' });
});

Deno.test('validateTradeAdd fixed_notional: sell at a LOSS sizes the rebuy off the actual proceeds', () => {
  freshPicks();
  // Slot started at $2,000 (this test only needs the sale, not the original
  // draft cost); sold for $1,500. The rebuy must be $1,500 of NVDA, not $2,000.
  const picks = [pick('a', 'AAPL', 140, { quantity: 12.5 })];
  const trades = [trade('a', 'AAPL', 'sell', 12.5, 120, { id: 't-sell', created_at: '2026-10-05T10:00:00Z' })];
  const d = validateTradeAdd({
    rules: FN_RULES(), slots: [], picks, trades, userId: 'a', symbol: 'NVDA', price: 100, eligibleCategories: NO_CATS,
  });
  assertEquals(d, { legal: true, quantity: 15, fundedByTradeId: 't-sell', stakeAmount: 1500 });
});

Deno.test('validateTradeAdd fixed_notional: sell at a GAIN sizes the rebuy ABOVE a fresh notional stake', () => {
  freshPicks();
  // Sold for $2,500 — the $2,000 notional is NOT a ceiling on reinvestment.
  const picks = [pick('a', 'AAPL', 180, { quantity: 10 })];
  const trades = [trade('a', 'AAPL', 'sell', 10, 250, { id: 't-sell', created_at: '2026-10-05T10:00:00Z' })];
  const d = validateTradeAdd({
    rules: FN_RULES(), slots: [], picks, trades, userId: 'a', symbol: 'MSFT', price: 250, eligibleCategories: NO_CATS,
  });
  assertEquals(d, { legal: true, quantity: 10, fundedByTradeId: 't-sell', stakeAmount: 2500 });
});

Deno.test('validateTradeAdd fixed_notional: two freed slots — the caller picks which sale funds the buy', () => {
  freshPicks();
  const picks = [pick('a', 'AAA', 100, { quantity: 20 }), pick('a', 'BBB', 100, { quantity: 20 })];
  const trades = [
    trade('a', 'AAA', 'sell', 20, 80, { id: 't-aaa', created_at: '2026-10-05T09:00:00Z' }), // proceeds $1,600
    trade('a', 'BBB', 'sell', 20, 120, { id: 't-bbb', created_at: '2026-10-05T10:00:00Z' }), // proceeds $2,400
  ];
  // Explicitly reinvests BBB's proceeds even though AAA's is the FIFO default.
  const d = validateTradeAdd({
    rules: FN_RULES(), slots: [], picks, trades, userId: 'a', symbol: 'NVDA', price: 100, eligibleCategories: NO_CATS,
    soldTradeId: 't-bbb',
  });
  assertEquals(d, { legal: true, quantity: 24, fundedByTradeId: 't-bbb', stakeAmount: 2400 });
});

Deno.test('validateTradeAdd fixed_notional: an omitted sold_trade_id defaults to FIFO (the oldest sale)', () => {
  freshPicks();
  const picks = [pick('a', 'AAA', 100, { quantity: 20 }), pick('a', 'BBB', 100, { quantity: 20 })];
  const trades = [
    trade('a', 'AAA', 'sell', 20, 80, { id: 't-aaa', created_at: '2026-10-05T09:00:00Z' }), // oldest, proceeds $1,600
    trade('a', 'BBB', 'sell', 20, 120, { id: 't-bbb', created_at: '2026-10-05T10:00:00Z' }),
  ];
  const d = validateTradeAdd({
    rules: FN_RULES(), slots: [], picks, trades, userId: 'a', symbol: 'NVDA', price: 100, eligibleCategories: NO_CATS,
  });
  assertEquals(d, { legal: true, quantity: 16, fundedByTradeId: 't-aaa', stakeAmount: 1600 });
});

Deno.test('validateTradeAdd fixed_notional: an unfilled draft slot (voluntary skip) funds a fresh buy at full notional', () => {
  freshPicks();
  const picks = [pick('a', 'AAA', 100, { quantity: 20 }), skipRow('a')];
  const d = validateTradeAdd({
    rules: FN_RULES(), slots: [], picks, trades: [], userId: 'a', symbol: 'NVDA', price: 100, eligibleCategories: NO_CATS,
  });
  assertEquals(d, { legal: true, quantity: 20, fundedByTradeId: null, stakeAmount: 2000 });
});

Deno.test('validateTradeAdd fixed_notional: with open proceeds AND an unfilled slot, the buy must reinvest proceeds', () => {
  freshPicks();
  const picks = [pick('a', 'AAA', 100, { quantity: 20 }), skipRow('a')];
  const trades = [trade('a', 'AAA', 'sell', 20, 75, { id: 't-aaa', created_at: '2026-10-05T09:00:00Z' })]; // proceeds $1,500
  const d = validateTradeAdd({
    rules: FN_RULES(), slots: [], picks, trades, userId: 'a', symbol: 'NVDA', price: 100, eligibleCategories: NO_CATS,
  });
  // Sized from the $1,500 proceeds, NOT the $2,000 unfilled-slot notional.
  assertEquals(d, { legal: true, quantity: 15, fundedByTradeId: 't-aaa', stakeAmount: 1500 });
});

Deno.test('validateTradeAdd fixed_notional: roster_full refuses BEFORE funding is even considered', () => {
  freshPicks();
  const picks = [pick('a', 'AAA', 100, { quantity: 20 }), pick('a', 'BBB', 100, { quantity: 20 })];
  const d = validateTradeAdd({
    rules: FN_RULES({ numRounds: 2 }), slots: [], picks, trades: [], userId: 'a', symbol: 'CCC', price: 100, eligibleCategories: NO_CATS,
  });
  assertEquals(d, { legal: false, reason: 'roster_full' });
});

Deno.test('validateTradeAdd fixed_notional: a foreign or already-spent sold_trade_id is proceeds_unavailable', () => {
  freshPicks();
  const picks = [pick('a', 'AAA', 100, { quantity: 20 })];
  const trades = [trade('a', 'AAA', 'sell', 20, 80, { id: 't-aaa', created_at: '2026-10-05T09:00:00Z' })];
  const d = validateTradeAdd({
    rules: FN_RULES(), slots: [], picks, trades, userId: 'a', symbol: 'NVDA', price: 100, eligibleCategories: NO_CATS,
    soldTradeId: 't-not-mine',
  });
  assertEquals(d, { legal: false, reason: 'proceeds_unavailable' });
});

Deno.test('validateTradeAdd fixed_notional: no open proceeds and no unfilled slot is no_proceeds', () => {
  freshPicks();
  const picks = [pick('a', 'AAA', 100, { quantity: 20 }), pick('a', 'BBB', 100, { quantity: 20 })];
  const trades = [
    trade('a', 'BBB', 'sell', 20, 90, { id: 't-bbb', created_at: '2026-10-05T09:00:00Z' }),
    // Already claims the only proceeds — nothing left open, and there was
    // never an unfilled (skipped) slot on this fully-drafted roster.
    trade('a', 'CCC', 'buy', 18, 100, { created_at: '2026-10-05T10:00:00Z', funded_by_trade_id: 't-bbb' }),
  ];
  const d = validateTradeAdd({
    rules: FN_RULES(), slots: [], picks, trades, userId: 'a', symbol: 'NVDA', price: 100, eligibleCategories: NO_CATS,
  });
  assertEquals(d, { legal: false, reason: 'no_proceeds' });
});

Deno.test('validateTradeAdd: fixed_notional-only decision fields are absent in every other stake mode', () => {
  freshPicks();
  const modes: Array<Partial<LeagueRules>> = [
    {}, // legacy (stakeMode: null)
    { stakeMode: 'price_tiers' },
    { stakeMode: 'budget_cap', budgetAmount: 1000 },
  ];
  for (const over of modes) {
    const d = validateTradeAdd({
      rules: rules({ numRounds: 3, ...over }),
      slots: [],
      picks: [],
      trades: [],
      userId: 'a',
      symbol: 'AAA',
      price: 100,
      eligibleCategories: NO_CATS,
    });
    assert(d.legal, JSON.stringify(over));
    assertEquals(d, { legal: true, quantity: 1 });
  }
});

// ---------------------------------------------------------------------------
// Slot-feasibility coverage gate — the SAME predicate the clients use to decide
// whether per-slot counts are trustworthy. Proves counts DISPLAY at full
// coverage (partial=false) and are suppressed only while coverage is genuinely
// partial or unknown. Threshold is a named constant, not a magic number.
// ---------------------------------------------------------------------------

Deno.test('coverageIsPartial: full coverage is NOT partial (counts display)', () => {
  // ~100% coverage, the current production state (14,453 enriched of 14,453).
  assertEquals(coverageIsPartial(14453, 14453), false);
  // Just above the threshold also displays.
  assertEquals(coverageIsPartial(9100, 10000), false);
  // Exactly AT the threshold is not partial (strict < in the predicate).
  assertEquals(coverageIsPartial(9000, 10000), false);
});

Deno.test('coverageIsPartial: below-threshold or unknown coverage IS partial (suppressed)', () => {
  // Below 90% coverage -> lower-bound noise, suppress.
  assertEquals(coverageIsPartial(8999, 10000), true);
  assertEquals(coverageIsPartial(0, 10000), true);
  // total 0 (no universe loaded yet) is partial, never a divide-by-zero.
  assertEquals(coverageIsPartial(0, 0), true);
});

Deno.test('coverageIsPartial: honors the named threshold constant', () => {
  assertEquals(ENRICHMENT_COVERAGE_THRESHOLD, 0.9);
  const total = 1000;
  const atThreshold = total * ENRICHMENT_COVERAGE_THRESHOLD; // 900
  assertEquals(coverageIsPartial(atThreshold, total), false, 'exactly at threshold displays');
  assertEquals(coverageIsPartial(atThreshold - 1, total), true, 'one below threshold suppresses');
});
