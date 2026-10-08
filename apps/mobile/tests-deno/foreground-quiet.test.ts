/**
 * Foreground quiet (3c-2, UX rule 11): no foreground banner while YOUR pick
 * clock runs (the draft room shows it); a hook point for 3e's trade review.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { foregroundPresentation, foregroundQuiet, ownPickClockRunning, setForegroundQuiet } from '../lib/foregroundQuiet.ts';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('quiet hides the banner and its sound; the list and the badge stay', () => {
  assertEquals(foregroundPresentation(true), { shouldShowAlert: false, shouldShowBanner: false, shouldPlaySound: false, shouldShowList: true, shouldSetBadge: true });
  assertEquals(foregroundPresentation(false), { shouldShowAlert: true, shouldShowBanner: true, shouldPlaySound: true, shouldShowList: true, shouldSetBadge: true });
});

Deno.test('reasons stack: quiet while ANY is on; off when all are off', () => {
  assertEquals(foregroundQuiet(), false);
  setForegroundQuiet('own_pick_clock', true);
  assertEquals(foregroundQuiet(), true);
  setForegroundQuiet('trade_review', true);
  setForegroundQuiet('own_pick_clock', false);
  assertEquals(foregroundQuiet(), true); // the trade review still holds it
  setForegroundQuiet('trade_review', false);
  assertEquals(foregroundQuiet(), false);
  setForegroundQuiet('own_pick_clock', false); // off twice is harmless
  assertEquals(foregroundQuiet(), false);
});

Deno.test('your pick clock: only on your turn, only while it runs', () => {
  assertEquals(ownPickClockRunning(true, 'on_clock'), true);
  assertEquals(ownPickClockRunning(true, 'last10'), true);
  assertEquals(ownPickClockRunning(true, 'auto_picking'), false);
  assertEquals(ownPickClockRunning(true, 'idle'), false);
  assertEquals(ownPickClockRunning(false, 'on_clock'), false);
});

Deno.test('wiring: the handler asks foregroundPresentation; the room sets and clears its reason (source guards)', () => {
  assertEquals(SOURCES['lib/notifications.ts'].includes('handleNotification: async () => foregroundPresentation(foregroundQuiet()),'), true);
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assertEquals(room.includes("setForegroundQuiet('own_pick_clock', quiet);"), true);
  assertEquals(room.includes("return () => setForegroundQuiet('own_pick_clock', false);"), true);
});
