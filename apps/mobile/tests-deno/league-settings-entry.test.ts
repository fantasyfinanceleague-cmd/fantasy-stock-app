/**
 * The pre-draft League tab's "League settings" row (3c-2): commissioner only.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { SETTINGS_LOCKED, showsLeagueSettingsRow } from '../lib/game/leagueSettingsEntry.ts';

Deno.test('the commissioner sees the row', () => {
  assertEquals(showsLeagueSettingsRow('u1', 'u1'), true);
});

Deno.test('another member does not', () => {
  assertEquals(showsLeagueSettingsRow('u1', 'u2'), false);
});

Deno.test('a missing id never matches, even two missing ones', () => {
  assertEquals(showsLeagueSettingsRow(undefined, undefined), false);
  assertEquals(showsLeagueSettingsRow(null, 'u1'), false);
  assertEquals(showsLeagueSettingsRow('u1', ''), false);
});

Deno.test('with the leave flow on (item 13), every signed-in member sees it: Leave league lives in League settings', () => {
  assertEquals(showsLeagueSettingsRow('u1', 'u2', true), true);
  assertEquals(showsLeagueSettingsRow('u1', 'u1', true), true);
  assertEquals(showsLeagueSettingsRow(null, 'u2', true), true);
  assertEquals(showsLeagueSettingsRow('u1', '', true), false); // never signed out
  assertEquals(showsLeagueSettingsRow('u1', 'u2', false), false); // flag off: as before
});

Deno.test('the lock note: one sentence for both locked states, not the Leave row line', () => {
  assertEquals(SETTINGS_LOCKED, 'Settings are locked once the draft starts.');
  // Settings lock at the draft start; teams lock in an hour earlier (the Leave row's line).
  assertEquals(SETTINGS_LOCKED.includes('locked in'), false);
  assertEquals(SETTINGS_LOCKED.includes('an hour before'), false);
});
