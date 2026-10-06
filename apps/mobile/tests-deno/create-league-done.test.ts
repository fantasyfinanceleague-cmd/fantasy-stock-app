/**
 * The Create league done screen and its two remaining Alerts (3c-2; Design
 * Lead rulings, verbatim).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  CREATED_LINE,
  CREATED_NO_DATE,
  CREATE_FAILED,
  GO_TO_LEAGUE,
  SLOTS_NOT_SAVED,
  createdTitle,
  createdWithoutDate,
  inviteShareMessage,
} from '../lib/game/createLeagueDone.ts';

Deno.test('the done screen: "{Name} is ready" and its line', () => {
  assertEquals(createdTitle('Office League'), 'Office League is ready');
  assertEquals(createdTitle('  Office League  '), 'Office League is ready');
  assertEquals(CREATED_LINE, 'Share the invite code to bring your league in.');
  assertEquals(GO_TO_LEAGUE, 'Go to the league');
});

Deno.test('no draft date: TBD, or a date never picked', () => {
  assertEquals(createdWithoutDate(true, null), true);
  assertEquals(createdWithoutDate(false, null), true);
  assertEquals(createdWithoutDate(true, new Date('2026-10-10T23:00:00Z')), true);
  assertEquals(createdWithoutDate(false, new Date('2026-10-10T23:00:00Z')), false);
  assertEquals(CREATED_NO_DATE, 'Set a draft time before the draft can start.');
});

Deno.test('roster slots that did not save', () => {
  assertEquals(SLOTS_NOT_SAVED, {
    title: "Roster slots didn't save",
    message: "Your league was created, but its roster slots didn't save. Add them again in League settings.",
  });
});

Deno.test('a failed create never shows the raw message', () => {
  assertEquals(CREATE_FAILED, { title: "The league wasn't created", message: 'Check your connection, then try again.' });
});

Deno.test('the share text', () => {
  assertEquals(inviteShareMessage('K7Q2XR'), 'Join my league with code K7Q2XR');
});
