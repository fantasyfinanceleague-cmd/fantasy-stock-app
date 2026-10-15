// @vitest-environment node
//
// joinWeb.css's Game Night values are the board's themes.css (the app's
// color.ts), name for name, in both themes.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

function vars(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--c-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]));
}
function blockAfter(css: string, opener: string): string {
  const start = css.indexOf(opener);
  if (start < 0) throw new Error(`missing ${opener}`);
  return css.slice(start, css.indexOf('}', start));
}

const page = read('./joinWeb.css');
const board = read('../../../../docs/design/screens/themes.css');

describe('joinWeb.css tokens match docs/design/screens/themes.css', () => {
  const cases = [
    ['light', blockAfter(page, '.obw {'), blockAfter(board, "[data-ks-theme='light'] {")],
    ['dark', blockAfter(page.slice(page.indexOf('@media (prefers-color-scheme: dark)')), '.obw {'), blockAfter(board, "[data-ks-theme='dark'] {")],
  ] as const;

  it.each(cases)('%s', (_theme, ours, theirs) => {
    const mine = vars(ours);
    const ref = vars(theirs);
    expect(Object.keys(mine).length).toBeGreaterThan(10);
    for (const [name, value] of Object.entries(mine)) {
      expect({ name, value }).toEqual({ name, value: ref[name] });
    }
  });

  it('never sets a token on :root (nothing may reach the landing)', () => {
    expect(page.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/:root/);
  });
});
