import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import LandingPage from './LandingPage';
import { brand } from '../../brand';
import { STEPS } from './sampleData';

// jsdom has no matchMedia / IntersectionObserver. Every query "matches"
// (so the scrub's min-height gate passes) unless a test says otherwise.
function installMatchMedia(matches: (q: string) => boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  installMatchMedia((q) => !q.includes('prefers-reduced-motion: reduce'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server render (what the prerendered / JS-off page shows)', () => {
  const html = renderToString(<LandingPage />);
  const doc = new DOMParser().parseFromString(html, 'text/html');

  it('is deterministic (two renders are byte-identical)', () => {
    expect(renderToString(<LandingPage />)).toBe(html);
  });

  it('has the headline and every section heading', () => {
    expect(doc.querySelector('h1')?.textContent).toBe('Your portfolio vs. your friends. Every week.');
    const h2s = [...doc.querySelectorAll('h2')].map((h) => h.textContent);
    expect(h2s).toEqual(['How a week works', 'Leagues in action', 'Real prices. No real money.', 'Questions', 'Launching soon']);
  });

  it('has all four step texts, and the static four panels (no scrub without JS)', () => {
    for (const step of STEPS) expect(html).toContain(step.body.replace(/’/g, '&#x27;').slice(0, 20).replace(/&#x27;.*/, ''));
    expect(doc.querySelectorAll('.lp-steps > li')).toHaveLength(4);
    expect(doc.querySelectorAll('.lp-panel')).toHaveLength(4);
    expect(doc.querySelector('.lp-scrub')).toBeNull();
  });

  it('shows the hero at "Monday open", both scores $0.00 (labelled, not a mystery 0–0)', () => {
    expect(doc.querySelector('.lp-board__header')?.textContent).toContain('Monday open');
    const visible = [...doc.querySelectorAll('.lp-hero .lp-count__live')].map((e) => e.textContent);
    expect(visible).toEqual(['$0.00', '$0.00']);
  });

  it('has every FAQ answer open (readable with JS off)', () => {
    expect(doc.querySelectorAll('.lp-faq__panel')).toHaveLength(6);
  });

  it('has no dead links, and every in-page anchor has a target', () => {
    const hrefs = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('#');
    for (const href of hrefs) {
      expect(href).toMatch(/^#.+/);
      expect(doc.getElementById(href!.slice(1))).not.toBeNull();
    }
  });

  it('never puts "Launching soon" inside a link or button', () => {
    const statuses = [...doc.querySelectorAll('*')].filter(
      (e) => e.children.length === 0 && e.textContent?.includes('Launching soon')
    );
    expect(statuses.length).toBeGreaterThan(0);
    for (const e of statuses) expect(e.closest('a, button')).toBeNull();
  });

  it('has no signup, login, email capture or win probability', () => {
    expect(doc.querySelector('form, input, textarea')).toBeNull();
    // The FAQ may SAY there's no signup; no control may OFFER one.
    const controls = [...doc.querySelectorAll('a, button')].map((e) => e.textContent?.toLowerCase() ?? '');
    for (const text of controls) expect(text).not.toMatch(/sign ?up|log ?in|join|get started|notify|waitlist/);
    expect(html.toLowerCase()).not.toMatch(/probabilit|chance to win|win %|odds/);
  });

  it('spells the product name only through brand.name', () => {
    expect(html).toContain(brand.name);
  });
});

describe('hydration', () => {
  it('hydrates the server markup with no mismatch warnings', async () => {
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
  });
});

describe('full motion (client)', () => {
  it('swaps the static panels for the pinned scrub after hydration', async () => {
    const { container } = render(<LandingPage />);
    await act(async () => {});
    expect(container.querySelector('.lp-scrub')).not.toBeNull();
    // The four step texts stay in the DOM while scrubbing.
    for (const step of STEPS) expect(screen.getByText(step.title)).toBeInTheDocument();
  });

  it('keeps the static panels on a short viewport', async () => {
    installMatchMedia((q) => !q.includes('min-height') && !q.includes('prefers-reduced-motion: reduce'));
    const { container } = render(<LandingPage />);
    await act(async () => {});
    expect(container.querySelector('.lp-scrub')).toBeNull();
    expect(container.querySelectorAll('.lp-panel')).toHaveLength(4);
  });
});

describe('source guards', () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const sources = readdirSync(dir)
    .filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\./.test(f))
    .map((f) => [f, readFileSync(path.join(dir, f), 'utf-8')] as const);

  it.each(sources.map(([f]) => f))('%s never spells the product name', (file) => {
    const text = sources.find(([f]) => f === file)![1];
    expect(text).not.toMatch(new RegExp(brand.name, 'i'));
  });

  it.each(sources.map(([f]) => f))('%s has no inline ms duration or raw cubic-bezier', (file) => {
    const text = sources.find(([f]) => f === file)![1];
    expect(text).not.toMatch(/\bduration:\s*[1-9]\d*\b|\b\d+ms\b|cubic-bezier\(/);
  });

  it('landing.css uses no raw colours (tokens only)', () => {
    const css = sources.find(([f]) => f === 'landing.css')![1];
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it.each(sources.map(([f]) => f))('%s imports no legacy app CSS, providers or Supabase', (file) => {
    const text = sources.find(([f]) => f === file)![1];
    expect(text).not.toMatch(/layout\.css|index\.css|App\.css|stockpile-tokens|\/context\/|supabase|components\/Toast/);
  });
});
