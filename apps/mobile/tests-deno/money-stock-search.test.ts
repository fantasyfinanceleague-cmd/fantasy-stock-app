/**
 * Hermetic tests for lib/money/stressFixture.ts's search catalog (3e STEP 2:
 * the stock-search fixture seam). Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { filterStressSearchCatalog } from '../lib/money/stressFixture.ts';

Deno.test('an empty query returns no results', () => {
  assertEquals(filterStressSearchCatalog(''), []);
  assertEquals(filterStressSearchCatalog('   '), []);
});

Deno.test('an exact symbol match ranks first', () => {
  const r = filterStressSearchCatalog('S010');
  assertEquals(r[0]?.symbol, 'S010');
});

Deno.test('a symbol prefix finds every matching symbol, case-insensitively', () => {
  const r = filterStressSearchCatalog('s09');
  assert(r.length > 0);
  for (const item of r) assert(item.symbol.startsWith('S09'));
});

Deno.test('a name fragment finds a match by company name', () => {
  const r = filterStressSearchCatalog('Holdings Corporation');
  assert(r.length > 0);
  for (const item of r) assert(item.name.toUpperCase().includes('HOLDINGS CORPORATION'));
});

Deno.test('every match is selectable: search never blocks on ownership', () => {
  const r = filterStressSearchCatalog('S0');
  assert(r.length > 0);
  for (const item of r) {
    assertEquals(item.selectable, true);
    assertEquals(item.badgeLabel, null);
  }
});

Deno.test('the result count is capped at the limit', () => {
  const r = filterStressSearchCatalog('S0', 3);
  assertEquals(r.length, 3);
});

Deno.test('the two unpriced stress symbols carry a null price, never a fabricated one', () => {
  const r = filterStressSearchCatalog('S001');
  assertEquals(r[0]?.price, null);
});
