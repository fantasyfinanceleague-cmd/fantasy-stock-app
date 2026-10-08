/**
 * Hermetic tests for the 3e trade rules (Phase 3e): the U2 trade gate
 * (fail-closed), the available-cash decision per stake mode, the record-trade
 * outcome reader, the refusal copy map, and the "opens" label. Run with:
 *
 *   cd apps/mobile/tests-deno && deno test .
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { decideTradeGate, type MarketStatusRow } from '../lib/money/tradeGate.ts';
import { buyingPower, type BuyingPowerLeague, type BuyingPowerPreview } from '../lib/money/buyingPower.ts';
import { readRecordTradeOutcome } from '../lib/money/recordTradeOutcome.ts';
import { refusalCopy } from '../lib/money/refusals.ts';
import { marketOpensLabel } from '../lib/money/marketOpensLabel.ts';
import { buyQuantity } from '../lib/money/buyQuantity.ts';
import { formatShares } from '../lib/money/formatShares.ts';
import { JPM_PROCEEDS } from './fixtures/jpm-sale.ts';

// ---- U2 trade gate -------------------------------------------------------

const OPEN_ROW: MarketStatusRow = {
  status: 'open',
  session_open_at: '2026-10-05T13:30:00Z', // 9:30 EDT
  session_close_at: '2026-10-05T20:00:00Z', // 4:00 PM EDT
  next_open_at: null,
};
const CLOSED_ROW: MarketStatusRow = {
  status: 'closed',
  session_open_at: null,
  session_close_at: null,
  next_open_at: '2026-10-06T13:30:00Z', // Tue 9:30 AM EDT
};

Deno.test('trade gate: open inside the session, closed at the exclusive close', () => {
  assertEquals(decideTradeGate(new Date('2026-10-05T15:00:00Z'), OPEN_ROW).open, true);
  // Exclusive close: exactly 4:00 PM ET is already closed for trading.
  const atClose = decideTradeGate(new Date('2026-10-05T20:00:00Z'), OPEN_ROW);
  assertEquals(atClose.open, false);
  assertEquals((atClose as { stale: boolean }).stale, true); // row is stale: host refetches
});

Deno.test('trade gate: the 2026-11-27 half day closes at 1:00 PM ET, from the calendar row', () => {
  // EST after the DST change: 1:00 PM ET = 18:00Z.
  const halfDay: MarketStatusRow = {
    status: 'open',
    session_open_at: '2026-11-27T14:30:00Z',
    session_close_at: '2026-11-27T18:00:00Z',
    next_open_at: null,
  };
  assertEquals(decideTradeGate(new Date('2026-11-27T17:59:59Z'), halfDay).open, true);
  assertEquals(decideTradeGate(new Date('2026-11-27T18:00:00Z'), halfDay).open, false);
});

Deno.test('trade gate: a closed row before its next open is closed and not stale', () => {
  const gate = decideTradeGate(new Date('2026-10-05T23:00:00Z'), CLOSED_ROW);
  assertEquals(gate.open, false);
  assertEquals((gate as { reason: string }).reason, 'closed');
  assertEquals((gate as { stale: boolean }).stale, false);
  assertEquals((gate as { nextOpenAt: Date | null }).nextOpenAt?.toISOString(), '2026-10-06T13:30:00.000Z');
});

Deno.test('trade gate: once a closed row’s next open has passed, it is stale (refetch, not open)', () => {
  const gate = decideTradeGate(new Date('2026-10-06T13:31:00Z'), CLOSED_ROW);
  assertEquals(gate.open, false);
  assertEquals((gate as { stale: boolean }).stale, true);
});

Deno.test('trade gate FAILS CLOSED: unreadable, missing or unknown calendar never reads as open', () => {
  const now = new Date('2026-10-05T15:00:00Z');
  for (const row of [null, undefined, { status: 'unknown', session_open_at: null, session_close_at: null, next_open_at: null }]) {
    const gate = decideTradeGate(now, row as MarketStatusRow | null | undefined);
    assertEquals(gate.open, false);
    assertEquals((gate as { reason: string }).reason, 'unavailable');
  }
});

Deno.test('trade gate: an open row with unparseable bounds is unavailable, not open', () => {
  const gate = decideTradeGate(new Date('2026-10-05T15:00:00Z'), {
    status: 'open', session_open_at: 'not-a-date', session_close_at: '2026-10-05T20:00:00Z', next_open_at: null,
  });
  assertEquals(gate.open, false);
  assertEquals((gate as { reason: string }).reason, 'unavailable');
});

// ---- Available cash per stake mode ---------------------------------------

/** A league object whose legacy budget columns THROW if anything reads them.
 * "Never read budget_mode / budget_amount for a per-slot league" is enforced
 * here, not just asserted. */
