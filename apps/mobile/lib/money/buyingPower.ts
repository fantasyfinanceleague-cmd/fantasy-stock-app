/**
 * buyingPower: what the buyer can invest with, decided from the STAKE MODE
 * alone (3e ruling, root cause of the 1.1.0 trade test, 2026-10-05).
 *
 *   fixed_notional   what record-trade's preview says: sale proceeds, else a
 *                    skipped slot's full notional (D2), else none. The league's
 *                    legacy budget_mode / budget_amount are NEVER read here.
 *   budget_cap       budget_amount minus cash spent (mirrors userCashSpent).
 *   price_tiers      the open slot's tier label, supplied by the caller.
 *   null (legacy)    one share, unconstrained.
 *
 * Anything it cannot prove is 'unknown', never a guessed number (no preview
 * means no cash shown as available).
 */
export interface PreviewSource {
  trade_id: string;
  symbol: string;
  amount: number;
}

export interface BuyingPowerPreview {
  stake_mode: string | null;
  stake: number | null;
  unfilled_slots: number;
  sources: PreviewSource[];
}

export interface BuyingPowerLeague {
  stake_mode: string | null;
  notional_per_slot?: number | null;
  budget_amount?: number | null;
}

export interface BuyingPowerInput {
  league: BuyingPowerLeague;
  preview: BuyingPowerPreview | null;
  /** budget_cap only: userCashSpent for the caller. */
  cashSpent: number | null;
  /** price_tiers only: the open slot's tier label. */
  openTierLabel: string | null;
}

export type BuyingPower =
  | { kind: 'proceeds'; sources: PreviewSource[]; pickerRequired: boolean; defaultTradeId: string }
  | { kind: 'skipped_slot'; amount: number }
  | { kind: 'none' }
  | { kind: 'budget'; budget: number; spent: number; left: number }
  | { kind: 'tier'; tierLabel: string }
  | { kind: 'one_share' }
  | { kind: 'unknown' };

const cents = (v: number) => Math.round(v * 100) / 100;

export function buyingPower(input: BuyingPowerInput): BuyingPower {
  const mode = input.league.stake_mode ?? null;

  if (mode === 'fixed_notional') {
    const preview = input.preview;
    if (!preview || preview.stake_mode !== 'fixed_notional') return { kind: 'unknown' };
    if (preview.sources.length > 0) {
      return {
        kind: 'proceeds',
        sources: preview.sources,
        pickerRequired: preview.sources.length > 1,
        defaultTradeId: preview.sources[0].trade_id,
      };
    }
    if (preview.unfilled_slots > 0) {
      return preview.stake == null ? { kind: 'unknown' } : { kind: 'skipped_slot', amount: preview.stake };
    }
    return { kind: 'none' };
  }

  if (mode === 'budget_cap') {
    // Number(null) is 0: a missing budget must read as unknown, never a $0 budget.
    const raw = input.league.budget_amount;
    const budget = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(budget) || input.cashSpent == null) return { kind: 'unknown' };
    const spent = cents(input.cashSpent);
    return { kind: 'budget', budget, spent, left: cents(budget - spent) };
  }

  if (mode === 'price_tiers') {
    return input.openTierLabel ? { kind: 'tier', tierLabel: input.openTierLabel } : { kind: 'unknown' };
  }

  if (mode === null) return { kind: 'one_share' };
  return { kind: 'unknown' };
}
