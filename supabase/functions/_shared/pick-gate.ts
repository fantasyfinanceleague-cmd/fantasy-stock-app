/**
 * THE draft pick legality authority, as a type.
 *
 * Giorgio's acceptance criterion for auto-draft (2026-09-29): it must NEVER
 * give someone a stock their league's rules forbid. The per-pick rules live in
 * draft-validation.ts `validatePick`. Since 2026-10-05 ("a draft pick can never
 * be unused") the gate also refuses a pick that would leave another manager's
 * slot unfillable (draft-feasibility.ts never-worsen) or the picker's remaining
 * slots unaffordable (the budget reserve). This module makes it structurally
 * impossible to write a drafts pick row that did not pass all of it:
 *
 *   gatePick(...)     runs validatePick PER OPEN SLOT (first-fit, but skipping
 *                     any slot whose pick would strand someone) and the
 *                     feasibility check on the LIVE price; the ONLY producer of
 *                     a `GatedPick`;
 *   insertGatedPick   (draft-write.ts) — the only code that inserts a non-SKIP
 *                     drafts row — accepts a `GatedPick`, never a bare symbol.
 *
 * `GatedPick` carries a module-private brand, so no other module can build one
 * by writing an object literal: the compiler rejects it.
 *
 * Manual picks, bot picks, queue auto-picks and best-available auto-picks all
 * pass through here, so a rule added to validatePick or to the feasibility
 * model applies to every one of them the day it is added. `feas` is REQUIRED:
 * there is no call path that gates a pick without the feasibility state.
 */
import {
  type PickInputs,
  type PickRefusal,
  type Slot,
  validatePick,
  userCashSpent,
} from './draft-validation.ts';
import {
  evaluateFeasiblePick,
  type FeasibilityState,
  type PickFeasibilityRefusal,
} from './draft-feasibility.ts';

declare const gatedBrand: unique symbol;

/** A pick that the whole gate accepted, with everything the insert needs. */
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

export type GateRefusal = PickRefusal | PickFeasibilityRefusal;

export type GateResult =
  | { ok: true; pick: GatedPick }
  | { ok: false; reason: GateRefusal };

/** The feasibility context for ONE pick, read fresh by the caller from the same
 * pool the search used. */
export interface PickFeasibility {
  /** Pre-pick league state: types, aggregate open demand, pool groups, budget. */
  state: FeasibilityState;
  /** The picker's own open instances per type (draft-feasibility openInstances). */
  open: number[];
  /** The picked symbol's CACHED last_price: which pool group it leaves. */
  cachedPrice: number | null;
  /** The picked symbol's effective category ids. */
  eligibility: Set<string>;
}

/**
 * Run the one legality gate. `inputs.price` must be the LIVE fill price and
 * `inputs.eligibleCategories` the symbol's effective eligibility (callers read
 * both fresh); `inputs.isDraftable` must be the symbols row's value.
 *
 * Slot choice: candidate slots are tried in slot_index order. A candidate that
 * validatePick accepts AND that does not strand another manager AND keeps the
 * picker's reserve is chosen. Refusal reason when none survives: budget_reserve
 * if the reserve was the blocker, else would_strand_slot if slots were the
 * blocker, else the validatePick reason (no_eligible_slot, over_budget, ...).
 */
export function gatePick(leagueId: string, inputs: PickInputs, feas: PickFeasibility): GateResult {
  const types = feas.state.types;
  const candidates: Array<Slot | null> = inputs.slots.length === 0
    ? [null]
    : [...inputs.slots].sort((a, b) => a.slotIndex - b.slotIndex);

  let firstRefusal: PickRefusal | null = null;
  let sawStrand = false;
  let sawBudget = false;
  for (const slot of candidates) {
    const d = validatePick(slot ? { ...inputs, slots: [slot] } : inputs);
    if (!d.legal) {
      firstRefusal ??= d.reason;
      continue;
    }
    const ordinal = slot ? types.findIndex((t) => t.id === slot.id) : 0;
    if (ordinal < 0) throw new Error(`gatePick: slot ${slot?.id} missing from feasibility types`);
    const cost = d.quantity * Number(inputs.price);
    const spent = userCashSpent(inputs.pickerId, inputs.picks, inputs.trades);
    const ev = evaluateFeasiblePick(feas.state, {
      ordinal,
      cachedPrice: feas.cachedPrice,
      eligibility: feas.eligibility,
      cost,
      spent,
      open: feas.open,
    });
    if (!ev.ok) {
      if (ev.reason === 'budget_reserve') sawBudget = true;
      else sawStrand = true;
      continue;
    }
    const pick = {
      leagueId,
      pickerId: inputs.pickerId,
      symbol: inputs.symbol.toUpperCase(),
      price: Number(inputs.price),
      quantity: d.quantity,
      round: d.round,
      pickNumber: d.pickNumber,
      slotId: slot ? slot.id : null,
    } as GatedPick; // the ONLY construction site of a GatedPick
    return { ok: true, pick };
  }

  if (sawBudget) return { ok: false, reason: 'budget_reserve' };
  if (sawStrand) return { ok: false, reason: 'would_strand_slot' };
  return { ok: false, reason: firstRefusal ?? 'no_eligible_slot' };
}
