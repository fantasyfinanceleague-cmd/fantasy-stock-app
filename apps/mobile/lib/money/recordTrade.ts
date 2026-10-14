/**
 * recordTrade: the one place the app calls record-trade (3e). Every result goes
 * through readRecordTradeOutcome, so a 200 refusal, a 503, a 5xx and a dropped
 * network each reach the review as the right state. Nothing here decides a
 * trade: the server does.
 */
import { supabase } from '@/lib/supabase';

import { readRecordTradeOutcome, type RecordTradeOutcome } from './recordTradeOutcome';
import { MONEY_FIXTURE_CONFIG } from './devFixture';
import { fixturePreview, fixtureSubmitOutcome } from './fixtureMode';
import { buildStressMarket } from './stressFixture';
import type { PreviewBody, BuyBody, SellBody } from './tradeBodies';
import { CAPTURE_REFUSAL, MATCHUP_FIXTURE_VARIANT, PORTFOLIO_STAKE_VARIANT, SEAM_ON } from '../game/devSeam';
import { SEAM_LEAGUE, SEAM_ME } from '../game/seamTables';
import { HOME_FIXTURE } from '../home/devFixture';
import { seamOpenSales, seamPortfolioLedger } from './portfolioSeam';
import { parsePreviewSlots, parseSlotShape, type PreviewSlot, type SlotShape } from './tierContract';

export type TradeBody = SellBody | BuyBody;

export async function callRecordTrade(body: TradeBody): Promise<RecordTradeOutcome> {
  // DEV fixture: answered here, and the function is NEVER invoked, so the fixture can't write a trade.
  if (MONEY_FIXTURE_CONFIG) {
    const price = buildStressMarket().prices[body.symbol] ?? 211.42;
    return fixtureSubmitOutcome(MONEY_FIXTURE_CONFIG, price);
  }
  // The game capture seam: answered here and NEVER invoked (a capture can't write a trade):
  // success, or the refusal EXPO_PUBLIC_CAPTURE_REFUSAL names (the refusal captures).
  if (SEAM_ON) {
    return CAPTURE_REFUSAL ? { kind: 'refused', reason: CAPTURE_REFUSAL } : { kind: 'ok', trade: { id: 'seam-trade-not-written' } };
  }
  const result = await supabase.functions.invoke('record-trade', { body });
  return readRecordTradeOutcome(result);
}

export interface PreviewResult {
  stakeMode: string | null;
  stake: number | null;
  unfilledSlots: number;
  sources: { trade_id: string; symbol: string; amount: number }[];
  /** The caller's slot map (every slotted league); null when it can't be read. */
  slots: PreviewSlot[] | null;
  /** Only when the check was asked: the slot the buy would fill, or null (refused). */
  wouldFill?: SlotShape | null;
  /** With wouldFill null: the open slots the refusal names. */
  openSlots?: SlotShape[];
}

/** The read-only preview: the sale proceeds that can pay for a buy. Null when it can't be read. */
export async function fetchPreview(body: PreviewBody): Promise<PreviewResult | null> {
  // DEV fixture: the preview is answered from the fixture, with no network call.
  if (MONEY_FIXTURE_CONFIG) {
    const jpm = Math.round(2.916472 * 333.25 * 100) / 100;
    return fixturePreview(MONEY_FIXTURE_CONFIG, [{ tradeId: 'fixture-sale-jpm', symbol: 'JPM', amount: jpm }]);
  }
  // The game capture seam: the seam ledger's open sale (fixed_notional) and, for a budget or tier
  // buy, a Flex slot that fits; no network call.
  if (SEAM_ON) {
    const ledger = seamPortfolioLedger(MATCHUP_FIXTURE_VARIANT, HOME_FIXTURE, SEAM_ME, SEAM_LEAGUE.gianluigi);
    const sales = seamOpenSales(ledger, SEAM_ME);
    const stakeMode = PORTFOLIO_STAKE_VARIANT === 'budget_null' ? 'budget_cap' : PORTFOLIO_STAKE_VARIANT;
    const flex: SlotShape = { slot_id: 'seam-flex', slot_index: 0, slot_count: 1, price_min: null, price_max: null, category_id: null };
    return {
      stakeMode,
      stake: null,
      unfilledSlots: 0,
      sources: stakeMode === 'fixed_notional' ? sales.map((x, i) => ({ trade_id: `seam-sale-${i}`, symbol: x.symbol, amount: x.amount })) : [],
      slots: [],
      ...('price' in body && body.price != null ? { wouldFill: flex, openSlots: [] } : {}),
    };
  }
  const { data, error } = await supabase.functions.invoke('record-trade', { body });
  if (error || !data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.ok !== true || !Array.isArray(d.sources)) return null;
  const sources: PreviewResult['sources'] = [];
  for (const s of d.sources as unknown[]) {
    const o = s as Record<string, unknown>;
    if (typeof o.trade_id !== 'string' || typeof o.symbol !== 'string' || typeof o.amount !== 'number') return null;
    sources.push({ trade_id: o.trade_id, symbol: o.symbol, amount: o.amount });
  }
  const result: PreviewResult = {
    stakeMode: typeof d.stake_mode === 'string' ? d.stake_mode : null,
    stake: typeof d.stake === 'number' ? d.stake : null,
    unfilledSlots: typeof d.unfilled_slots === 'number' ? d.unfilled_slots : 0,
    sources,
    slots: parsePreviewSlots(d.slots ?? []),
  };
  if ('would_fill' in d) {
    result.wouldFill = d.would_fill == null ? null : parseSlotShape(d.would_fill);
    const open = Array.isArray(d.open_slots) ? d.open_slots.map(parseSlotShape) : [];
    result.openSlots = open.every((x) => x !== null) ? (open as SlotShape[]) : [];
  }
  return result;
}
