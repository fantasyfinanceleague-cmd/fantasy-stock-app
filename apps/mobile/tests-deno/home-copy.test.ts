/**
 * Tests for lib/home/homeCopy.ts's unpriced-symbol captions (Design Lead
 * ruling, 2026-09-29, code review finding I12): reuse plCoverage.ts's
 * `unpricedNote` wording rather than authoring new copy for the hero and
 * ThisWeekCard captions.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { heroUnpricedCaption, sideUnpricedCaption } from '../lib/home/homeCopy.ts';

Deno.test('heroUnpricedCaption: null when both lists are empty', () => {
  assertEquals(heroUnpricedCaption([], []), null);
});

Deno.test('heroUnpricedCaption: singular wording for exactly one symbol', () => {
  assertEquals(heroUnpricedCaption(['ZZZZ'], []), '1 holding counted at cost (no live price yet)');
});

Deno.test('heroUnpricedCaption: counts DISTINCT symbols across unpricedValue and unpricedToday, not the sum', () => {
  // ZZZZ appears in both lists (missing a live price affects both the
  // value and the today segment) -- it must count once, not twice.
  assertEquals(heroUnpricedCaption(['ZZZZ'], ['ZZZZ']), '1 holding counted at cost (no live price yet)');
  assertEquals(heroUnpricedCaption(['ZZZZ'], ['AAAA']), '2 holdings counted at cost (no live price yet)');
});

Deno.test('heroUnpricedCaption: case-insensitive de-duplication', () => {
  assertEquals(heroUnpricedCaption(['zzzz'], ['ZZZZ']), '1 holding counted at cost (no live price yet)');
});

Deno.test('sideUnpricedCaption: null when that side has nothing unpriced', () => {
  assertEquals(sideUnpricedCaption('You', []), null);
});

Deno.test('sideUnpricedCaption: prefixes the formatted note with the side\'s name', () => {
  assertEquals(sideUnpricedCaption('You', ['ZZZZ']), 'You: 1 holding counted at cost (no live price yet)');
  assertEquals(sideUnpricedCaption('Gianluigi B.', ['ZZZZ', 'AAAA']), 'Gianluigi B.: 2 holdings counted at cost (no live price yet)');
});

Deno.test('sideUnpricedCaption: de-duplicates case-insensitively, same as the hero caption', () => {
  assertEquals(sideUnpricedCaption('You', ['zzzz', 'ZZZZ']), 'You: 1 holding counted at cost (no live price yet)');
});
