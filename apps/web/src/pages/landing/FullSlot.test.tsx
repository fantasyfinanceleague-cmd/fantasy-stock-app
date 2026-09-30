import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { __resetTierForTests } from './tier';

// A FULL scene must never take the page down (round 4): a scene that throws
// demotes the page to ENHANCED and renders nothing, instead of reaching the
// app's error boundary.

vi.mock('./full', () => ({
  scenes: {
    hero: () => {
      throw new Error('boom');
    },
  },
}));

afterEach(() => {
  __resetTierForTests();
  vi.restoreAllMocks();
});

describe('FullSlot', () => {
  it('a throwing scene demotes to ENHANCED and renders nothing', async () => {
    // Hardware WebGL2 → the gate says FULL.
    const fake = { getExtension: () => null } as unknown as WebGL2RenderingContext;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => (kind === 'webgl2' ? fake : null)) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { FullSlot } = await import('./FullSlot');
    const { container } = render(<FullSlot name="hero" slot={{ current: null }} frame={0} />);
    await waitFor(() => expect(document.documentElement.dataset.lpTier).toBe('enhanced'));
    expect(document.documentElement.dataset.lpTierWhy).toMatch(/scene "hero" threw: boom/);
    expect(container.querySelector('.lp-3d')).toBeNull();
  });
});
