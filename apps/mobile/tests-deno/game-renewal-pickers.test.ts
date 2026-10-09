/**
 * The R8 pickers (3c): the pick clock's options (30–90 s, the server's own steps),
 * the draft order (random or manual), and a draft date that must be in the future.
 * Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { PICK_CLOCK_OPTIONS, DRAFT_ORDER_OPTIONS, isFutureDraftDate } from '../lib/game/renewalPickers.ts';

Deno.test('the pick clock offers 30, 45, 60, 75 and 90 seconds (the server\'s own range and step)', () => {
  assertEquals(PICK_CLOCK_OPTIONS, [30, 45, 60, 75, 90]);
});

Deno.test('the draft order is Random or Manual (the board\'s two choices)', () => {
  assertEquals(DRAFT_ORDER_OPTIONS.map((o) => o.value), ['random', 'manual']);
  assertEquals(DRAFT_ORDER_OPTIONS.map((o) => o.label), ['Random', 'Manual']);
});

Deno.test('a draft date must be in the future, and a missing or bad one is not', () => {
  const now = new Date('2026-01-10T12:00:00Z');
  assertEquals(isFutureDraftDate('2026-01-23T00:00:00Z', now), true);
  assertEquals(isFutureDraftDate('2026-01-09T00:00:00Z', now), false);
  assertEquals(isFutureDraftDate('not-a-date', now), false);
  assertEquals(isFutureDraftDate(null, now), false);
});

import { seasonWeeksFloor, stepSeasonWeeks } from '../lib/game/renewalPickers.ts';

Deno.test('the season\'s weeks match create-league: at least one round robin (managers − 1), no fixed ceiling', () => {
  assertEquals(seasonWeeksFloor(6), 5);
  assertEquals(stepSeasonWeeks(14, 1, 6), 15);
  assertEquals(stepSeasonWeeks(5, -1, 6), 5); // cannot go below the round robin
  assertEquals(stepSeasonWeeks(14, -1, 6), 13);
});
