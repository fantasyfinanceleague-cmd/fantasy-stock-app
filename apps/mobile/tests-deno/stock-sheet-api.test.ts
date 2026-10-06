/**
 * Hermetic tests for lib/money/stockSheetApi.ts: the stock sheet's symbol
 * contract, the backward-compatible open() argument, and name precedence.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { normalizeOpenOptions, normalizeSymbol, resolveSheetName } from '../lib/money/stockSheetApi.ts';

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

Deno.test('open(): the legacy origin-ref string still works (3c compatibility)', () => {
  assertEquals(normalizeOpenOptions('row-42'), { name: null, originRef: 'row-42' });
  assertEquals(normalizeOpenOptions(), { name: null, originRef: null });
  assertEquals(normalizeOpenOptions(null), { name: null, originRef: null });
});

Deno.test('open(): the options object carries the name and the origin', () => {
  assertEquals(normalizeOpenOptions({ name: '  NVIDIA Corp ', originRef: 'lineup-3' }), { name: 'NVIDIA Corp', originRef: 'lineup-3' });
  assertEquals(normalizeOpenOptions({ originRef: 'search' }), { name: null, originRef: 'search' });
});

Deno.test('open(): a blank name is no name, so the read still happens', () => {
  assertEquals(normalizeOpenOptions({ name: '   ' }).name, null);
  assertEquals(normalizeOpenOptions({ name: '' }).name, null);
});

Deno.test('name precedence: the opener, then the ledger, then the cache, then a read', () => {
  assertEquals(resolveSheetName({ openerName: 'From Search', ledgerName: 'Ledger', cachedName: 'Cache' }), { name: 'From Search', source: 'opener' });
  assertEquals(resolveSheetName({ openerName: null, ledgerName: 'Ledger', cachedName: 'Cache' }), { name: 'Ledger', source: 'ledger' });
  assertEquals(resolveSheetName({ openerName: null, ledgerName: null, cachedName: 'Cache' }), { name: 'Cache', source: 'cache' });
  assertEquals(resolveSheetName({ openerName: null, ledgerName: null, cachedName: null }), { name: null, source: null });
});
