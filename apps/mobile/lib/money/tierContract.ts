/**
 * tierContract: the client side of "Replace in the same tier" (3e, option A,
 * Giorgio 2026-10-06). The SERVER decides tier fit (docs/migrations/
 * TIER_TRADE_SLOTS.md on fix/tier-trade-slots). This file only parses the
 * server's shapes and words them. It never computes whether a price fits a
 * slot. Pure, and tested against the contract's own examples.
 */
import { formatMoney } from '../../components/sp/logic/money';
import { COPY } from './moneyCopy';

export interface SlotShape {
  slot_id: string;
  slot_index: number;
  slot_count: number;
  price_min: number | null;
  price_max: number | null;
  category_id: string | null;
}

/** A slot in the caller's preview: the slot, the held symbols in it, and how many are open. */
export interface PreviewSlot extends SlotShape {
  held: string[];
  open: number;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);

/** One slot shape, validated. Null when any field is malformed (never a guessed slot). */
export function parseSlotShape(raw: unknown): SlotShape | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isStr(o.slot_id) || !isNum(o.slot_index) || !isNum(o.slot_count)) return null;
  if (!isNumOrNull(o.price_min ?? null) || !isNumOrNull(o.price_max ?? null)) return null;
  if (o.category_id != null && !isStr(o.category_id)) return null;
  return {
    slot_id: o.slot_id,
    slot_index: o.slot_index,
    slot_count: o.slot_count,
    price_min: (o.price_min as number | null | undefined) ?? null,
    price_max: (o.price_max as number | null | undefined) ?? null,
    category_id: (o.category_id as string | null | undefined) ?? null,
  };
}

/** The preview's `slots` array, validated as a whole. Null if any entry is malformed. */
export function parsePreviewSlots(raw: unknown): PreviewSlot[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PreviewSlot[] = [];
  for (const r of raw) {
    const base = parseSlotShape(r);
    if (!base) return null;
    const o = r as Record<string, unknown>;
    if (!Array.isArray(o.held) || !o.held.every(isStr) || !isNum(o.open)) return null;
    out.push({ ...base, held: o.held as string[], open: o.open });
  }
  return out;
}

/** A bound as the board writes it: "$100", "$211.42" (never "$100.00"). */
function bound(v: number): string {
  return formatMoney(v).replace(/\.00$/, '');
}

/** One slot's price range, in the contract's words: "$100 to $200", "up to $200", "$100 or more", "any price". */
export function slotRangeText(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'at any price';
  if (min == null) return `up to ${bound(max!)}`;
  if (max == null) return `${bound(min)} or more`;
  return `${bound(min)} to ${bound(max)}`;
}

/**
 * The refusal sentence (the approved board copy). `open` is the server's
 * open_slots. An empty list means every slot is held: a new line, flagged for
 * the Design Lead. Several open slots name each range.
 */
export function tierRefusalSentence(symbol: string, price: number, open: SlotShape[]): string {
  const head = `${symbol.toUpperCase()} is ${formatMoney(price)}.`;
  if (open.length === 0) return `${head} ${COPY.everySlotFull}`;
  if (open.length === 1) {
    const s = open[0];
    if (s.price_min == null && s.price_max == null) return `${head} ${COPY.openSlotAnyPrice}`;
    return `${head} Your open slot takes stocks priced ${slotRangeText(s.price_min, s.price_max)}.`;
  }
  const ranges = open.map((s) => slotRangeText(s.price_min, s.price_max)).join(' or ');
  return `${head} ${COPY.openSlotsTake(ranges)}`;
}

/** The "Fills your $100–$200 slot" line for a review, from the slot a buy would fill. */
export function fillsSlotLine(slot: SlotShape): string {
  const { price_min: min, price_max: max } = slot;
  if (min == null && max == null) return COPY.fillsAnySlot;
  if (min == null) return `Fills your slot priced up to ${bound(max!)}`;
  if (max == null) return `Fills your slot priced ${bound(min)} or more`;
  return `Fills your ${bound(min)}–${bound(max)} slot`;
}

/** The Portfolio row's slot label: "$100–$200 slot" (the server's slot map says which slot a stock is in). */
export function slotLabelFor(slot: SlotShape): string {
  const { price_min: min, price_max: max } = slot;
  if (min == null && max == null) return 'Any price slot';
  if (min == null) return `Up to ${bound(max!)} slot`;
  if (max == null) return `${bound(min)} or more slot`;
  return `${bound(min)}–${bound(max)} slot`;
}

/** Symbol to slot label, from the caller's preview slot map (a stock held in no slot has no label). */
export function slotLabelsBySymbol(slots: PreviewSlot[] | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of slots ?? []) {
    for (const sym of s.held) out[sym.toUpperCase()] = slotLabelFor(s);
  }
  return out;
}
