import { describe, expect, it } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { MotionConfig, motion } from 'motion/react';
import { useMotion } from './useMotion';
import { MotionRoot } from './MotionRoot';

// Its own file on purpose: motion reads the OS preference ONCE per module
// instance, so the OS must already say "reduce" before anything renders.
// Only the reduced-motion query matches, so this is the real OS path.
window.matchMedia = ((query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

describe('useMotion under an OS "reduce" preference', () => {
  it('reports reduced with NO MotionConfig anywhere in the tree (the case that slipped through)', () => {
    const { result } = renderHook(() => useMotion());
    expect(result.current.reduced).toBe(true);
    expect(result.current.enterTransition.duration).toBe(result.current.duration.quick);
  });

  it('cannot be forced back to full motion over the OS setting', () => {
    const { result } = renderHook(() => useMotion(), {
      wrapper: ({ children }) => <MotionConfig reducedMotion="never">{children}</MotionConfig>,
    });
    expect(result.current.reduced).toBe(true);
  });
});

describe('MotionRoot', () => {
  it('makes motion components honour the OS preference: a transform lands at once', async () => {
    const { getByTestId } = render(
      <MotionRoot>
        <motion.div data-testid="box" initial={{ x: 100 }} animate={{ x: 0 }} transition={{ duration: 5 }} />
      </MotionRoot>
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const transform = getByTestId('box').style.transform;
    expect(transform === 'none' || transform === '' || /translateX\(0(px)?\)/.test(transform)).toBe(true);
  });

  it('without it, motion ignores the OS preference and the same transform is still mid-flight', async () => {
    const { getByTestId } = render(
      <motion.div data-testid="box" initial={{ x: 100 }} animate={{ x: 0 }} transition={{ duration: 5 }} />
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(getByTestId('box').style.transform).toMatch(/translateX\((?!0(px)?\))/);
  });
});
