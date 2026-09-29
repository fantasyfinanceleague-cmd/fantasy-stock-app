/**
 * STRUCTURAL GUARD (reads files only): the draft order is STORED
 * (league_draft_order, 20261013000000) and nothing may derive one again.
 * Run: deno test --allow-read supabase/tests/draft_order_no_derivation.test.ts
 *
 * Before 20261013000000 the commissioner-first rule lived in THREE copies —
 * computeDraftOrder (edge), draft.tsx (mobile), DraftPage.jsx (web) — and had
 * to be kept byte-identical by hand. A fourth copy, or a revived one, would
 * silently disagree with the server about whose turn it is, and would put the
 * commissioner first by default, which the product rule forbids.
 */
import { assertEquals } from 'jsr:@std/assert';

const ROOT = new URL('../../', import.meta.url);
const SCAN = ['supabase/functions', 'apps/mobile/app', 'apps/mobile/lib', 'apps/web/src'];
const CODE = /\.(ts|tsx|js|jsx|mjs)$/;
const SKIP = /(\.test\.|\/tests?\/|\/tests-deno\/|node_modules)/;

// A call, an import, or a definition — not a mention in a comment
// ("the old computeDraftOrder (commissioner first…)" has a space before '(').
const DERIVE_FN = /computeDraftOrder\(|computeDraftOrder\s*[,}]|function\s+computeDraftOrder/;
// The commissioner-first shape itself, however it is named:
//   ids.filter(id => id !== commissionerId).sort()
const COMMISSIONER_FILTER_SORT = /\.filter\([^)]*commissioner[^)]*\)\s*\.sort\(\s*\)/i;

async function* walk(dir: URL): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const u = new URL(e.name + (e.isDirectory ? '/' : ''), dir);
    if (e.isDirectory) {
      if (e.name === 'node_modules') continue;
      yield* walk(u);
    } else if (CODE.test(e.name)) {
      yield u.pathname;
    }
  }
}

Deno.test('no production file derives a draft order', async () => {
  const hits: string[] = [];
  let scanned = 0;
  for (const rel of SCAN) {
    for await (const path of walk(new URL(rel + '/', ROOT))) {
      if (SKIP.test(path)) continue;
      scanned++;
      const src = await Deno.readTextFile(path);
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (DERIVE_FN.test(line) || COMMISSIONER_FILTER_SORT.test(line)) {
          hits.push(`${path.replace(ROOT.pathname, '')}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  }
  // Guard the guard: a wrong root would scan nothing and "pass".
  if (scanned < 50) throw new Error(`scanned only ${scanned} files — wrong root?`);
  assertEquals(hits, [], 'read the STORED order (get_draft_order / league_draft_order) instead');
});
