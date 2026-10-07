/**
 * Foreground quiet (3c-2, UX rule 11): no foreground banner while YOUR pick
 * clock runs (the draft room shows it); a hook point for 3e's trade review.
 * Lifted to main ahead of the League-setup branch (which keeps its own
 * foreground-quiet*.test.ts over its draft room) so 3e can wire trade_review.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { foregroundPresentation, foregroundQuiet, ownPickClockRunning, setForegroundQuiet } from '../lib/foregroundQuiet.ts';
import notificationsSrc from '../lib/notifications.ts' with { type: 'text' };

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

Deno.test('wiring: the foreground handler asks foregroundPresentation (source guard, main copy)', () => {
  assertEquals(notificationsSrc.includes('handleNotification: async () => foregroundPresentation(foregroundQuiet()),'), true);
});
