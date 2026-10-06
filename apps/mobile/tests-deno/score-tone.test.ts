/**
 * scoreTone (B6, Design Lead gate 2026-10-05): a $0.00 score is neutral on
 * EITHER side; a non-zero score keeps its own side's colour.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { scoreTone } from '../lib/home/scoreTone.ts';

Deno.test('scoreTone: a zero opponent score is neutral, not the opponent colour (leader_flip)', () => {
  assertEquals(scoreTone(0, 'opp'), 'zero');
});

Deno.test('scoreTone: a zero score on my side is neutral too', () => {
  assertEquals(scoreTone(0, 'you'), 'zero');
});

Deno.test('scoreTone: sub-cent noise rounds to zero and stays neutral', () => {
  assertEquals(scoreTone(0.004, 'opp'), 'zero');
  assertEquals(scoreTone(-0.004, 'you'), 'zero');
});

Deno.test('scoreTone: a non-zero score keeps its side colour', () => {
  assertEquals(scoreTone(12.34, 'you'), 'you');
  assertEquals(scoreTone(-90.45, 'opp'), 'opp');
});
