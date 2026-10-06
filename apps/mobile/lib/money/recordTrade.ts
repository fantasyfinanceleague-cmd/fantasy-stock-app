/**
 * recordTrade: the one place the app calls record-trade (3e). Every result goes
 * through readRecordTradeOutcome, so a 200 refusal, a 503, a 5xx and a dropped
 * network each reach the review as the right state. Nothing here decides a
 * trade: the server does.
 */
import { supabase } from '@/lib/supabase';

import { readRecordTradeOutcome, type RecordTradeOutcome } from './recordTradeOutcome';
import type { PreviewBody, BuyBody, SellBody } from './tradeBodies';
import { parsePreviewSlots, parseSlotShape, type PreviewSlot, type SlotShape } from './tierContract';

export type TradeBody = SellBody | BuyBody;

export async function callRecordTrade(body: TradeBody): Promise<RecordTradeOutcome> {
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
