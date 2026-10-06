/**
 * No placeholder copy reaches a player (P0, Design Lead audit 2026-10-06): the
 * draft room showed "[new copy: would_strand_slot]" to players. Every app
 * source file (app/, components/, lib/, constants/) is scanned, read as text
 * through the generated manifest (no --allow-read needed). After adding or
 * removing a source file, regenerate it: `node tests-deno/gen-source-manifest.mjs`
 * (`--check` reports a stale one). Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

const MARKER = '[new' + ' copy'; // split so this file never matches itself

Deno.test('no app source file contains a "[new copy" placeholder', () => {
  const hits = Object.entries(SOURCES)
    .filter(([, text]) => text.includes(MARKER))
    .map(([path]) => path);
  assertEquals(hits, []);
});

Deno.test('the manifest covers the whole app (sanity: the scan is not looking at nothing)', () => {
  const paths = Object.keys(SOURCES);
  assertEquals(paths.length > 250, true, `only ${paths.length} files`);
  for (const p of ['app/(tabs)/league.tsx', 'components/game/DraftRoom.tsx', 'lib/game/draftRoom.ts', 'lib/game/draftQueue.ts', 'lib/game/draftRefusals.ts']) {
    assertEquals(p in SOURCES, true, p);
  }
});
