/**
 * W8 tap-through F2: Check availability read a FAILED symbols read as "stock data is still loading" (and a failed
 * per-slot count as zero matches). supabase-js resolves `{ count, error }` and does not throw, so the component's
 * "couldn't check" catch was dead code. readResult.ts turns a resolved error into the throw it expects.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert';
import { countOrThrow, rowsOrThrow } from '../lib/readResult.ts';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('countOrThrow: a failed read throws (never reads as zero); a clean read returns its count', () => {
  assertThrows(() => countOrThrow({ count: null, error: { message: 'FetchError' } }, 'symbols total'), Error, 'symbols total: FetchError');
  assertThrows(() => countOrThrow({ count: 5, error: { message: 'x' } }, 'a'), Error, 'a: x');
  assertThrows(() => countOrThrow({ count: null, error: {} }, 'a'), Error, 'a: read failed');
  assertEquals(countOrThrow({ count: 14754, error: null }, 'a'), 14754);
  assertEquals(countOrThrow({ count: 0, error: null }, 'a'), 0, 'a clean zero is a real zero');
  assertEquals(countOrThrow({ count: null, error: null }, 'a'), 0, 'a clean read with no count is zero');
});

Deno.test('rowsOrThrow: a failed read throws (never reads as empty); a clean read returns its rows', () => {
  assertThrows(() => rowsOrThrow({ data: null, error: { message: 'boom' } }, 'category rules'), Error, 'category rules: boom');
  assertEquals(rowsOrThrow({ data: [{ id: 1 }], error: null }, 'a'), [{ id: 1 }]);
  assertEquals(rowsOrThrow({ data: null, error: null }, 'a'), []);
});

Deno.test('the availability reads unwrap their results (source pin: no bare { count } / { data } destructure)', () => {
  const src = SOURCES['lib/categoryData.ts'];
  const start = src.indexOf('export async function fetchEnrichmentProgress');
  const end = src.indexOf('export function validateSlotConfig');
  const body = src.slice(start, end);
  assert(body.includes("countOrThrow(totalRes, 'symbols total')") && body.includes("countOrThrow(enrichedRes, 'symbols enriched')"));
  assert(body.includes("rowsOrThrow(ruleRes, 'category rules')") && body.includes("rowsOrThrow(overrideRes, 'category overrides')"));
  assert(!/const \{ count[:\s}]/.test(body) && !/\{ data: (ruleRows|allOverrides) \}/.test(body), 'a resolved error would read as zero or empty');
});

Deno.test('SlotBuilder still shows the "couldn\'t check" line from its catch', () => {
  const comp = SOURCES['components/SlotBuilder.tsx'];
  assert(comp.includes('} catch {\n      found.push(SLOT_CHECK_FAILED);'));
});
