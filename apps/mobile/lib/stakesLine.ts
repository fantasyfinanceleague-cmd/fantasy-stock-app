/**
 * stakesLine: the ONE plain-language stakes line, shared by every screen that
 * shows a league's stake mode (Join preview, league settings, ...). Pure, with
 * no React Native or supabase imports, so tests-deno can import it.
 *
 * The labels are STAKE_MODE_OPTIONS' (lib/categoryData.ts), which cannot be
 * imported here (it pulls in supabase); tests-deno/stakes-line.test.ts reads
 * that file as text and fails if the labels drift apart.
 *
 *   Equal stakes · $1,000 per slot | Price tiers · one share per slot |
 *   Budget cap · $2,500 (or "Budget cap" with no amount) | Not set yet
 */

export interface StakesLineAmounts {
  /** leagues.notional_per_slot, for equal stakes. Absent → no amount, never "$0". */
  notionalPerSlot?: number | null;
  /** leagues.budget_amount, for a budget cap. Absent → no amount. */
  budgetAmount?: number | null;
}

/** "$2,000" (whole dollars unless there are cents). Built without Intl so it is identical on Hermes and Deno. */
export function dollars(n: number): string {
  const fixed = Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2);
  const [whole, cents] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}${cents ? `.${cents}` : ''}`;
}

function amount(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** `mode` is leagues.stake_mode: a known mode, null (commissioner re-choice pending) or anything else (legacy / unknown). */
export function stakesLine(mode: string | null | undefined, amounts: StakesLineAmounts = {}): string {
  switch (mode) {
    case 'fixed_notional': {
      const per = amount(amounts.notionalPerSlot);
      return per !== null ? `Equal stakes · ${dollars(per)} per slot` : 'Equal stakes';
    }
    case 'price_tiers':
      return 'Price tiers · one share per slot';
    case 'budget_cap': {
      const cap = amount(amounts.budgetAmount);
      return cap !== null ? `Budget cap · ${dollars(cap)}` : 'Budget cap';
    }
    default:
      return 'Not set yet';
  }
}
