/**
 * Tests for lib/home/draftTurn.ts — the drafting card's "whose turn"
 * math, mirroring app/(tabs)/draft.tsx's own inline snake-draft logic.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { currentPickerFor, picksUntilTurn } from '../lib/home/draftTurn.ts';

const ORDER = ['a', 'b', 'c']; // 3 teams

Deno.test('round 1 (odd, forward): pick 1 -> a, pick 2 -> b, pick 3 -> c', () => {
  assertEquals(currentPickerFor(ORDER, 0, 6).pickerId, 'a');
  assertEquals(currentPickerFor(ORDER, 1, 6).pickerId, 'b');
  assertEquals(currentPickerFor(ORDER, 2, 6).pickerId, 'c');
});

Deno.test('round 2 (even, reversed): pick 4 -> c, pick 5 -> b, pick 6 -> a', () => {
  assertEquals(currentPickerFor(ORDER, 3, 6).pickerId, 'c');
  assertEquals(currentPickerFor(ORDER, 4, 6).pickerId, 'b');
  assertEquals(currentPickerFor(ORDER, 5, 6).pickerId, 'a');
});

Deno.test('round 3 (odd again, forward): pick 7 -> a', () => {
  assertEquals(currentPickerFor(ORDER, 6, 6).round, 3);
  assertEquals(currentPickerFor(ORDER, 6, 6).pickerId, 'a');
});

Deno.test('an empty order returns a null picker rather than throwing', () => {
  const turn = currentPickerFor([], 0, 6);
  assertEquals(turn.pickerId, null);
});

Deno.test('picksUntilTurn: 0 when it is already your turn', () => {
  assertEquals(picksUntilTurn(ORDER, 0, 6, 'a'), 0);
});

Deno.test('picksUntilTurn: counts forward to the next occurrence, including a snake reversal', () => {
  // picksMade=1 -> pick 2 (b) is current. Picks 3,4,5,6 = c,c,b,a (round 2
  // reverses to [c,b,a], so c picks back-to-back at the turn — the
  // standard snake pattern). c is 1 pick away (pick 3); a is 4 picks away
  // (pick 6).
  assertEquals(picksUntilTurn(ORDER, 1, 6, 'c'), 1);
  assertEquals(picksUntilTurn(ORDER, 1, 6, 'a'), 4);
});
