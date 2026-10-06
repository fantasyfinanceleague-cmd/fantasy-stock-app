/**
 * Draft room rules (3c): the pick-log line for each pick_source (the Auto badge
 * for auto_%), and the clock state (on the clock, the last 10 seconds, auto-
 * picking past the deadline until the row arrives). Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { pickLogLine, isAutoPick, clockState } from '../lib/game/draftRoom.ts';

Deno.test('the pick log says where each pick came from, in the board\'s words', () => {
  assertEquals(pickLogLine('auto_queue'), 'Auto-picked · from their queue');
  assertEquals(pickLogLine('auto_best'), 'Auto-picked · best available');
  assertEquals(pickLogLine('manual'), 'Picked');
  assertEquals(pickLogLine('bot'), 'Picked');
});

Deno.test('a skip is shown as a skip, never as a pick', () => {
  assertEquals(pickLogLine('auto_skip'), 'Skipped');
  assertEquals(pickLogLine('skip'), 'Skipped');
});

Deno.test('the Auto badge marks every auto pick and nothing else', () => {
  assertEquals(isAutoPick('auto_queue'), true);
  assertEquals(isAutoPick('auto_best'), true);
  assertEquals(isAutoPick('auto_skip'), true);
  assertEquals(isAutoPick('manual'), false);
  assertEquals(isAutoPick('bot'), false);
});

Deno.test('the clock: on the clock with time left, the last 10 seconds, and auto-picking past the deadline', () => {
  const deadline = '2026-10-05T19:00:30.000Z';
  assertEquals(clockState({ running: true, deadlineAt: deadline, serverNow: '2026-10-05T19:00:00.000Z' }).kind, 'on_clock');
  assertEquals(clockState({ running: true, deadlineAt: deadline, serverNow: '2026-10-05T19:00:25.000Z' }).kind, 'last10');
  assertEquals(clockState({ running: true, deadlineAt: deadline, serverNow: '2026-10-05T19:00:31.000Z' }).kind, 'auto_picking');
});

Deno.test('a stopped clock or a missing deadline is idle, never a guessed countdown', () => {
  assertEquals(clockState({ running: false, deadlineAt: null, serverNow: '2026-10-05T19:00:00.000Z' }).kind, 'idle');
  assertEquals(clockState({ running: true, deadlineAt: null, serverNow: '2026-10-05T19:00:00.000Z' }).kind, 'idle');
});

Deno.test('the seconds left come from the server clock, so the device clock cannot skew them', () => {
  const s = clockState({ running: true, deadlineAt: '2026-10-05T19:00:30.000Z', serverNow: '2026-10-05T19:00:20.000Z' });
  assertEquals(s.secondsLeft, 10);
});
