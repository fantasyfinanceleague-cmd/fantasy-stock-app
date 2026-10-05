/**
 * Hermetic tests for lib/money/stockSheetApi.ts (the stock sheet's symbol
 * contract). Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { normalizeSymbol } from '../lib/money/stockSheetApi.ts';

Deno.test('normalizeSymbol: trims and uppercases a plausible ticker', () => {
  assertEquals(normalizeSymbol('  nvda '), 'NVDA');
  assertEquals(normalizeSymbol('BRK.B'), 'BRK.B');
});

Deno.test('normalizeSymbol: refuses anything that is not a plausible symbol, never a guess', () => {
  assertEquals(normalizeSymbol(''), null);
  assertEquals(normalizeSymbol(null), null);
  assertEquals(normalizeSymbol(undefined), null);
  assertEquals(normalizeSymbol('NV DIA'), null);
  assertEquals(normalizeSymbol('TOOLONGSYM'), null);
  assertEquals(normalizeSymbol("'; drop"), null);
});
