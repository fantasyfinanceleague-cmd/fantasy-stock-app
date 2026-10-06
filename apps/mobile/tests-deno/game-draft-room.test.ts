/**
 * Draft room rules (3c): the pick-log line for each pick_source (the Auto badge
 * for auto_%), and the clock state (on the clock, the last 10 seconds, auto-
 * picking past the deadline until the row arrives). Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { pickLogLine, isAutoPick, clockState, pickRowView } from '../lib/game/draftRoom.ts';

Deno.test('the pick log says where each pick came from, in the board\'s words', () => {
  assertEquals(pickLogLine('auto_queue'), 'Auto-picked · from their queue');
  assertEquals(pickLogLine('auto_best'), 'Auto-picked · best available');
  assertEquals(pickLogLine('manual'), 'Picked');
  assertEquals(pickLogLine('bot'), 'Picked');
});

Deno.test('a legacy SKIP row is a plain row: a dash for the symbol, no label, no badge, not counted, never the word Skip', () => {
  const row = pickRowView({ symbol: 'SKIP', source: 'skip' });
  assertEquals(row, { symbolCell: '—', symbolLabel: 'No pick', label: null, auto: false, countsAsPick: false });
  const autoSkip = pickRowView({ symbol: 'SKIP', source: 'auto_skip' });
  assertEquals(autoSkip, { symbolCell: '—', symbolLabel: 'No pick', label: null, auto: false, countsAsPick: false });
  // VoiceOver reads the Design Lead's label, never "dash" or nothing.
  assertEquals(row.symbolLabel, 'No pick');
  const text = JSON.stringify([row, autoSkip]);
  assertEquals(/skip/i.test(text), false);
});

Deno.test('a real pick is shown with its symbol, its line and whether it counts', () => {
  assertEquals(pickRowView({ symbol: 'LLY', source: 'auto_queue' }), { symbolCell: 'LLY', symbolLabel: 'LLY', label: 'Auto-picked · from their queue', auto: true, countsAsPick: true });
});

Deno.test('the Auto badge marks every auto pick and nothing else', () => {
  assertEquals(isAutoPick('auto_queue'), true);
  assertEquals(isAutoPick('auto_best'), true);
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
