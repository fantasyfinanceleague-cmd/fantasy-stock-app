/**
 * tierContract: the client side of "Replace in the same tier" (3e, option A,
 * Giorgio 2026-10-06). The SERVER decides tier fit (docs/migrations/
 * TIER_TRADE_SLOTS.md). This file parses the server's shapes and words them.
 * It never computes whether a price or a category fits a slot.
 *
 * The words follow the Design Lead's final rulings:
 *  - A slot has a price band (price_min/price_max), a category (category_id),
 *    both, or neither. Neither is "Flex": it accepts anything, so it never
 *    appears in a refusal.
 *  - A category name that doesn't resolve is never printed as "Category". The
 *    Fills line falls back to "Fills your open slot"; the Portfolio label and
 *    a refusal that names the category drop to no label / a plain sentence.
 *  - Pure: the category names come in through a resolver.
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

/** Resolves a category id to its name, or null when it doesn't resolve. */
export type CategoryResolver = (categoryId: string) => string | null;
const noCategory: CategoryResolver = () => null;

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

/** A price as the board writes it: "$100", "$211.42" (never "$100.00"). */
function price(v: number): string {
  return formatMoney(v).replace(/\.00$/, '');
}

const hasBand = (s: SlotShape) => s.price_min != null || s.price_max != null;
const isFlex = (s: SlotShape) => !hasBand(s) && s.category_id == null;

/** The band in the Portfolio's words, with an en dash: "$100–$200", "up to $50", "$800 or more". */
function labelBand(min: number | null, max: number | null): string {
  if (min == null) return `up to ${price(max!)}`;
  if (max == null) return `${price(min)} or more`;
  return `${price(min)}–${price(max)}`;
}

/** The band in a refusal sentence, with "to": "$100 to $200", "up to $50", "$800 or more". */
export function slotRangeText(min: number | null, max: number | null): string {
  if (min == null) return `up to ${price(max!)}`;
  if (max == null) return `${price(min)} or more`;
  return `${price(min)} to ${price(max)}`;
}

/**
 * The Portfolio row label: "Tech slot", "$100–$200 Tech slot", "$100–$200 slot",
 * "Flex slot". Null when the category name doesn't resolve: never "Category".
 */
export function slotLabelFor(slot: SlotShape, resolve: CategoryResolver = noCategory): string | null {
  if (isFlex(slot)) return 'Flex slot';
  const cat = slot.category_id != null ? resolve(slot.category_id) : null;
  if (slot.category_id != null && cat == null) return null;
  const band = hasBand(slot) ? labelBand(slot.price_min, slot.price_max) : null;
  return [band, cat, 'slot'].filter(Boolean).join(' ');
}

/** Symbol to Portfolio label, from the caller's preview slot map. */
export function slotLabelsBySymbol(slots: PreviewSlot[] | null, resolve: CategoryResolver = noCategory): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of slots ?? []) {
    const label = slotLabelFor(s, resolve);
    if (label == null) continue;
    for (const sym of s.held) out[sym.toUpperCase()] = label;
  }
  return out;
}

/** "Fills your …" for the slot a buy would fill. */
export function fillsSlotLine(slot: SlotShape, resolve: CategoryResolver = noCategory): string {
  if (slot.category_id != null && resolve(slot.category_id) == null) return COPY.fillsOpenSlotFallback;
  if (isFlex(slot)) return 'Fills your Flex slot';
  const cat = slot.category_id != null ? resolve(slot.category_id) : null;
  if (!hasBand(slot)) return `Fills your ${cat} slot`;
  if (cat == null) {
    // The approved band-only forms, which keep their own wording at the open edges.
    if (slot.price_min == null) return `Fills your slot priced up to ${price(slot.price_max!)}`;
    if (slot.price_max == null) return `Fills your slot priced ${price(slot.price_min)} or more`;
    return `Fills your ${labelBand(slot.price_min, slot.price_max)} slot`;
  }
  if (slot.price_min == null) return `Fills your ${cat} slot priced up to ${price(slot.price_max!)}`;
  if (slot.price_max == null) return `Fills your ${cat} slot priced ${price(slot.price_min)} or more`;
  return `Fills your ${labelBand(slot.price_min, slot.price_max)} ${cat} slot`;
}

/** Joins items as the board does: "A", "A and B", "A, B and C". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The refusal sentence, shown before the review. `open` is the server's
 * open_slots. A Flex slot never appears: it would have accepted the stock.
 *  - no open slot: the every-slot-full line (no price head).
 *  - one category-only slot: "AAPL doesn't fit your open Tech slot."
 *  - one banded slot: "AAPL is $211.42. Your open slot takes stocks priced $100 to $200."
 *  - banded with a category: "AAPL is $211.42. Your open slot takes Tech stocks priced …"
 *  - several: "AAPL is $211.42. Your open slots: $100–$200 Tech and Health Care."
 */
export function tierRefusalSentence(symbol: string, priceValue: number, open: SlotShape[], resolve: CategoryResolver = noCategory): string {
  const sym = symbol.toUpperCase();
  const head = `${sym} is ${formatMoney(priceValue)}.`;
  const slots = open.filter((s) => !isFlex(s));
  if (slots.length === 0) return COPY.everySlotFull;

  if (slots.length === 1) {
    const s = slots[0];
    const cat = s.category_id != null ? resolve(s.category_id) : null;
    if (s.category_id != null && cat == null) return `${sym} doesn't fit your open slot.`;
    if (!hasBand(s)) return `${sym} doesn't fit your open ${cat} slot.`;
    const band = slotRangeText(s.price_min, s.price_max);
    return cat == null
      ? `${head} Your open slot takes stocks priced ${band}.`
      : `${head} Your open slot takes ${cat} stocks priced ${band}.`;
  }

  const items: string[] = [];
  for (const s of slots) {
    const cat = s.category_id != null ? resolve(s.category_id) : null;
    if (s.category_id != null && cat == null) continue;
    const band = hasBand(s) ? labelBand(s.price_min, s.price_max) : null;
    items.push([band, cat].filter(Boolean).join(' '));
  }
  if (items.length === 0) return `${sym} doesn't fit your open slots.`;
  return `${head} Your open slots: ${listOf(items)}.`;
}
