import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetTierForTests, decideTier } from './tier';

// The capability gate (round 4). jsdom has no WebGL, which doubles as the
// "no hardware WebGL2" case.

function setSearch(q: string) {
  window.history.replaceState(null, '', `/${q}`);
}

afterEach(() => {
  setSearch('');
  __resetTierForTests();
  vi.restoreAllMocks();
});

describe('decideTier', () => {
  it('reduced motion → STATIC, decisively', () => {
    expect(decideTier(true)).toMatchObject({ tier: 'static', reasons: ['prefers-reduced-motion'] });
  });

  it('no hardware WebGL2 → ENHANCED', () => {
    expect(decideTier(false)).toMatchObject({ tier: 'enhanced', reasons: ['no hardware WebGL2'] });
  });

  it('Save-Data → ENHANCED, before any WebGL probe', () => {
    const spy = vi.spyOn(document, 'createElement');
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    expect(decideTier(false)).toMatchObject({ tier: 'enhanced', reasons: ['Save-Data'] });
    expect(spy).not.toHaveBeenCalledWith('canvas');
    Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
  });

  it('a WebGL2 context that is not software-rendered → FULL; hints never decide', () => {
    const fake = { getExtension: () => null } as unknown as WebGL2RenderingContext;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string, opts?: { failIfMajorPerformanceCaveat?: boolean }) =>
      kind === 'webgl2' && opts?.failIfMajorPerformanceCaveat ? fake : null) as never);
    Object.defineProperty(navigator, 'deviceMemory', { value: 2, configurable: true });
    const d = decideTier(false);
    expect(d.tier).toBe('full');
    expect(d.hints.deviceMemory).toBe(2);
    Object.defineProperty(navigator, 'deviceMemory', { value: undefined, configurable: true });
  });

  it('?tier= forces a tier for captures (and marks it forced)', () => {
    setSearch('?tier=full');
    expect(decideTier(true)).toMatchObject({ tier: 'full', forced: true });
    setSearch('?tier=nonsense');
    expect(decideTier(true).tier).toBe('static');
  });
});
