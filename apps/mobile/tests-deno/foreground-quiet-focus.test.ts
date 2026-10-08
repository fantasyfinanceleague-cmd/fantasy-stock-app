/**
 * The your-turn spec's consequence for U-14 (3c-2): the own-pick-clock banner
 * suppression holds only while the draft room is ON SCREEN. A player elsewhere in
 * the app when the turn starts still gets the push banner.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { ownPickClockQuiet } from '../lib/foregroundQuiet.ts';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('banners are quiet only while the room is on screen and your clock runs (U-14 consequence)', () => {
  assertEquals(ownPickClockQuiet(true, 'on_clock', true), true);
  assertEquals(ownPickClockQuiet(true, 'last10', true), true);
  assertEquals(ownPickClockQuiet(true, 'on_clock', false), false); // elsewhere in the app: the banner shows
  assertEquals(ownPickClockQuiet(false, 'on_clock', true), false);
  assertEquals(ownPickClockQuiet(true, 'auto_picking', true), false);
});

Deno.test('the room keys the quiet on its own focus, not on being mounted (tabs stay mounted; source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assertEquals(room.includes('const roomOnScreen = useIsFocused();'), true);
  assertEquals(room.includes('const quiet = ownPickClockQuiet(isMyTurn, room.clock.kind, roomOnScreen);'), true);
});
