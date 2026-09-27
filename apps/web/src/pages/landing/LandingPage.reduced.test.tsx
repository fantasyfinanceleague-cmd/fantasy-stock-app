import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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
  it('hydrates the full-motion server markup with no mismatch', async () => {
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

  it('shows the hero’s final state at once, the static panels, a paused ticker, and never re-sorts', async () => {
    vi.useFakeTimers();
    const { container } = render(<LandingPage />);
    await act(async () => {});
    const visible = [...container.querySelectorAll('.lp-hero .lp-count__live')].map((e) => e.textContent);
    expect(visible).toEqual(['+$56.80', '+$39.40']);
    expect(container.querySelector('.lp-board__header')?.textContent).toContain('Wednesday');
    expect(screen.getByText('NVDA +4.1% puts you ahead')).toBeInTheDocument();
    expect(container.querySelector('.lp-scrub')).toBeNull();
    expect(container.querySelectorAll('.lp-panel')).toHaveLength(4);
    expect(container.querySelector('.lp-ticker__track')?.getAttribute('data-state')).toBe('paused');
    expect(screen.getByRole('button', { name: 'Play the matchup ticker' })).toBeInTheDocument();

    const namesBefore = [...container.querySelectorAll('.lp-row__name')].map((e) => e.textContent);
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    const namesAfter = [...container.querySelectorAll('.lp-row__name')].map((e) => e.textContent);
    expect(namesAfter).toEqual(namesBefore);
    vi.useRealTimers();
  });
});
