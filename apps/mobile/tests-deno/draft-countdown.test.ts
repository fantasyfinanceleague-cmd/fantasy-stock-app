/**
 * Tests for lib/home/draftCountdown.ts (Design Lead ruling, 2026-09-30,
 * B4): the pre-draft card's date/countdown/order-set-time labels, all
 * ET-aware and derived from real timestamps, never hardcoded.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { draftDateTimeLabel, orderSetLine, countdownLabel } from '../lib/home/draftCountdown.ts';

Deno.test('draftDateTimeLabel: "Sat, Oct 3 · 7:00 PM ET" from a real ISO timestamp', () => {
  // 2026-10-03T23:00:00.000Z = 7:00 PM EDT (UTC-4).
  assertEquals(draftDateTimeLabel('2026-10-03T23:00:00.000Z'), 'Sat, Oct 3 · 7:00 PM ET');
});

Deno.test('draftDateTimeLabel: null/invalid input returns null, never "Invalid Date"', () => {
  assertEquals(draftDateTimeLabel(null), null);
  assertEquals(draftDateTimeLabel('not-a-date'), null);
});

Deno.test('orderSetLine: "Draft order set Sat 6:00 PM ET, an hour before the draft"', () => {
  // 2026-10-03T22:00:00.000Z = 6:00 PM EDT, exactly 1h before the 7:00 PM draft above.
  assertEquals(orderSetLine('2026-10-03T22:00:00.000Z'), 'Draft order set Sat 6:00 PM ET, an hour before the draft');
});

Deno.test('orderSetLine: null (order-set time unknown) returns null', () => {
  assertEquals(orderSetLine(null), null);
  assertEquals(orderSetLine('garbage'), null);
});

Deno.test('countdownLabel: days, hours and minutes all present -> "3d 04h 12m"', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');
  const target = new Date(now.getTime() + (3 * 24 * 60 + 4 * 60 + 12) * 60000).toISOString();
  assertEquals(countdownLabel(now, target), '3d 04h 12m');
});

Deno.test('countdownLabel: under a day drops the day segment -> "4h 12m"', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');
  const target = new Date(now.getTime() + (4 * 60 + 12) * 60000).toISOString();
  assertEquals(countdownLabel(now, target), '4h 12m');
});

Deno.test('countdownLabel: under an hour drops both larger segments -> "12m"', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');
  const target = new Date(now.getTime() + 12 * 60000).toISOString();
  assertEquals(countdownLabel(now, target), '12m');
});

Deno.test('countdownLabel: rounds DOWN to the whole minute, never shows seconds', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');
  const target = new Date(now.getTime() + 90 * 1000).toISOString(); // 1m30s away
  assertEquals(countdownLabel(now, target), '1m');
});

Deno.test('countdownLabel: a past or missing target returns null, never negative', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');
  assertEquals(countdownLabel(now, new Date(now.getTime() - 1000).toISOString()), null);
  assertEquals(countdownLabel(now, null), null);
});
