import { describe, expect, it } from 'vitest';
import { tugRatio } from './tugRatio';

describe('tugRatio', () => {
  it('both zero settles at dead centre', () => {
    expect(tugRatio(0, 0)).toBe(0.5);
  });

  it('you leading gives > 0.5', () => {
    expect(tugRatio(100, 40)).toBeGreaterThan(0.5);
  });

  it('opponent leading gives < 0.5', () => {
    expect(tugRatio(40, 100)).toBeLessThan(0.5);
  });

  it('is symmetric: swapping you/opponent mirrors around 0.5', () => {
    const a = tugRatio(100, 40);
    const b = tugRatio(40, 100);
    expect(a + b).toBeCloseTo(1, 10);
  });

  it('a total blowout clamps at 0.92, never reaching 1', () => {
    expect(tugRatio(10_000, -500)).toBe(0.92);
    expect(tugRatio(-500, 10_000)).toBe(0.08);
  });

  it('the $1 floor keeps a tiny near-zero matchup from swinging wildly', () => {
    // Without the floor, (0.005 - (-0.005)) / (0.005+0.005) would be a full
    // swing to the clamp; the floor keeps it barely off centre instead.
    const ratio = tugRatio(0.005, -0.005);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.51);
  });

  it('one team flat at zero, the other negative: still bounded and correct direction', () => {
    expect(tugRatio(0, -50)).toBeGreaterThan(0.5);
    expect(tugRatio(-50, 0)).toBeLessThan(0.5);
  });
});
