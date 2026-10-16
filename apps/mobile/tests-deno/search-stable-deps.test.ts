/**
 * W8 tap-through finding F1: the draft queue's search showed its spinner for ever. QueueEditor passed
 * `ownedSymbols={new Set()}`, a fresh Set on every render, and useSymbolSearch takes `ownedSymbols` as an
 * effect dependency: every parent re-render re-ran the effect and cancelled the pending 300 ms debounce,
 * so the search never fired (the pre-draft League tab re-renders on a clock). The hook's own doc says the
 * Set must be memoized; this pins it at every caller.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

/** Source without comments, so a guard never passes on a comment that names the thing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

Deno.test('no screen builds the search\'s ownedSymbols inline (a new object per render cancels the debounce)', () => {
  const offenders: string[] = [];
  for (const [path, src] of Object.entries(SOURCES)) {
    if (!path.startsWith('app/') && !path.startsWith('components/')) continue;
    if (/ownedSymbols=\{\s*(new\s|\[|\{|Array\.from|\w+\.map\()/.test(code(src))) offenders.push(path);
  }
  assertEquals(offenders, [], 'pass a memoized or module-level Set');
});

Deno.test('QueueEditor passes one module-level Set to its search', () => {
  const src = code(SOURCES['components/game/QueueEditor.tsx']);
  assert(/const NO_OWNED_SYMBOLS: Set<string> = new Set\(\);/.test(src), 'the stable empty Set is declared at module level');
  assert(src.includes('ownedSymbols={NO_OWNED_SYMBOLS}'));
  assert(!src.includes('new Set()}'), 'no inline Set in the JSX');
});

Deno.test('the hook still lists ownedSymbols as an effect dependency (the reason the callers must be stable)', () => {
  const hook = code(SOURCES['lib/useSymbolSearch.ts']);
  assert(/\[query, selectedSymbol, limit, debounceMs, ownedSymbols,/.test(hook));
});
