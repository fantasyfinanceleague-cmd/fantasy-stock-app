import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

// Golden cases from docs/design/prompts/phase2-foundation-web.md, corrected
// by the Orchestrator/Design Lead on 2026-09-26 (formatMoney's real
// signature, and the 2.675 rounding case). Mobile asserts the identical
// values — these must match byte for byte.
describe('formatMoney golden cases', () => {
  it('56.8 with sign always -> +$56.80', () => {
    expect(formatMoney(56.8, { sign: 'always' })).toBe('+$56.80');
  });

  it('-3000 with sign always -> −$3,000.00 (U+2212, not ASCII hyphen)', () => {
    const result = formatMoney(-3000, { sign: 'always' });
    expect(result).toBe('−$3,000.00');
    expect(result.codePointAt(0)).toBe(0x2212);
  });

  it('0 with sign always -> $0.00 (zero is never signed)', () => {
    expect(formatMoney(0, { sign: 'always' })).toBe('$0.00');
  });

  it('0 with the default (negative) sign -> $0.00', () => {
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('1234567.891 compact (default sign) -> $1.23M', () => {
    expect(formatMoney(1234567.891, { compact: true })).toBe('$1.23M');
  });

  it('-0.004 with sign always -> $0.00 (rounds to zero cents, so no sign)', () => {
    expect(formatMoney(-0.004, { sign: 'always' })).toBe('$0.00');
  });
});

describe('formatMoney: sign modes', () => {
  it('default mode never adds a + to a positive value', () => {
    expect(formatMoney(56.8)).toBe('$56.80');
  });

  it('default mode still shows U+2212 on a negative value', () => {
    expect(formatMoney(-3000)).toBe('−$3,000.00');
  });
});

describe('formatMoney: alignSign', () => {
  it('pads a zero-value sign slot with U+2007 (figure space)', () => {
    const result = formatMoney(0, { alignSign: true });
    expect(result).toBe(' $0.00');
    expect(result.codePointAt(0)).toBe(0x2007);
  });

  it('pads a positive value under the default (negative) mode too', () => {
    const result = formatMoney(56.8, { alignSign: true });
    expect(result).toBe(' $56.80');
  });

  it('does not pad a positive value under "always" (it gets a real +)', () => {
    expect(formatMoney(56.8, { sign: 'always', alignSign: true })).toBe('+$56.80');
  });

  it('-0 (negative zero) is still unsigned, aligned or not', () => {
    expect(formatMoney(-0, { sign: 'always' })).toBe('$0.00');
    expect(formatMoney(-0, { sign: 'always', alignSign: true })).toBe(' $0.00');
  });
});

describe('formatMoney: rounding (pinned: Math.round(Math.abs(v) * 100))', () => {
  it('1.005 -> $1.00 (1.005 * 100 is 100.4999...99 in IEEE-754)', () => {
    expect(formatMoney(1.005)).toBe('$1.00');
  });

  it('2.675 -> $2.68, NOT $2.67 (2.675 * 100 rounds UP to exactly 267.5)', () => {
    // The literal 2.675 stores low (2.6749999999999998224...), but the
    // multiplication 2.675 * 100 rounds to the nearest double, which is
    // exactly 267.5 — so Math.round gives 268. toFixed(2) would give
    // '2.67' here (a different, and wrong, rule) — this is exactly why the
    // spec pins Math.round(Math.abs(v) * 100), not toFixed.
    expect(formatMoney(2.675)).toBe('$2.68');
  });
});

describe('formatMoney: compact', () => {
  it('below $1,000, compact has no effect', () => {
    expect(formatMoney(999.99, { compact: true })).toBe('$999.99');
  });

  it('999,999.99 rolls over into the next tier: $1.00M, not $1000.00K', () => {
    expect(formatMoney(999999.99, { compact: true })).toBe('$1.00M');
  });

  it('a negative value compacts on magnitude and keeps its sign', () => {
    expect(formatMoney(-1234567.891, { compact: true })).toBe('−$1.23M');
  });

  it('billions and trillions pick the right tier', () => {
    expect(formatMoney(2_500_000_000, { compact: true })).toBe('$2.50B');
    expect(formatMoney(3_100_000_000_000, { compact: true })).toBe('$3.10T');
  });
});
