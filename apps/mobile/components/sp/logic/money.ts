// Stockpile — pure money-formatting logic (Phase 2 foundation).
//
// Deliberately dependency-free (no RN, no Intl) so:
//   (a) apps/mobile/tests-deno/sp-money.test.ts can import this file directly
//       under Deno with no shims, and
//   (b) the output is byte-identical between Hermes (the app) and V8 (Deno,
//       CI) and the web implementation, which was pinned to the same rules
//       by the Orchestrator/Design Lead on 2026-09-26:
//         - round with `Math.round(Math.abs(value) * 100)`, sign reapplied
//           after rounding (no toFixed-driven rounding, no Intl, no
//           round-half-to-even) — e.g. 1.005 -> $1.00, 2.675 -> $2.67
//           (both are ordinary binary-float artifacts, kept intentionally
//           so mobile/web/tests never disagree on a "fixed" rounding).
//         - zero is never signed, even if the *unrounded* input was
//           negative (-0.004 rounds to zero cents -> "$0.00", no minus).
//         - the minus sign is U+2212 (proper minus), never ASCII hyphen.
//
// `sign` naming: the original Phase 2 brief used 'auto' | 'always' | 'never'.
// The Design Lead renamed this during spec review (2026-09-26, relayed by the
// Orchestrator) to 'negative' | 'always' to match what 'never' actually does
// (it still shows the minus on negatives — it only suppresses the '+' on
// positives). This file and the <Money> component both use the renamed API;
// there is no 'auto'/'never' anywhere in this codebase.

export type MoneySign = 'negative' | 'always';

export interface FormatMoneyOptions {
  /**
   * 'negative' (default): only negative values get a sign (U+2212). Zero and
   * positive values get no leading character (unless `alignSign`).
   * 'always': positive non-zero values also get a leading '+'. Zero never
   * gets a sign either way.
   */
  sign?: MoneySign;
  /**
   * Reserve the sign column with a U+2007 (figure space) when no +/- glyph
   * is shown (zero always; positive values too under `sign: 'negative'`),
   * so a column of money values stays aligned.
   */
  alignSign?: boolean;
  /**
   * >= $1,000 renders as e.g. "$1.23M" (2 decimals + K/M/B/T, with
   * rollover: 999,999.99 rounds up into the next unit, i.e. "$1.00M").
   * Below $1,000 always renders in full regardless of this flag.
   */
  compact?: boolean;
}

const MINUS = '−';
const FIGURE_SPACE = ' ';

const COMPACT_UNITS: ReadonlyArray<readonly [number, string]> = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

/** Fixed 2-decimal string from a non-negative dollar amount, no grouping. */
function toFixed2(absDollars: number): string {
  const cents = Math.round(absDollars * 100);
  const dollars = Math.floor(cents / 100);
  const remCents = cents % 100;
  return `${dollars}.${String(remCents).padStart(2, '0')}`;
}

/** Comma-groups an all-digit integer string: "1234567" -> "1,234,567". */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Full (non-compact) formatting from an exact integer cents amount. */
function formatFullFromCents(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const remCents = cents % 100;
  return `${groupThousands(String(dollars))}.${String(remCents).padStart(2, '0')}`;
}

/** Compact ("$1.23M") formatting from a non-negative dollar amount. */
function formatCompact(absDollars: number): string {
  for (let i = 0; i < COMPACT_UNITS.length; i++) {
    const [threshold, suffix] = COMPACT_UNITS[i];
    if (absDollars < threshold) continue;

    let scaled = absDollars / threshold;
    let rounded = Math.round(scaled * 100) / 100;

    // Rollover: e.g. 999,999.99 / 1000 -> 999.99999... -> rounds to 1000.00,
    // which must read as the NEXT unit up ("$1.00M"), not "$1000.00K".
    if (rounded >= 1000 && i > 0) {
      const [biggerThreshold, biggerSuffix] = COMPACT_UNITS[i - 1];
      scaled = absDollars / biggerThreshold;
      rounded = Math.round(scaled * 100) / 100;
      return `${toFixed2(rounded)}${biggerSuffix}`;
    }
    return `${toFixed2(rounded)}${suffix}`;
  }
  // Should be unreachable — callers only invoke this for absDollars >= 1000.
  return toFixed2(absDollars);
}

/**
 * Formats a dollar amount per docs/design/DESIGN_DIRECTION.md §9 / §2:
 * tabular-nums-ready output, U+2212 minus, zero never signed.
 */
export function formatMoney(value: number, options: FormatMoneyOptions = {}): string {
  const sign = options.sign ?? 'negative';
  const alignSign = options.alignSign ?? false;
  const compact = options.compact ?? false;

  const isNegativeInput = value < 0;
  const cents = Math.round(Math.abs(value) * 100);
  const isZero = cents === 0;

  let signChar = '';
  if (!isZero && isNegativeInput) {
    signChar = MINUS;
  } else if (!isZero && sign === 'always') {
    signChar = '+';
  } else if (alignSign) {
    // Zero, or a positive value under `sign: 'negative'` with alignSign on.
    signChar = FIGURE_SPACE;
  }

  const absDollars = cents / 100;
  const body = compact && absDollars >= 1000 ? formatCompact(absDollars) : formatFullFromCents(cents);

  return `${signChar}$${body}`;
}

/** True when `value` rounds to exactly zero cents (the "never signed" case). */
export function isZeroMoney(value: number): boolean {
  return Math.round(Math.abs(value) * 100) === 0;
}