function legacyTrap(fields: { stake_mode: string | null; notional_per_slot: number }): BuyingPowerLeague {
  const league: BuyingPowerLeague & { budget_mode?: string } = { ...fields };
  Object.defineProperty(league, 'budget_mode', { get() { throw new Error('legacy budget_mode read'); } });
  Object.defineProperty(league, 'budget_amount', { get() { throw new Error('legacy budget_amount read'); } });
  return league;
}

Deno.test('buying power, test_0925 shape: fixed_notional with legacy budget columns offers the JPM proceeds', () => {
  // Giorgio's 1.1.0 failure: per-slot league still carrying budget_mode='budget'
  // and budget_amount=100. Sold JPM whole: 2.916472 @ $333.25 (proceeds derived in the fixture).
  const league = legacyTrap({ stake_mode: 'fixed_notional', notional_per_slot: 2000 });
  const preview: BuyingPowerPreview = {
    stake_mode: 'fixed_notional',
    stake: 2000,
    unfilled_slots: 0,
    sources: [{ trade_id: 'trade-jpm-sell', symbol: 'JPM', amount: JPM_PROCEEDS }],
  };
  const power = buyingPower({ league, preview, cashSpent: null, openTierLabel: null });
  assertEquals(power.kind, 'proceeds');
  if (power.kind !== 'proceeds') throw new Error('unreachable');
  assertEquals(power.pickerRequired, false);
  assertEquals(power.defaultTradeId, 'trade-jpm-sell');
  assertEquals(power.sources[0].amount, JPM_PROCEEDS);
  // The buy is sized from the sale's cash, at the derived quantity.
  assertEquals(formatShares(buyQuantity({ kind: 'proceeds', amount: power.sources[0].amount, price: 66.42 }) ?? Number.NaN), formatShares(Math.round((JPM_PROCEEDS / 66.42) * 1e6) / 1e6));
});

Deno.test('buying power: two sales with cash need a picker; one buy never mixes them', () => {
  const league = legacyTrap({ stake_mode: 'fixed_notional', notional_per_slot: 2000 });
  const preview: BuyingPowerPreview = {
    stake_mode: 'fixed_notional', stake: 2000, unfilled_slots: 0,
    sources: [
      { trade_id: 'a', symbol: 'TSLA', amount: 1890.12 },
      { trade_id: 'b', symbol: 'V', amount: 1100 },
    ],
  };
  const power = buyingPower({ league, preview, cashSpent: null, openTierLabel: null });
  assertEquals(power.kind === 'proceeds' && power.pickerRequired, true);
});

Deno.test('buying power: no sale cash is none, even with an unfilled_slots count (D3: a pick is never unused)', () => {
  const league = legacyTrap({ stake_mode: 'fixed_notional', notional_per_slot: 2000 });
  const preview: BuyingPowerPreview = { stake_mode: 'fixed_notional', stake: 2000, unfilled_slots: 1, sources: [] };
  const power = buyingPower({ league, preview, cashSpent: null, openTierLabel: null });
  assertEquals(power, { kind: 'none' });
});

