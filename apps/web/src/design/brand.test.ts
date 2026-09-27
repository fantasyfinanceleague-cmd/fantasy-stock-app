// @vitest-environment node
//
// Pure fs/string logic — no DOM needed, and jsdom's import.meta.url shim
// isn't a real file:// URL, which breaks fileURLToPath below.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { brand as brandBase } from '../brand';
import { brand } from './index';

// DESIGN_DIRECTION.md "Decisions — 2026-09-26" (name caveat): the name may
// change, so nothing NEW hard-codes "Stockpile". src/brand.ts is the one
// permitted spelling; everything under src/design must go through
// `brand.name` / `brand.wordmark` instead of the literal string.

const designDir = fileURLToPath(new URL('.', import.meta.url));

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx|css)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('brand name is swappable', () => {
  it('brand.name / brand.wordmark are currently "Stockpile"', () => {
    expect(brandBase.name).toBe('Stockpile');
    expect(brandBase.wordmark).toBe('Stockpile');
  });

  it('brand.mark exists and is combined onto the design barrel export', () => {
    expect(brand.name).toBe(brandBase.name);
    expect(typeof brand.mark).toBe('function');
  });

  it('no file under src/design hard-codes the literal "Stockpile" in code or copy', () => {
    // Strip comments first: an engineering comment naming the current
    // project ("Stockpile design tokens", a file header) is not the thing
    // DESIGN_DIRECTION.md's name caveat is about — a literal reachable from
    // UI copy, a default prop, or an aria-label is. Good enough for a
    // defensive check; not meant to survive adversarial obfuscation.
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const files = collectSourceFiles(designDir);
    const offenders = files.filter((f) => stripComments(readFileSync(f, 'utf-8')).includes('Stockpile'));
    expect(offenders.map((f) => path.relative(designDir, f))).toEqual([]);
  });
});
