/**
 * Hermetic tests for lib/money/salePicker.ts (3e, board #money "Which sale pays
 * for this?"): the picker opens on the server's first sale, lists one row per
 * source in the server's order, and selects exactly the chosen row.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { defaultSourceId, pickerRows } from '../lib/money/salePicker.ts';

const SOURCES = [
  { trade_id: 't-tsla', symbol: 'TSLA', amount: 333.25 },
  { trade_id: 't-amzn', symbol: 'AMZN', amount: 120 },
];

Deno.test('the picker opens on the first source, and none when there are no sales', () => {
  assertEquals(defaultSourceId(SOURCES), 't-tsla');
  assertEquals(defaultSourceId([]), null);
});

Deno.test('one row per source, in the server order, labelled by slot', () => {
  const rows = pickerRows(SOURCES, 't-tsla');
  assertEquals(rows.map((r) => r.label), ['TSLA slot', 'AMZN slot']);
  assertEquals(rows.map((r) => r.amount), [333.25, 120]);
});

Deno.test('exactly the chosen row is selected', () => {
  assertEquals(pickerRows(SOURCES, 't-amzn').map((r) => r.selected), [false, true]);
});

Deno.test('a choice that is not among the sources selects nothing', () => {
  assertEquals(pickerRows(SOURCES, 'gone').map((r) => r.selected), [false, false]);
});
