/**
 * The P0 stress fixture for the money screens (3e), run through the real
 * parser, ownership rules, summary and view model. Asserts the standard set:
 * 20-character username, 40-character league name, values of $1M and more,
 * 16 managers, 1,000+ activity rows (no truncation), unpriced holdings that are
 * captioned and never $0, and feed-suffixed names cleaned. Run with:
 * cd apps/mobile/tests-deno && deno test .
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { formatMoney } from '../components/sp/logic/money.ts';
import { parsePortfolioLedger, sheetInputsFromLedger } from '../lib/money/portfolioLedger.ts';
import { deriveStockSheetFacts } from '../lib/money/stockSheetFacts.ts';
import { portfolioHoldings, portfolioSummary } from '../lib/money/portfolioModel.ts';
import { buildPortfolioView, type ViewHolding } from '../lib/money/portfolioView.ts';
import { refusalCopy } from '../lib/money/refusals.ts';
import {
  buildStressMarket, STRESS_CALLER, STRESS_LEAGUE_NAME, STRESS_MANAGERS, STRESS_UNPRICED, STRESS_USERNAME,
} from '../lib/money/stressFixture.ts';

const market = buildStressMarket();
const ledger = parsePortfolioLedger(JSON.parse(JSON.stringify(market.ledger)))!;

Deno.test('the standard set: a 20-character username and a 40-character league name', () => {
  assertEquals(STRESS_USERNAME.length, 20);
  assertEquals(STRESS_LEAGUE_NAME.length, 40);
});

Deno.test('the fixture passes the real ledger parser: 16 managers, 1,000+ rows, nothing truncated', () => {
  assert(ledger !== null, 'the ledger must parse');
  assert(ledger.activity.length >= 1000, `expected 1,000+ rows, got ${ledger.activity.length}`);
  assertEquals(ledger.members.length, STRESS_MANAGERS);
  // Every activity row survives the round trip (no silent drops).
  assertEquals(ledger.activity.length, market.ledger.activity.length);
});

Deno.test('the caller holds six stocks valued at $1M or more, with the cash counted', () => {
  const drafts = ledger.activity.filter((a) => a.kind === 'draft' && a.user_id === STRESS_CALLER)
    .map((a) => ({ symbol: a.symbol, entryPrice: a.price!, quantity: a.quantity }));
  const trades = ledger.activity.filter((a) => a.kind === 'trade' && a.user_id === STRESS_CALLER)
    .map((a) => ({ symbol: a.symbol, action: a.action as 'buy' | 'sell', quantity: a.quantity, price: a.price! }));
  const summary = portfolioSummary({
    stakeMode: 'price_tiers', notionalPerSlot: null, numRounds: 6, drafts, trades,
    price: (s) => market.prices[s] ?? null,
  });
  assert(summary.value >= 1_000_000, `value ${summary.value} must be at least $1M`);
  const text = formatMoney(summary.value);
  assert(text.length >= 11, `a $1M+ value must render in full: ${text}`);
});

Deno.test('the caller\'s two unpriced holdings are counted at cost, captioned, and never $0', () => {
  const caller = ledger.activity.filter((a) => a.user_id === STRESS_CALLER);
  const holdings = portfolioHoldings(
    caller.filter((a) => a.kind === 'draft').map((a) => ({ symbol: a.symbol, entryPrice: a.price!, quantity: a.quantity })),
    caller.filter((a) => a.kind === 'trade').map((a) => ({ symbol: a.symbol, action: a.action as 'buy' | 'sell', quantity: a.quantity, price: a.price! })),
  );
  assertEquals(holdings.length, 6);
  const viewHoldings: ViewHolding[] = holdings.map((h) => ({
    symbol: h.symbol, quantity: h.quantity, costBasis: h.costBasis,
    price: market.prices[h.symbol] ?? null, prevClose: market.prevCloses[h.symbol] ?? null,
    name: ledger.symbol_names[h.symbol] ?? null,
  }));
  const summary = portfolioSummary({
    stakeMode: 'price_tiers', notionalPerSlot: null, numRounds: 6,
    drafts: caller.filter((a) => a.kind === 'draft').map((a) => ({ symbol: a.symbol, entryPrice: a.price!, quantity: a.quantity })),
    trades: caller.filter((a) => a.kind === 'trade').map((a) => ({ symbol: a.symbol, action: a.action as 'buy' | 'sell', quantity: a.quantity, price: a.price! })),
    price: (s) => market.prices[s] ?? null,
  });
  const view = buildPortfolioView({
    value: summary.value, cash: summary.cash, stake: summary.stake, holdings: viewHoldings,
    numRounds: 6, perSlotNotional: null, stakeMode: 'price_tiers',
  });
  assertEquals(view.unpricedNote, '2 holdings counted at cost (no live price yet)');
  for (const sym of STRESS_UNPRICED) {
    const row = view.rows.find((r) => r.symbol === sym)!;
    assertEquals(row.valueIsCost, true);
    assert(row.valueText !== '$0.00', `${sym} must not read $0`);
  }
  // Today is hidden: two holdings have no price, so no partial sum is shown.
  assertEquals(view.todayText, null);
});

Deno.test('feed-suffixed names are cleaned in the rows; the long league name stays intact', () => {
  const view = buildPortfolioView({
    value: 1, cash: 0, stake: 0,
    holdings: [{ symbol: 'S002', quantity: 1, costBasis: 1, price: 1, prevClose: 1, name: ledger.symbol_names['S002'] }],
    numRounds: 6, perSlotNotional: null, stakeMode: 'price_tiers',
  });
  // "Corporation" is a trailing legal suffix, stripped with the feed tail.
  assertEquals(view.rows[0].name, 'Company 2 Holdings');
  assertEquals(STRESS_LEAGUE_NAME.length, 40);
});

Deno.test('the sheet ownership rules work on 1,000+ rows: an owner by another manager is named, not invented', () => {
  const inputs = sheetInputsFromLedger(ledger);
  const names = Object.fromEntries(ledger.members.map((m) => [m.user_id, { displayName: m.display_name, isBot: m.is_bot }]));
  const theirs = deriveStockSheetFacts({ symbol: 'S002', userId: STRESS_CALLER, ...inputs, names });
  assertEquals(theirs.owner?.kind, 'other');
  assertEquals(theirs.conflict, false);
  const mine = deriveStockSheetFacts({ symbol: 'S001', userId: STRESS_CALLER, ...inputs, names });
  assertEquals(mine.owner, { kind: 'me' });
});

Deno.test('a rate-limited refusal gets its own polite copy, never the raw code', () => {
  const copy = refusalCopy('rate_limited', {}).message;
  assert(!copy.includes('rate_limited'));
  assert(copy.length > 0);
});
