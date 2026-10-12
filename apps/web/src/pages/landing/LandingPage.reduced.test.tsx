import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import LandingPage from './LandingPage';

// Its own file on purpose: motion reads the OS reduced-motion preference
// ONCE per module instance, so the preference must be in place before the
// first render in the file. This is the real user path — prefers-reduced-
// motion from the OS, no test-only MotionConfig override.
window.matchMedia = ((query: string) => ({
  // Reduced motion on, and every layout query (min-height etc.) satisfied.
  matches: true,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

describe('reduced motion (OS preference)', () => {
  it('hydrates the server markup with no mismatch', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = document.createElement('div');
    container.innerHTML = renderToString(<LandingPage />);
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, <LandingPage />);
    });
    const messages = errors.mock.calls.map((c) => String(c[0]));
    expect(messages.filter((m) => /hydrat|did not match|mismatch/i.test(m))).toEqual([]);
    container.remove();
    errors.mockRestore();
  });

  it('keeps every section static: nothing pinned, no live loops, a paused tape', async () => {
    vi.useFakeTimers();
    const { container } = render(<LandingPage />);
    await act(async () => {});
    expect(container.querySelector('.lp-inside--pinned')).toBeNull();
    expect(container.querySelector('.lp-layer--stacked')).toBeNull();
    expect(container.querySelector('.lp-chapter')).toBeNull();
    expect(container.querySelectorAll('.lp-steps--static > li')).toHaveLength(3);
    expect(container.querySelector('.lp-ticker__track')?.getAttribute('data-state')).toBe('paused');

    const board = () => [...container.querySelectorAll('.lp-srow__name')].map((e) => e.firstChild?.textContent);
    const value = () => container.querySelector('.lp-card--portfolio .sp-visually-hidden')?.textContent;
    const before = [board(), value()];
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect([board(), value()]).toEqual(before);
    vi.useRealTimers();
  });
});
