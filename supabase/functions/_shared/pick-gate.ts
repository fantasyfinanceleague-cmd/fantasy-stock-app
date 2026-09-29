/**
 * THE draft pick legality authority, as a type.
 *
 * Giorgio's acceptance criterion for auto-draft (2026-09-29): it must NEVER
 * give someone a stock their league's rules forbid — price brackets, category
 * slots, budget_cap, the draftable universe, league-owned symbols, and any
 * rule added later. The rules themselves live in ONE function,
 * draft-validation.ts `validatePick`. This module makes it structurally
 * impossible to write a drafts pick row that did not pass it:
 *
 *   gatePick(...)  runs validatePick on the LIVE fill price and the symbol's
 *                  effective category eligibility, and is the ONLY producer of
 *                  a `GatedPick`;
 *   insertGatedPick (draft-write.ts) — the only code that inserts a non-SKIP
 *                  drafts row — accepts a `GatedPick`, never a bare symbol.
 *
 * `GatedPick` carries a module-private brand, so no other module can build one
 * by writing an object literal: the compiler rejects it. (An explicit `as`
 * cast would defeat any TS brand; the supabase/tests structural check greps
 * for exactly that and for any other drafts insert site.)
 *
 * Manual picks, bot picks, queue auto-picks and best-available auto-picks all
 * pass through here, so a rule added to validatePick applies to every one of
 * them on the day it is added.
 */
import { type PickInputs, type PickRefusal, validatePick } from './draft-validation.ts';

declare const gatedBrand: unique symbol;

/** A pick that validatePick accepted, with everything the insert needs. */
export interface GatedPick {
  readonly [gatedBrand]: true;
  readonly leagueId: string;
  readonly pickerId: string;
  readonly symbol: string;
  readonly price: number;
  readonly quantity: number;
  readonly round: number;
  readonly pickNumber: number;
  readonly slotId: string | null;
}

export type GateResult =
  | { ok: true; pick: GatedPick }
  | { ok: false; reason: PickRefusal };

/**
 * Run the one legality gate. `inputs.price` must be the LIVE fill price and
 * `inputs.eligibleCategories` the symbol's effective eligibility (callers
 * read both fresh); `inputs.isDraftable` must be the symbols row's value.
 */
export function gatePick(leagueId: string, inputs: PickInputs): GateResult {
  const d = validatePick(inputs);
  if (!d.legal) return { ok: false, reason: d.reason };
  const pick = {
    leagueId,
    pickerId: inputs.pickerId,
    symbol: inputs.symbol.toUpperCase(),
    price: Number(inputs.price),
    quantity: d.quantity,
    round: d.round,
    pickNumber: d.pickNumber,
    slotId: d.slotId,
  } as GatedPick; // the ONLY construction site of a GatedPick
  return { ok: true, pick };
}
