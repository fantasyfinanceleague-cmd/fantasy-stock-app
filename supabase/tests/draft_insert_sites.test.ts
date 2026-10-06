/**
 * Structural guard for the ONE draft legality authority (Giorgio's acceptance
 * criterion: auto-draft must never pick a stock the league's rules forbid).
 *
 * The type system already forces every pick write through a `GatedPick`
 * (supabase/functions/_shared/pick-gate.ts), which only `gatePick` —
 * validatePick on the live price — can produce. Two things the compiler
 * cannot see are checked here instead:
 *   1. a NEW drafts write that bypasses insertGatedPick entirely (another
 *      `.from('drafts').insert/upsert/update(...)` anywhere in the functions);
 *   2. a forged `as GatedPick` cast outside pick-gate.ts.
 * If this fails, route the new write through gatePick + insertGatedPick instead
 * of widening the allowlist. There is no SKIP writer any more (draft-never-skips,
 * 2026-10-05): a turn with no legal stock stalls (recordStall, draft_stalls).
 *
 * Reads files only (no network, no DB): run with
 *   deno test --allow-read supabase/tests/draft_insert_sites.test.ts
 */
import { assertEquals } from 'jsr:@std/assert';

const FUNCTIONS = new URL('../functions/', import.meta.url);

async function* tsFiles(dir: URL): AsyncGenerator<URL> {
  for await (const e of Deno.readDir(dir)) {
    const u = new URL(e.name + (e.isDirectory ? '/' : ''), dir);
    if (e.isDirectory) yield* tsFiles(u);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) yield u;
  }
}

function enclosingFunction(src: string, at: number): string {
  const before = src.slice(0, at);
  const m = [...before.matchAll(/(?:async\s+)?function\s+(\w+)|Deno\.serve\(/g)].pop();
  return m ? (m[1] ?? 'Deno.serve') : '<module>';
}

Deno.test('drafts rows are written ONLY by insertGatedPick (gated picks; no SKIP writer exists)', async () => {
  const sites: string[] = [];
  const casts: string[] = [];
  for await (const file of tsFiles(FUNCTIONS)) {
    // Blank out comment-only lines (same length, so offsets are unchanged): a
    // header that DESCRIBES an old direct insert is not a write site.
    const src = (await Deno.readTextFile(file))
      .split('\n')
      .map((l) => /^\s*(\/\/|\*|\/\*)/.test(l) ? ' '.repeat(l.length) : l)
      .join('\n');
    const rel = file.pathname.slice(FUNCTIONS.pathname.length);
    for (const m of src.matchAll(/\.from\(\s*['"`]drafts['"`]\s*\)[\s\S]{0,120}?\.(insert|upsert|update|delete)\(/g)) {
      sites.push(`${rel}:${enclosingFunction(src, m.index!)}:${m[1]}`);
    }
    for (const m of src.matchAll(/as\s+GatedPick\b/g)) casts.push(`${rel}:${enclosingFunction(src, m.index!)}`);
  }
  assertEquals(sites.sort(), ['_shared/draft-write.ts:insertGatedPick:insert']);
  assertEquals(casts, ['_shared/pick-gate.ts:gatePick']);
});
