#!/usr/bin/env node
/**
 * gen-tappables.mjs: the dead-controls inventory (W8, "Nothing tappable does nothing").
 *
 * No dependencies. Node built-ins only.
 *
 *   node scripts/gen-tappables.mjs            # write docs/design/reviews/tappables.md
 *   node scripts/gen-tappables.mjs --check    # exit 1 if the committed file is stale
 *
 * Scans apps/mobile/app and apps/mobile/components (not node_modules, tests-deno,
 * __tests__ or the dev-only design-gallery.tsx) for every tappable: Pressable,
 * PressableScale, Touchable*, Link, and any element taking a tap prop (onPress,
 * onLongPress, a composite's onAction / onRetry / onSelect, a control's onChange).
 * Each row names the handler and, where the text says, its destination. The parsing
 * lives in scripts/tappables-scan.mjs, shared with the static no-op check in
 * apps/mobile/tests-deno/no-op-handlers.test.ts.
 *
 * Re-run after adding, moving or rewiring a control, and commit the result.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTappables, EXCLUDED_FILES } from './tappables-scan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = join(ROOT, 'apps/mobile');
const OUT = join(ROOT, 'docs/design/reviews/tappables.md');
const SCAN_ROOTS = ['app', 'components'];
const SKIP_DIRS = new Set(['node_modules', 'tests-deno', '__tests__', '.expo']);

const CHECK_ONLY = process.argv.slice(2).includes('--check');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((r) => walk(join(MOBILE, r)))
  .map((p) => relative(MOBILE, p).split('\\').join('/'))
  .filter((f) => !EXCLUDED_FILES.has(f));

const { markdown: out, rows, findings } = renderTappables(files.map((f) => [f, readFileSync(join(MOBILE, f), 'utf8')]));

if (CHECK_ONLY) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current === out) {
    console.log(`tappables.md is current (${rows.length} tappables, ${findings.length} no-op findings).`);
    process.exit(0);
  }
  const a = new Set(current.split('\n'));
  const b = new Set(out.split('\n'));
  for (const l of current.split('\n')) if (!b.has(l)) console.log(`- ${l}`);
  for (const l of out.split('\n')) if (!a.has(l)) console.log(`+ ${l}`);
  console.error('tappables.md is stale: run `node scripts/gen-tappables.mjs` and commit the result.');
  process.exit(1);
}
writeFileSync(OUT, out);
console.log(`wrote ${relative(ROOT, OUT)}: ${rows.length} tappables, ${findings.length} no-op findings.`);
