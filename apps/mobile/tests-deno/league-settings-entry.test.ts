/**
 * The pre-draft League tab's "League settings" row (3c-2): commissioner only.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { showsLeagueSettingsRow } from '../lib/game/leagueSettingsEntry.ts';

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