Deno.test('buying power: sale cash wins over an unfilled_slots count (the server spends proceeds first)', () => {
  const league = legacyTrap({ stake_mode: 'fixed_notional', notional_per_slot: 2000 });
  const preview: BuyingPowerPreview = {
    stake_mode: 'fixed_notional', stake: 2000, unfilled_slots: 1,
    sources: [{ trade_id: 'a', symbol: 'TSLA', amount: 1890.12 }],
  };
  const power = buyingPower({ league, preview, cashSpent: null, openTierLabel: null });
  assertEquals(power.kind, 'proceeds');
});

Deno.test('buying power: nothing to invest is terminal (none), never a guessed amount', () => {
  const league = legacyTrap({ stake_mode: 'fixed_notional', notional_per_slot: 2000 });
  const preview: BuyingPowerPreview = { stake_mode: 'fixed_notional', stake: 2000, unfilled_slots: 0, sources: [] };
  assertEquals(buyingPower({ league, preview, cashSpent: null, openTierLabel: null }), { kind: 'none' });
});

Deno.test('buying power: no preview yet is unknown, never invented as open cash', () => {
  const league = legacyTrap({ stake_mode: 'fixed_notional', notional_per_slot: 2000 });
  assertEquals(buyingPower({ league, preview: null, cashSpent: null, openTierLabel: null }), { kind: 'unknown' });
});

Deno.test('buying power: budget_cap reads the budget, minus cash spent (mirrors userCashSpent)', () => {
  const league = { stake_mode: 'budget_cap', budget_amount: 2500 };
  const power = buyingPower({ league, preview: null, cashSpent: 2251.64, openTierLabel: null });
  assertEquals(power, { kind: 'budget', budget: 2500, spent: 2251.64, left: 248.36 });
});

Deno.test('buying power: budget_cap without a finite budget is unknown', () => {
  const league = { stake_mode: 'budget_cap', budget_amount: null };
  assertEquals(buyingPower({ league, preview: null, cashSpent: 0, openTierLabel: null }).kind, 'unknown');
});

Deno.test('buying power: price_tiers shows the open slot’s tier, or unknown when none is open', () => {
  const league = { stake_mode: 'price_tiers' };
  assertEquals(buyingPower({ league, preview: null, cashSpent: null, openTierLabel: '$50–$150' }), { kind: 'tier', tierLabel: '$50–$150' });
  assertEquals(buyingPower({ league, preview: null, cashSpent: null, openTierLabel: null }).kind, 'unknown');
});

Deno.test('buying power: a null stake mode (legacy) is one share, unconstrained', () => {
  assertEquals(buyingPower({ league: { stake_mode: null }, preview: null, cashSpent: null, openTierLabel: null }), { kind: 'one_share' });
});

// ---- record-trade outcome reader -----------------------------------------

/** supabase-js resolves a non-2xx as { error } with the Response on
 * error.context; a 200 refusal comes back as data. */
function httpError(status: number, body: unknown) {
  return {
    name: 'FunctionsHttpError',
    context: { status, json: async () => body },
  };
}

Deno.test('outcome: 200 ok trade', async () => {
  const out = await readRecordTradeOutcome({ data: { ok: true, trade: { id: 't1' } }, error: null });
  assertEquals(out.kind, 'ok');
});

Deno.test('outcome: 200 game-flow refusal keeps its reason', async () => {
  const out = await readRecordTradeOutcome({ data: { ok: false, reason: 'symbol_owned' }, error: null });
  assertEquals(out, { kind: 'refused', reason: 'symbol_owned' });
});

