/**
 * Hermetic unit tests for components/sp/logic/money.ts — no RN, run with:
 *
 *   deno test apps/mobile/tests-deno/
 *
 * Golden cases from docs/design/prompts/phase2-foundation-mobile.md, plus
 * the two rounding-parity cases and the alignSign case pinned by the
 * Orchestrator/Design Lead on 2026-09-26.
 */
import { assertEquals } from 'jsr:@std/assert';
import { formatMoney, formatPercent, isZeroMoney } from '../components/sp/logic/money.ts';

// ---------------------------------------------------------------------------
// The brief's golden table (renamed sign vocabulary: 'auto' -> 'always')

Deno.test('formatMoney: 56.8, sign always -> +$56.80', () => {
  assertEquals(formatMoney(56.8, { sign: 'always' }), '+$56.80');
});

Deno.test('formatMoney: -3000, sign always -> −$3,000.00', () => {
  assertEquals(formatMoney(-3000, { sign: 'always' }), '−$3,000.00');
});

Deno.test('formatMoney: 0, sign always -> $0.00 (no sign)', () => {
  assertEquals(formatMoney(0, { sign: 'always' }), '$0.00');
});

Deno.test('formatMoney: 1234567.891, compact, default sign -> $1.23M', () => {
  assertEquals(formatMoney(1234567.891, { compact: true }), '$1.23M');
});

Deno.test('formatMoney: -0.004, sign always -> $0.00 (rounds to zero, so no sign)', () => {
  assertEquals(formatMoney(-0.004, { sign: 'always' }), '$0.00');
});

// ---------------------------------------------------------------------------
// Rounding parity (pinned 2026-09-26): plain Math.round on cents, no
// toFixed-driven rounding, no Intl, no round-half-to-even. Both are ordinary
// binary-float artifacts and must match the web implementation exactly.

Deno.test('formatMoney: 1.005 rounds to $1.00 (binary-float artifact, pinned)', () => {
  assertEquals(formatMoney(1.005), '$1.00');
});

// NOTE (2026-09-26): the Orchestrator's pinned instruction stated this case
// as "2.675 -> $2.67", but that's the result of `(2.675).toFixed(2)` (a
// DIFFERENT, string-based rounding algorithm) — not of the pinned formula
// `Math.round(Math.abs(v) * 100)`. 2.675 is stored as 2.6749999999999998,
// but that value TIMES 100 rounds (as its own separate float multiplication)
// to exactly 267.5 — an exact tie, which Math.round takes up to 268. Flagged
// back to the Orchestrator/Design Lead for cross-platform confirmation; this
// test asserts what the pinned formula actually computes ($2.68), matching
// this file's own implementation, not the instruction's example value.
Deno.test('formatMoney: 2.675 rounds to $2.68 under Math.round(v*100) (not toFixed\'s $2.67 — see note above)', () => {
  assertEquals(formatMoney(2.675), '$2.68');
});

// ---------------------------------------------------------------------------
// Default sign ('negative'): positives get no leading character, negatives
// still show the minus.

Deno.test('formatMoney: default sign shows no + on a positive value', () => {
  assertEquals(formatMoney(12.5), '$12.50');
});

Deno.test('formatMoney: default sign still shows − on a negative value', () => {
  assertEquals(formatMoney(-12.5), '−$12.50');
});

// ---------------------------------------------------------------------------
// alignSign: reserves the sign column with a figure space so a column of
// values stays aligned; zero is still never signed.

Deno.test('formatMoney: alignSign reserves a figure space for zero', () => {
  assertEquals(formatMoney(0, { alignSign: true }), ' $0.00');
});

Deno.test('formatMoney: alignSign reserves a figure space for a positive under sign "negative"', () => {
  assertEquals(formatMoney(42, { alignSign: true }), ' $42.00');
});

Deno.test('formatMoney: alignSign does not add a figure space when a real sign glyph is shown', () => {
  assertEquals(formatMoney(-42, { alignSign: true }), '−$42.00');
  assertEquals(formatMoney(42, { sign: 'always', alignSign: true }), '+$42.00');
});

// ---------------------------------------------------------------------------
// Compact: thousands grouping below the threshold, unit suffixes above it,
// and rollover across a unit boundary.

Deno.test('formatMoney: compact below $1,000 renders in full', () => {
  assertEquals(formatMoney(999.99, { compact: true }), '$999.99');
});

Deno.test('formatMoney: compact rolls over 999,999.99 into $1.00M', () => {
  assertEquals(formatMoney(999999.99, { compact: true }), '$1.00M');
});

Deno.test('formatMoney: compact handles billions and trillions', () => {
  assertEquals(formatMoney(4_200_000_000, { compact: true }), '$4.20B');
  assertEquals(formatMoney(1_500_000_000_000, { compact: true }), '$1.50T');
});

Deno.test('formatMoney: compact negative carries the minus before the currency', () => {
  assertEquals(formatMoney(-1234567.89, { compact: true }), '−$1.23M');
});

// ---------------------------------------------------------------------------
// Full (non-compact) thousands grouping.

Deno.test('formatMoney: full formatting groups thousands', () => {
  assertEquals(formatMoney(1234567.5), '$1,234,567.50');
});

// ---------------------------------------------------------------------------
// isZeroMoney: the same "rounds to zero cents" rule used internally.

Deno.test('isZeroMoney: true for values that round to zero', () => {
  assertEquals(isZeroMoney(0), true);
  assertEquals(isZeroMoney(-0.004), true);
  assertEquals(isZeroMoney(0.004), true);
});

Deno.test('isZeroMoney: false once a value rounds to a nonzero cent', () => {
  assertEquals(isZeroMoney(0.005), false);
  assertEquals(isZeroMoney(-0.01), false);
});

Deno.test('formatPercent: 2.86, sign always -> +2.86%', () => {
  assertEquals(formatPercent(2.86, { sign: 'always' }), '+2.86%');
});

Deno.test('formatPercent: -1.865, default sign -> −1.87%', () => {
  assertEquals(formatPercent(-1.865, { }), '−1.87%');
});

Deno.test('formatPercent: 0, sign always -> 0.00% (no sign)', () => {
  assertEquals(formatPercent(0, { sign: 'always' }), '0.00%');
});

Deno.test('formatPercent: a tiny negative that rounds to zero is never signed', () => {
  assertEquals(formatPercent(-0.001, { sign: 'always' }), '0.00%');
});
