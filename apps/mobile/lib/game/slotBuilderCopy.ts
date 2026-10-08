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

export type SlotIssueKind = 'count' | 'range';

/** One slot's problem: its index (0-based) and what's wrong. */
export interface SlotIssue {
  slot: number;
  kind: SlotIssueKind;
}

/** The roster-slot checks, structured (the logic validateSlotConfig always had,
 * unchanged): per slot in order, a count below 1, then a min price above the max;
 * then the slots' total stocks against the rounds (once slots exist, every pick
 * needs an open slot, so the total must equal the rounds exactly). No slots, no
 * issues. */
export function slotConfigIssues(
  slots: readonly { slotCount: string; priceMin: string; priceMax: string }[],
  numRounds: number,
): { slots: SlotIssue[]; capacity: { total: number; rounds: number } | null } {
  const issues: SlotIssue[] = [];
  if (slots.length === 0) return { slots: issues, capacity: null };
  let total = 0;
  slots.forEach((s, i) => {
    const count = Number(s.slotCount);
    if (!(count > 0)) issues.push({ slot: i, kind: 'count' });
    else total += count;
    const min = s.priceMin === '' ? null : Number(s.priceMin);
    const max = s.priceMax === '' ? null : Number(s.priceMax);
    if (min != null && max != null && min > max) issues.push({ slot: i, kind: 'range' });
  });
  return { slots: issues, capacity: total !== numRounds ? { total, rounds: numRounds } : null };
}

/** On the slot itself (Design Lead ruling): no slot number. */
export function slotIssueOnSlot(kind: SlotIssueKind): string {
  return kind === 'count' ? 'This slot needs at least 1 stock.' : "Min price can't be higher than max price.";
}

/** Away from the slot (Design Lead ruling): names the slot, 1-based. */
export function slotIssueAway(issue: SlotIssue): string {
  const n = issue.slot + 1;
  return issue.kind === 'count' ? `Slot ${n} needs at least 1 stock.` : `In slot ${n}, min price can't be higher than max price.`;
}

/** The capacity line, in rounds (Design Lead ruling), pluralised. */
export function capacityLine(total: number, rounds: number): string {
  const held = `Your slots hold ${total} ${total === 1 ? 'stock' : 'stocks'}, but each team drafts ${rounds}, one per round.`;
  return total > rounds ? `${held} Remove ${total - rounds}.` : `${held} Add ${rounds - total} so every pick has a slot.`;
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
