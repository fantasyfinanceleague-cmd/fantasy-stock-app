// @vitest-environment node
//
// Pure fs/string logic — no DOM needed, and jsdom's import.meta.url shim
// isn't a real file:// URL, which breaks fileURLToPath below.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// DESIGN_DIRECTION.md §4/§5: every motion value comes from the token set
// (motion.duration.*, motion.ease.*, motion.spring.*) via useMotion(), never
// an inline literal. The token FILES themselves are exempt (they're the one
// place a raw ms/cubic-bezier value is allowed to live); everything else
// under src/design must reach for the tokens instead.

const designDir = fileURLToPath(new URL('.', import.meta.url));
// tokens.ts / motion.ts: the token source itself, allowed to hold raw
// values. useMotion.ts: parses those token strings (e.g. extracts the
// numbers out of a `cubic-bezier(...)` token value) — infrastructure, not a
// component reaching for an inline value instead of the tokens.
const EXEMPT_BASENAMES = new Set(['tokens.ts', 'motion.ts', 'useMotion.ts']);

function collectCodeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectCodeFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && !EXEMPT_BASENAMES.has(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Matches a bare numeric millisecond literal used as a duration, e.g.
// `240` or `380ms` in a motion-shaped call, and a raw cubic-bezier(...).
// Deliberately narrow (not "any number") so token pixel/size values like
// `size={24}` don't false-positive — and `duration: 0` (explicitly "skip
// the animation", the reduced-motion escape hatch) is exempt: it isn't a
// made-up timing value, it's the absence of one.
const INLINE_DURATION = /\bduration:\s*[1-9]\d*\b|\b\d+ms\b|cubic-bezier\(/;

describe('the INLINE_DURATION pattern itself', () => {
  it('flags a made-up literal duration', () => {
    expect('transition={{ duration: 350 }}').toMatch(INLINE_DURATION);
  });

  it('flags a raw ms literal and a raw cubic-bezier()', () => {
    expect('animation: pulse 380ms;').toMatch(INLINE_DURATION);
    expect("ease: cubic-bezier(0.2, 0, 1, 1)").toMatch(INLINE_DURATION);
  });

  it('does NOT flag duration: 0 (the reduced-motion "skip it" escape hatch)', () => {
    expect('{ duration: 0 }').not.toMatch(INLINE_DURATION);
  });

  it('does NOT flag an unrelated size prop', () => {
    expect('size={24}').not.toMatch(INLINE_DURATION);
  });
});

describe('no inline motion durations/easings outside the token files', () => {
  const files = collectCodeFiles(designDir);

  it('found source files to check (fixture sanity)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => path.relative(designDir, f)))('%s has no inline duration/easing', (rel) => {
    const text = readFileSync(path.join(designDir, rel), 'utf-8');
    expect(text).not.toMatch(INLINE_DURATION);
  });
});
