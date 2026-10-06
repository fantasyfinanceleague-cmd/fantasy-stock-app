/**
 * The roster-slot editor's copy and input rules (3c-2), lifted out of
 * components/SlotBuilder.tsx unchanged so the rules tests can see them. A slot
 * is {count, price bracket?, category?}; no filters = flex. Pure: the category
 * type is structural so this never imports categoryData (which pulls in supabase).
 */

/** A new slot, as "Add slot" always made it: one stock, no filters (flex). */
export const EMPTY_SLOT = { slotCount: '1', priceMin: '', priceMax: '', categoryId: '' } as const;

/** The slot card's heading. NEW copy (the old editor had no heading). */
export function slotTitle(index: number): string {
  return `Slot ${index + 1}`;
}

/** The remove control's VoiceOver label. NEW copy. */
export function removeSlotLabel(index: number): string {
  return `Remove slot ${index + 1}`;
}

export type SlotField = 'count' | 'min' | 'max';

/** The three fields' visual labels (Design Lead ruling). */
export const SLOT_FIELD_LABELS: Record<SlotField, string> = { count: 'Stocks', min: 'Min $', max: 'Max $' };

/** The fields' VoiceOver labels, in words (Design Lead ruling): "Slot 2, lowest price in dollars". */
export function slotFieldA11y(index: number, field: SlotField): string {
  const words: Record<SlotField, string> = { count: 'stocks', min: 'lowest price in dollars', max: 'highest price in dollars' };
  return `Slot ${index + 1}, ${words[field]}`;
}

/** The Roster slots caption (Design Lead ruling; "price range", never "bracket", user-facing). */
export function rosterSlotsCaption(stakeMode: string): string {
  return stakeMode === 'price_tiers'
    ? 'Required: each slot sets a price range.'
    : 'Optional: a slot can require a category or a price range.';
}

/** Price tiers with no slot (Design Lead ruling), shown under Roster slots. */
export const PRICE_TIERS_NEED_A_SLOT = 'Price tiers need at least one slot with a price range.';

/** Splits validateSlotConfig's errors so each "Slot N: …" line shows on its own
 * slot (prefix dropped, first letter capitalised) and the rest (the capacity
 * line) under the list. Pure string handling: the validator is unchanged. */
export function splitSlotErrors(errors: readonly string[]): { bySlot: Record<number, string[]>; general: string[] } {
  const bySlot: Record<number, string[]> = {};
  const general: string[] = [];
  for (const e of errors) {
    const m = /^Slot (\d+): (.+)$/.exec(e);
    if (!m) {
      general.push(e);
      continue;
    }
    const i = Number(m[1]) - 1;
    const msg = m[2].charAt(0).toUpperCase() + m[2].slice(1);
    (bySlot[i] ??= []).push(msg);
  }
  return { bySlot, general };
}

/** The category a slot shows: "Any (flex)" with none, "Unknown" if the id is gone. */
export function categoryLabel(id: string, categories: readonly { id: string; name: string }[]): string {
  return id ? categories.find((c) => c.id === id)?.name ?? 'Unknown' : 'Any (flex)';
}

/** The count field keeps digits only. */
export function countInput(text: string): string {
  return text.replace(/[^0-9]/g, '');
}

/** The price fields keep digits and the decimal point. */
export function priceInput(text: string): string {
  return text.replace(/[^0-9.]/g, '');
}

/** A feasibility warning, the old wording verbatim. `needed` counts an empty
 * or zero count as one, as the old check did. */
export function slotShortfallCopy(index: number, matches: number, leagueSize: number, slotCount: string): string {
  const needed = leagueSize * (Number(slotCount) || 1);
  return `Slot ${index + 1}: only ${matches} draftable stock${matches === 1 ? '' : 's'} match — the league needs at least ${needed} (${leagueSize} teams × ${slotCount}).`;
}

/** True when this slot's matches can't fill every team's copies of it. */
export function slotShort(matches: number, leagueSize: number, slotCount: string): boolean {
  return matches < leagueSize * (Number(slotCount) || 1);
}

export const SLOT_CHECK_FAILED = 'Could not check availability — try again.';

export const SLOT_PARTIAL_NOTE =
  'Stock data is still loading (takes ~2 days after launch) — per-slot availability checks are paused until it completes. Slot count math is still enforced.';
