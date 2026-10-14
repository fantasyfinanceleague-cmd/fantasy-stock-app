/**
 * lib/money/preDraftPortfolio.ts — Portfolio before the draft is done (W4 DL gate: "a dead end"):
 * the app's line plus Home's own hook, no new copy.
 */
import { assertEquals } from 'jsr:@std/assert';
import { preDraftPortfolio } from '../lib/money/preDraftPortfolio.ts';

Deno.test('during the draft: the line and "Go to the draft room"', () => {
  assertEquals(preDraftPortfolio('in_progress', '2026-10-03T23:00:00Z'), {
    line: 'Trading opens after the draft.',
    hook: { kind: 'room', label: 'Go to the draft room' },
  });
});

Deno.test('before it starts: the line and Home\'s draft date/time line', () => {
  assertEquals(preDraftPortfolio('not_started', '2026-10-03T23:00:00Z'), {
    line: 'Trading opens after the draft.',
    hook: { kind: 'date', label: 'Sat, Oct 3 · 7:00 PM ET' },
  });
});

Deno.test('no time set yet: the line alone; a completed draft: nothing (the team shows)', () => {
  assertEquals(preDraftPortfolio('not_started', null), { line: 'Trading opens after the draft.', hook: null });
  assertEquals(preDraftPortfolio('completed', '2026-10-03T23:00:00Z'), null);
});
