import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import LandingPage from './LandingPage';
import { CHAPTER_BEATS } from './pacing';
import { __resetTierForTests } from './tier';

// Design Lead, round 4 (condition b): FULL and ENHANCED share every scroll
// length and beat, so a tier switch (including a runtime demotion) never
// moves the page. The FULL scenes are stubbed: this is about layout.

vi.mock('./full', () => {
  const Stub = ({ onPainted }: { onPainted: () => void }) => {
    useEffect(onPainted, [onPainted]);
    return <div data-stub-scene />;
  };
  return { scenes: { hero: Stub, inside: Stub, chapter: Stub, leagues: Stub } };
});

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: !query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  __resetTierForTests();
  vi.restoreAllMocks();
});

async function layoutAt(tier: 'full' | 'enhanced') {
  window.history.replaceState(null, '', `/?tier=${tier}`);
  __resetTierForTests();
  const { container, unmount } = render(<LandingPage />);
  await act(async () => {});
  if (tier === 'full') await waitFor(() => expect(container.querySelectorAll('[data-stub-scene]').length).toBeGreaterThan(0));
  const snapshot = {
    layers: [...container.querySelectorAll('main > .lp-layer')].map((l) => l.className),
    chapterHeight: (container.querySelector('.lp-chapter') as HTMLElement | null)?.style.height,
    insidePinned: container.querySelector('.lp-inside--pinned') !== null,
    insideTrack: container.querySelector('.lp-inside__track') !== null,
  };
  const scenes = container.querySelectorAll('[data-stub-scene]').length;
  unmount();
  return { snapshot, scenes };
}

describe('tiers share scroll lengths', () => {
  it('FULL and ENHANCED lay the page out identically (the 3D sits in absolutely positioned stages)', async () => {
    const enhanced = await layoutAt('enhanced');
    const full = await layoutAt('full');
    expect(enhanced.scenes).toBe(0);
    expect(full.scenes).toBeGreaterThan(0);
    expect(full.snapshot).toEqual(enhanced.snapshot);
    // jsdom folds the calc(); the source is `calc(${total}svh + 100svh)`.
    expect(full.snapshot.chapterHeight).toBe(`calc(${CHAPTER_BEATS.total + 100}svh)`);
    expect(full.snapshot.insidePinned).toBe(true);
  });
});
