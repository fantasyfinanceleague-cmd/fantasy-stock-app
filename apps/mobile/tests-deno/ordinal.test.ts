/**
 * Tests for lib/home/ordinal.ts, shared by HomeHero's rank line and
 * SeasonCompleteCard's tiles/place headline (S6, Design Lead ruling,
 * 2026-09-30).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { ordinal } from '../lib/home/ordinal.ts';

Deno.test('ordinal: 1st, 2nd, 3rd, 4th', () => {
  assertEquals(ordinal(1), '1st');
  assertEquals(ordinal(2), '2nd');
  assertEquals(ordinal(3), '3rd');
  assertEquals(ordinal(4), '4th');
});

Deno.test('ordinal: 11th, 12th, 13th are "th", not "st"/"nd"/"rd"', () => {
  assertEquals(ordinal(11), '11th');
  assertEquals(ordinal(12), '12th');
  assertEquals(ordinal(13), '13th');
});

Deno.test('ordinal: 21st, 22nd, 23rd resume the normal pattern after the teens', () => {
  assertEquals(ordinal(21), '21st');
  assertEquals(ordinal(22), '22nd');
  assertEquals(ordinal(23), '23rd');
});
