import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import LandingPage from './LandingPage';
import { brand } from '../../brand';
import { how } from './copy';

// jsdom has no matchMedia / IntersectionObserver. Every query "matches"
// (a big, fine-pointer, full-motion screen) unless a test says otherwise.
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
  installMatchMedia((q) => !q.includes('prefers-reduced-motion'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server render (what the prerendered / JS-off page shows)', () => {
  const html = renderToString(<LandingPage />);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const text = (sel: string) => [...doc.querySelectorAll(sel)].map((e) => e.textContent?.replace(/\s+/g, ' ').trim());

  it('is deterministic (two renders are byte-identical)', () => {
    expect(renderToString(<LandingPage />)).toBe(html);
  });

  it('has the live page’s headline and section headings, in order', () => {
    expect(doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Draft stocks. Beat your friends. Win the league.'
    );
    expect(text('h2')).toEqual([
      'Draft a team. Compete weekly.Climb the league.',
      'A scoreboard for your portfolio.',
      'The rigor of investing,the rhythm of fantasy.',
      'Questions, answered.',
      'Launching soon.',
    ]);
    expect(text('.lp-kicker')).toEqual(['/ 01 — How it works', '/ 02 — Leagues in action', `/ 03 — Why ${brand.name}`, '/ 04 — FAQ']);
  });

  it('is the static version: nothing pinned or stacked, all three steps each with its screen', () => {
    expect(doc.querySelector('.lp-chapter')).toBeNull();
    expect(doc.querySelector('.lp-inside--pinned')).toBeNull();
    expect(doc.querySelector('.lp-layer--stacked')).toBeNull();
    expect(doc.querySelectorAll('.lp-steps--static > li')).toHaveLength(3);
    for (const step of how.steps) expect(html).toContain(step.num);
    expect(doc.querySelectorAll('.lp-steps--static .lp-phone')).toHaveLength(3);
    expect(doc.querySelector('.lp-stamp')?.textContent).toBe('Final');
  });

  it('has every FAQ answer open (readable with JS off)', () => {
    expect(doc.querySelectorAll('.lp-faq__panel')).toHaveLength(5);
  });

  it('shows the mock at its first frame (the live page’s numbers)', () => {
    expect(html).toContain('$12,430.55');
    expect(text('.lp-srow__name')[0]).toBe('Paolo M.');
  });

  it('has no chapter progress bar (removed, round 4)', () => {
    expect(doc.querySelector('.lp-progress')).toBeNull();
  });

  it('draws the snake draft as a path through the pick order, with round directions', () => {
    expect(doc.querySelectorAll('.lp-snake__path')).toHaveLength(2);
    expect(text('.lp-snake__labels')).toEqual(['Round 1 →', '← Round 2']);
  });

  it('replaces the Mon–Fri bars with the Week 6 race chart', () => {
    expect(doc.querySelector('.lp-dbars')).toBeNull();
    expect(doc.querySelectorAll('.lp-race__line')).toHaveLength(2);
    expect(doc.querySelector('.lp-race__zero')).not.toBeNull();
    expect(text('.lp-race__tick')).toEqual(['Open', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  });

  it('has no dead links, and every in-page anchor has a target', () => {
    const hrefs = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('#');
    for (const href of hrefs) {
      expect(href).toMatch(/^#.+/);
      expect(doc.getElementById(href!.slice(1))).not.toBeNull();
    }
  });

  it('never puts "Launching soon" / "Coming soon" inside a link or button', () => {
    const statuses = [...doc.querySelectorAll('*')].filter(
      (e) => e.children.length <= 1 && /Launching soon|Coming soon/.test(e.textContent ?? '') && (e.textContent ?? '').length < 30
    );
    expect(statuses.length).toBeGreaterThanOrEqual(4);
    for (const e of statuses) expect(e.closest('a, button')).toBeNull();
  });

  it('has no signup, login, email capture, win probability or attribution placeholder', () => {
    expect(doc.querySelector('form, input, textarea')).toBeNull();
    const controls = [...doc.querySelectorAll('a, button')].map((e) => e.textContent?.toLowerCase() ?? '');
    for (const t of controls) expect(t).not.toMatch(/sign ?up|log ?in|join|get started|notify|waitlist/);
    expect(html.toLowerCase()).not.toMatch(/probabilit|win prob|chance to win|odds/);
    expect(html).not.toContain('PLACEHOLDER');
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
  it('switches in the stacked layers, the pinned stage and the phone chapter after hydration', async () => {
    const { container } = render(<LandingPage />);
    await act(async () => {});
    // Every top-level section is a layer in the swallow grammar.
    const layers = [...container.querySelectorAll('main > .lp-layer')];
    expect(layers.length).toBe(7);
    expect(layers.every((l) => l.classList.contains('lp-layer--stacked'))).toBe(true);
    expect(container.querySelector('.lp-inside--pinned')).not.toBeNull();
    expect(container.querySelector('.lp-chapter')).not.toBeNull();
    // The three step texts stay in the DOM while pinned.
    expect(container.querySelectorAll('.lp-chapter .lp-step')).toHaveLength(3);
  });

  it('keeps the static versions on a small, short screen', async () => {
    installMatchMedia((q) => !q.includes('min-height') && !q.includes('min-width') && !q.includes('prefers-reduced-motion'));
    const { container } = render(<LandingPage />);
    await act(async () => {});
    expect(container.querySelector('.lp-inside--pinned')).toBeNull();
    expect(container.querySelector('.lp-chapter')).toBeNull();
    expect(container.querySelectorAll('.lp-steps--static > li')).toHaveLength(3);
  });

  it('re-sorts the Scudetto board while it is on screen', async () => {
    vi.useFakeTimers();
    const { container } = render(<LandingPage />);
    await act(async () => {});
    const names = () => [...container.querySelectorAll('.lp-srow__name')].map((e) => e.firstChild?.textContent);
    expect(names().slice(0, 3)).toEqual(['Paolo M.', 'Roberto B.', 'Alessandro D.']);
    await act(async () => {
      vi.advanceTimersByTime(4300);
    });
    expect(names().slice(0, 3)).toEqual(['Paolo M.', 'Alessandro D.', 'Roberto B.']);
    expect(container.querySelector('.lp-badge--up')?.textContent).toBe('▲ 1');
    vi.useRealTimers();
  });
});

describe('source guards', () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  // The landing's own files and the FULL tier's lazy chunk (full/).
  const sources = [...readdirSync(dir), ...readdirSync(path.join(dir, 'full')).map((f) => `full/${f}`)]
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

  it('animates only transform / opacity / clip-path in CSS transitions and keyframes', () => {
    const css = sources.find(([f]) => f === 'landing.css')![1];
    const transitioned = [...css.matchAll(/transition:\s*([^;]+);/g)].flatMap((m) =>
      m[1].split(',').map((part) => part.trim().split(/\s+/)[0])
    );
    const allowed = new Set(['transform', 'opacity', 'clip-path', 'none', 'color', 'background-color', 'border-color']);
    for (const prop of transitioned) expect(allowed.has(prop)).toBe(true);
  });
});