Deno.test('outcome: 200 market_closed carries the market reason and next open', async () => {
  const out = await readRecordTradeOutcome({
    data: { ok: false, reason: 'market_closed', market_reason: 'holiday', next_open_at: '2027-01-04T14:30:00Z' },
    error: null,
  });
  assertEquals(out, { kind: 'refused', reason: 'market_closed', marketReason: 'holiday', nextOpenAt: '2027-01-04T14:30:00Z' });
});

Deno.test('outcome: 503 calendar_unavailable is NOT a failed trade: keep the review open', async () => {
  const out = await readRecordTradeOutcome({ data: null, error: httpError(503, { ok: false, reason: 'calendar_unavailable' }) });
  assertEquals(out.kind, 'unavailable');
});

Deno.test('outcome: 429 rate_limited is a refusal read from the error body, not a transport error', async () => {
  const out = await readRecordTradeOutcome({ data: null, error: httpError(429, { ok: false, reason: 'rate_limited' }) });
  assertEquals(out, { kind: 'refused', reason: 'rate_limited' });
});

Deno.test('outcome: a transport failure with no response body is network, never ok', async () => {
  const out = await readRecordTradeOutcome({ data: null, error: { name: 'FunctionsFetchError' } });
  assertEquals(out.kind, 'network');
});

Deno.test('outcome: a 5xx with an unreadable body is unconfirmed (network), never a refusal', async () => {
  const out = await readRecordTradeOutcome({
    data: null,
    error: { name: 'FunctionsHttpError', context: { status: 500, json: async () => { throw new Error('not json'); } } },
  });
  assertEquals(out, { kind: 'network' });
});

Deno.test('outcome: an empty success body is never ok', async () => {
  const out = await readRecordTradeOutcome({ data: null, error: null });
  assert(out.kind !== 'ok');
});

// ---- refusal copy --------------------------------------------------------

Deno.test('refusal copy: every reason maps to specific copy, with the picker/terminal behaviour', () => {
  const reasons = [
    'proceeds_unavailable', 'no_proceeds', 'symbol_owned', 'not_owned', 'over_budget',
    'no_eligible_slot', 'roster_full', 'not_draftable', 'no_price', 'rate_limited',
    'draft_not_completed', 'not_a_member', 'invalid_price', 'market_closed', 'calendar_unavailable',
  ];
  for (const r of reasons) {
    const copy = refusalCopy(r, {});
    assert(copy.message.length > 0, r);
    assert(!/[a-z]+_[a-z]+/.test(copy.message), `raw code leaked for ${r}`);
  }
  assertEquals(refusalCopy('proceeds_unavailable', {}).backTo, 'picker');
  assertEquals(refusalCopy('no_proceeds', {}).terminal, true);
});

Deno.test('refusal copy: an unknown reason gets one generic line, never the raw code', () => {
  const copy = refusalCopy('something_new_xyz', {});
  assertEquals(copy.message.includes('something_new_xyz'), false);
  assert(copy.message.length > 0);
});

// ---- opens label ----------------------------------------------------------

Deno.test('opens label: Monday 9:30 AM ET from an EDT instant', () => {
  assertEquals(marketOpensLabel('2026-10-05T13:30:00Z'), 'Mon 9:30 AM ET');
});

Deno.test('opens label: an EST instant after the DST change reads 9:30 AM ET too', () => {
  assertEquals(marketOpensLabel('2026-11-02T14:30:00Z'), 'Mon 9:30 AM ET');
});

Deno.test('opens label: no next open means no label, never a guessed time', () => {
  assertEquals(marketOpensLabel(null), null);
  assertEquals(marketOpensLabel('garbage'), null);
});

Deno.test('outcome: a 2xx { ok: false } with no reason string is unconfirmed, not a silent refusal', async () => {
  // readFunctionRefusal (PR #143) synthesizes reason:'unhandled' here, same as a server-sent
  // reason:'unhandled' — so this now lands on network (check your history), not a generic refusal.
  const out = await readRecordTradeOutcome({ data: { ok: false }, error: null });
  assertEquals(out, { kind: 'network' });
});
