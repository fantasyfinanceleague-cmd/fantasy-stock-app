/**
 * draftRefusals (3c): the "draft never skips" codes, mapped to copy keys. The
 * backend (fix/draft-never-skips) is not merged, so every placeholder is a
 * clearly marked NEW COPY pending the Design Lead. An unknown code gets one
 * honest generic line, never a made-up reason. A 'stalled' turn is shown as
 * waiting, never as a pick (auto-pick found no legal stock).
 */

/** Every copy key this module can emit, all flagged new copy. */
export const COPY_KEYS = [
  '[new copy: would_strand_slot]',
  '[new copy: budget_reserve]',
  '[new copy: skip_disabled]',
  '[new copy: slots_infeasible]',
  '[new copy: budget_infeasible]',
  '[new copy: feasibility_unavailable]',
  '[new copy: stalled_waiting]',
  '[new copy: stalled_commissioner]',
] as const;

const PICK_REFUSALS: Record<string, string> = {
  would_strand_slot: '[new copy: would_strand_slot]',
  budget_reserve: '[new copy: budget_reserve]',
  skip_disabled: '[new copy: skip_disabled]',
};

const STATUS_BLOCKERS: Record<string, string> = {
  slots_infeasible: '[new copy: slots_infeasible]',
  budget_infeasible: '[new copy: budget_infeasible]',
  feasibility_unavailable: '[new copy: feasibility_unavailable]',
};

export function pickRefusalCopy(reason: string): string {
  return PICK_REFUSALS[reason] ?? "That pick can't be made.";
}

export function statusBlockerCopy(b: { code: string }): string {
  return STATUS_BLOCKERS[b.code] ?? "The draft can't start yet.";
}

export interface TurnState {
  kind: 'normal' | 'stalled';
  /** The turn's waiting label; null for a normal turn. */
  label: string | null;
  /** The commissioner's notice; null for a normal turn. */
  commissionerNotice: string | null;
}

/** A stalled turn is waiting, with a commissioner notice, never a fake pick. */
export function turnState(input: { reason: string | null; pickNumber: number }): TurnState {
  if (input.reason === 'stalled') {
    return {
      kind: 'stalled',
      label: '[new copy: stalled_waiting]',
      commissionerNotice: '[new copy: stalled_commissioner]',
    };
  }
  return { kind: 'normal', label: null, commissionerNotice: null };
}
