/**
 * Hermetic unit tests for components/sp/logic/digits.ts — no RN, run with:
 *
 *   deno test apps/mobile/tests-deno/
 */
import { assertEquals } from 'jsr:@std/assert';
import { digitDiff, hasDigitsChanged } from '../components/sp/logic/digits.ts';

Deno.test('digitDiff: same-length strings, only the changed column is flagged', () => {
  const diff = digitDiff('123', '124');
  assertEquals(diff.length, 3);
  assertEquals(diff[0], { char: '1', prevChar: '1', changed: false });
  assertEquals(diff[1], { char: '2', prevChar: '2', changed: false });
  assertEquals(diff[2], { char: '4', prevChar: '3', changed: true });
});

Deno.test('digitDiff: identical strings flag nothing as changed', () => {
  const diff = digitDiff('$56.80', '$56.80');
  assertEquals(diff.every((d) => !d.changed), true);
});

Deno.test('digitDiff: a new leading digit (9 -> 10) has no prevChar and counts as changed', () => {
  const diff = digitDiff('9', '10');
  assertEquals(diff.length, 2);
  assertEquals(diff[0], { char: '1', prevChar: null, changed: true });
  // Right-aligned: the "9" column becomes "0", which IS a real change.
  assertEquals(diff[1], { char: '0', prevChar: '9', changed: true });
});

Deno.test('digitDiff: a value shrinking (10 -> 9) drops the leading column entirely', () => {
  const diff = digitDiff('10', '9');
  assertEquals(diff.length, 1);
  assertEquals(diff[0], { char: '9', prevChar: '0', changed: true });
});

Deno.test('digitDiff: right-aligns full money strings of different lengths', () => {
  const diff = digitDiff('$999.00', '$1,000.00');
  // "$999.00" (7 chars) right-aligned under "$1,000.00" (9 chars):
  //      $999.00
  //    $1,000.00
  // columns 0-1 ("$1") are new; the rest line up character-for-character.
  assertEquals(diff.length, 9);
  assertEquals(diff[0], { char: '$', prevChar: null, changed: true });
  assertEquals(diff[1], { char: '1', prevChar: null, changed: true });
  assertEquals(diff[2], { char: ',', prevChar: '$', changed: true });
});

Deno.test('hasDigitsChanged: true only when the formatted strings differ', () => {
  assertEquals(hasDigitsChanged('$56.80', '$56.80'), false);
  assertEquals(hasDigitsChanged('$56.80', '$56.90'), true);
});
