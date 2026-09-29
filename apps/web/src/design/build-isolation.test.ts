// @vitest-environment node
//
// Pure fs/string logic — no DOM needed, and jsdom's import.meta.url shim
// isn't a real file:// URL, which breaks fileURLToPath below.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Fast, static first line of defense for the branch's hardest requirement:
// merging to main deploys the web app to Vercel, and the landing must ship
// byte-identical. The real proof is a `dist/` diff against origin/main (see
// the worker's DONE report) — this test just catches an accidental import
// early, at `npm test` speed, before anyone reaches for a full build.

const entryFiles = ['../main.jsx', '../App.jsx'].map((rel) =>
  fileURLToPath(new URL(rel, import.meta.url))
);

const forbiddenPatterns = [
  /from ['"].*\/design(\/index)?['"]/,
  /from ['"].*styles\/tokens\.css['"]/,
  /from ['"].*design\/fonts\.css['"]/,
];

describe('the production entry points never import the design system', () => {
  it.each(entryFiles)('%s has no import of src/design or its CSS', (file) => {
    const text = readFileSync(file, 'utf-8');
    for (const pattern of forbiddenPatterns) {
      expect(text).not.toMatch(pattern);
    }
  });
});
