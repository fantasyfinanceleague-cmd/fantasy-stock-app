/**
 * Hermetic tests for lib/money/stockSheetModel.ts: the stock sheet's decisions
 * (3e). Run with: cd apps/mobile/tests-deno && deno test .
 *
 * Pinned rules:
 *   - held → Sell is selected, and the sell summary is "Sell all X sh ≈ $Y".
 *   - free and open → Buy is selected and enabled.
 *   - owned by another manager → Buy disabled with "Owned by {name}".
 *   - market closed → both actions disabled, with the open time.
 *   - unknown price → the action is disabled, never a $0 figure.
 */
import { assertEquals } from 'jsr:@std/assert';
import { stockSheetModel, type StockSheetInput } from '../lib/money/stockSheetModel.ts';

const BASE: StockSheetInput = {
  symbol: 'NVDA',
  companyName: 'NVIDIA Corporation - Common Stock',
  price: 318.37,
  prevClose: 306.68,
  held: null,
  owner: null,
  draft: null,
  gate: { open: true },
  leagueName: 'Stock Scudetto',
  lastCloseLabel: "Friday's close",
};

Deno.test('held: Sell is pre-selected and the sell summary is the whole position', () => {
  const m = stockSheetModel({
    ...BASE,
    held: { quantity: 6.8942 },
    owner: { kind: 'me' },
    draft: { round: 1, inRoundPick: 2 },
  });
  assertEquals(m.selected, 'sell');
  assertEquals(m.sell.enabled, true);
  assertEquals(m.sell.summary, 'Sell all 6.8942 sh ≈ $2,194.91');
  assertEquals(m.ownershipLine, 'Drafted by you · Round 1, pick 2');
});

Deno.test('free and open: Buy is selected and enabled, with no owner line', () => {
  const m = stockSheetModel({ ...BASE, owner: null });
  assertEquals(m.selected, 'buy');
  assertEquals(m.buy, { enabled: true, reason: null, blockedBy: null });
  assertEquals(m.ownershipLine, 'No one in Stock Scudetto owns NVDA');
});

Deno.test('owned by another manager: Buy disabled with the owner named, blockedBy owned', () => {
  const m = stockSheetModel({ ...BASE, owner: { kind: 'other', name: 'Paolo M.', isBot: false } });
  assertEquals(m.buy.enabled, false);
  assertEquals(m.buy.reason, 'Owned by Paolo M.');
  assertEquals(m.buy.blockedBy, 'owned');
  assertEquals(m.ownershipLine, 'Owned by Paolo M.');
});

Deno.test('blockedBy names the first failing rule: closed beats owned, price beats held', () => {
  const closedAndOwned = stockSheetModel({ ...BASE, owner: { kind: 'other', name: 'X', isBot: false }, gate: { open: false, opensLabel: null } });
  assertEquals(closedAndOwned.buy.blockedBy, 'closed');
  const unpricedAndHeld = stockSheetModel({ ...BASE, price: null, held: { quantity: 1 } });
  assertEquals(unpricedAndHeld.buy.blockedBy, 'price');
});

Deno.test('owned by a bot: the badge is carried so the sheet can show it', () => {
  const m = stockSheetModel({ ...BASE, owner: { kind: 'other', name: 'Bot Rico', isBot: true } });
  assertEquals(m.ownerBadge, 'Bot');
});

Deno.test('market closed: both actions disabled, with the opening time, and the sheet still informs', () => {
  const m = stockSheetModel({ ...BASE, held: { quantity: 2 }, owner: { kind: 'me' }, gate: { open: false, opensLabel: 'Mon 9:30 AM ET' } });
  assertEquals(m.buy.enabled, false);
  assertEquals(m.sell.enabled, false);
  assertEquals(m.buy.reason, 'Trading opens Mon 9:30 AM ET.');
  assertEquals(m.sell.reason, 'Trading opens Mon 9:30 AM ET.');
  assertEquals(m.marketNote, "Prices show Friday's close.");
});

Deno.test('market closed with no known next open: the unavailable line, never a guessed time', () => {
  const m = stockSheetModel({ ...BASE, gate: { open: false, opensLabel: null } });
  assertEquals(m.buy.reason, 'Trading hours unavailable. Try again shortly.');
});

Deno.test('market open: no market note', () => {
  assertEquals(stockSheetModel(BASE).marketNote, null);
});

Deno.test('unknown price: the action is disabled, the sell summary is not invented', () => {
  const m = stockSheetModel({ ...BASE, price: null, held: { quantity: 3 }, owner: { kind: 'me' } });
  assertEquals(m.sell.enabled, false);
  assertEquals(m.sell.summary, null);
  assertEquals(m.sell.reason, "We can't price this stock right now. Try again shortly.");
});

Deno.test('held without a draft row (bought later): "Held by you", flagged copy', () => {
  const m = stockSheetModel({ ...BASE, held: { quantity: 1 }, owner: { kind: 'me' }, draft: null });
  assertEquals(m.ownershipLine, 'Held by you');
});

Deno.test('today change: per-share move and percent; null without a prior close', () => {
  const today = stockSheetModel(BASE).todayChange;
  assertEquals(today?.perShare.toFixed(2), '11.69');
  assertEquals(today?.pct.toFixed(2), '3.81');
  assertEquals(stockSheetModel({ ...BASE, prevClose: null }).todayChange, null);
});

// ── W4 defect (a): the buy review could offer a buy the server refused as over_budget ──
// record-trade's preview `would_fill` ignores the budget (commit.ts slotPreview: "minus the
// budget/roster checks (the client shows those itself)"), so the CLIENT must refuse first.

Deno.test('budget: a share that costs more than the budget left is refused BEFORE the review', () => {
  const m = stockSheetModel({ ...BASE, budgetLeft: 318.36 });
  assertEquals(m.buy, { enabled: false, reason: 'NVDA costs more than your budget left.', blockedBy: 'budget' });
});

Deno.test('budget: exactly the budget left is a legal buy (the server refuses only spent + price > cap)', () => {
  assertEquals(stockSheetModel({ ...BASE, budgetLeft: 318.37 }).buy.enabled, true);
  assertEquals(stockSheetModel({ ...BASE, budgetLeft: 5000 }).buy.enabled, true);
});

Deno.test('budget: a $0 cap (NULL budget_amount, defect d) refuses every buy; no budget (other modes) refuses none', () => {
  assertEquals(stockSheetModel({ ...BASE, budgetLeft: 0 }).buy.blockedBy, 'budget');
  assertEquals(stockSheetModel({ ...BASE, budgetLeft: -12.5 }).buy.blockedBy, 'budget');
  assertEquals(stockSheetModel({ ...BASE, budgetLeft: null }).buy.enabled, true);
});

Deno.test('budget: an earlier rule still names the block (owned beats budget; unpriced never compares)', () => {
  assertEquals(stockSheetModel({ ...BASE, budgetLeft: 1, owner: { kind: 'other', name: 'Paolo M.', isBot: false } }).buy.blockedBy, 'owned');
  assertEquals(stockSheetModel({ ...BASE, budgetLeft: 1, price: null }).buy.blockedBy, 'price');
});

Deno.test('roster full: Buy disabled with the roster reason, ahead of the budget', () => {
  const m = stockSheetModel({ ...BASE, rosterFull: true, budgetLeft: 1 });
  assertEquals(m.buy, { enabled: false, reason: 'Your roster is full. Sell a holding first.', blockedBy: 'full' });
});
