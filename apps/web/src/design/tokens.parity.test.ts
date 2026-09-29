// @vitest-environment node
//
// Pure fs/string logic — no DOM needed, and jsdom's import.meta.url shim
// isn't a real file:// URL, which breaks fileURLToPath below.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tokens, flattenTokens, cssVarName } from './tokens';

// The audit's core finding (DESIGN_DIRECTION.md §2) is that tokens existed
// and were bypassed. This test is the mechanism that keeps tokens.ts (the
// JS/TS mirror) and ../styles/tokens.css (the CSS custom properties) from
// silently drifting apart — in both directions: every JS leaf must appear
// in the CSS with the same value, and the CSS must not carry an orphaned
// `--sp-*` property that no longer exists in tokens.ts.

const cssPath = fileURLToPath(new URL('../styles/tokens.css', import.meta.url));
const cssText = readFileSync(cssPath, 'utf-8');

function parseCssCustomProperties(text: string): Map<string, string> {
  const map = new Map<string, string>();
  // One `--sp-name: value;` declaration per line, as generated.
  const re = /^\s*(--sp-[a-z0-9-]+):\s*(.+?);\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    map.set(match[1], match[2]);
  }
  return map;
}

const cssVars = parseCssCustomProperties(cssText);
const leaves = flattenTokens(tokens);

describe('tokens.css / tokens.ts parity', () => {
  it('found at least one CSS custom property (parser sanity)', () => {
    expect(cssVars.size).toBeGreaterThan(50);
  });

  it('found the tokens.ts leaves (fixture sanity)', () => {
    expect(leaves.length).toBeGreaterThan(50);
  });

  it.each(leaves.map((leaf) => [cssVarName(leaf.path), leaf.value] as const))(
    'tokens.css has %s: %s',
    (varName, value) => {
      expect(cssVars.get(varName)).toBe(value);
    }
  );

  it('has no --sp-* property in tokens.css that is not in tokens.ts', () => {
    const expectedNames = new Set(leaves.map((leaf) => cssVarName(leaf.path)));
    const orphans = [...cssVars.keys()].filter((name) => !expectedNames.has(name));
    expect(orphans).toEqual([]);
  });

  it('is on :root, not scoped to a class (unlike stockpile-tokens.css)', () => {
    expect(cssText).toMatch(/^\s*:root\s*\{/m);
  });
});
