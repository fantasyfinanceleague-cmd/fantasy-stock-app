// Money formatter — must match the mobile foundation byte for byte
// (Orchestrator, cross-platform alignment note, 2026-09-26). Integer-cents
// math throughout: no Intl.NumberFormat, no toFixed. Rounding is pinned to
// `Math.round(Math.abs(v) * 100)`, plain round-half-up on the IEEE-754
// double, reapplying the sign afterwards — see the 2.675 / 1.005 golden
// cases in money.test.ts for why that specific pair matters.

export interface MoneyOptions {
  /** 'negative' (default): no '+' on positives, U+2212 on negatives.
   *  'always': '+' or U+2212 on any non-zero value, after cents rounding. */
  sign?: 'negative' | 'always';
  /** Pad an empty sign slot with U+2007 (figure space) so columns of
   *  money align — a zero (either mode) or a positive under 'negative'. */
  alignSign?: boolean;
  /** ≥ $1,000 (after rounding) compacts to 2 decimals + K/M/B/T, with
   *  rollover (999,999.99 -> $1.00M). Below $1,000, shows the full amount
   *  regardless of this flag. */
  compact?: boolean;
}

const MINUS = '−'; // U+2212, not ASCII hyphen-minus
const FIGURE_SPACE = ' ';

const COMPACT_TIERS = [
  { suffix: 'T', thresholdDollars: 1e12 },
  { suffix: 'B', thresholdDollars: 1e9 },
  { suffix: 'M', thresholdDollars: 1e6 },
  { suffix: 'K', thresholdDollars: 1e3 },
] as const;

function addThousandsSeparators(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function padHundredths(hundredths: number): { whole: number; frac: string } {
  return { whole: Math.floor(hundredths / 100), frac: String(hundredths % 100).padStart(2, '0') };
}

/** `cents` (integer, ≥ 0) at the given compact tier, as integer hundredths
 * of that tier's unit (e.g. 123 -> "1.23"). Rolls over to the next tier up
 * when the result would read ≥ 1000.00 of the current one. */
function compactHundredths(cents: number, tierIndex: number): { hundredths: number; suffix: string } {
  const tier = COMPACT_TIERS[tierIndex];
  const unitCents = tier.thresholdDollars * 100;
  const hundredths = Math.round((cents * 100) / unitCents);
  if (hundredths >= 100_000 && tierIndex > 0) {
    return compactHundredths(cents, tierIndex - 1);
  }
  return { hundredths, suffix: tier.suffix };
}

/** The one place the rounding rule lives: `Math.round(Math.abs(v) * 100)`.
 * Exported so callers that need "is this effectively zero?" (e.g. Money's
 * sign-based colour) use the exact same rule formatMoney does, rather than
 * re-deriving it and risking drift. */
export function roundToCents(value: number): number {
  return Math.round(Math.abs(value) * 100);
}

export function formatMoney(value: number, options: MoneyOptions = {}): string {
  const { sign = 'negative', alignSign = false, compact = false } = options;

  const cents = roundToCents(value);
  const isZero = cents === 0;
  const isNegative = !isZero && value < 0;

  let signChar: string;
  if (isZero) {
    signChar = alignSign ? FIGURE_SPACE : '';
  } else if (isNegative) {
    signChar = MINUS;
  } else {
    signChar = sign === 'always' ? '+' : alignSign ? FIGURE_SPACE : '';
  }

  const dollars = Math.floor(cents / 100);

  if (compact && dollars >= 1000) {
    // Start from the largest tier the (rounded) magnitude qualifies for.
    const tierIndex = COMPACT_TIERS.findIndex((t) => dollars >= t.thresholdDollars);
    const { hundredths, suffix } = compactHundredths(cents, tierIndex);
    const { whole, frac } = padHundredths(hundredths);
    return `${signChar}$${whole}.${frac}${suffix}`;
  }

  const centsPart = String(cents % 100).padStart(2, '0');
  return `${signChar}$${addThousandsSeparators(String(dollars))}.${centsPart}`;
}
