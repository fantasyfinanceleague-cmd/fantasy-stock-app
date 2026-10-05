/**
 * Tests for lib/home/seasonGain.ts — the hero's "+$X · +Y% season gain"
 * segment (D1, Concept A). Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { seasonGain } from '../lib/home/seasonGain.ts';

Deno.test('gain = sum of scored weekly gains + the live gain', () => {
  const r = seasonGain([41.3, 58.75, -96.4, 72.1, 54.24], 238.6, 12000);
  assertEquals(r.gain, 368.59);
});

Deno.test('pct = gain / stake', () => {
  const r = seasonGain([100], 0, 12000);
  assertEquals(r.pct, (100 / 12000) * 100);
});

Deno.test('a zero stake never divides by zero', () => {
  const r = seasonGain([10], 0, 0);
  assertEquals(r.pct, 0);
});

Deno.test('null live gain (season complete, no live week) contributes nothing', () => {
  const r = seasonGain([10, 20], null, 1000);
  assertEquals(r.gain, 30);
});
