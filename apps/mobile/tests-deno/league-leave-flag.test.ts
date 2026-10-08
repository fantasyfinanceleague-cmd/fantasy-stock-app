/**
 * The "Leave league" row is hidden unless the flag is exactly "1" (3c). It ships
 * off, behind the flag, until the leave flow exists. Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { leaveLeagueEnabled } from '../lib/game/leaveLeague.ts';

Deno.test('the leave row is off when the flag is unset', () => {
  assertEquals(leaveLeagueEnabled(undefined), false);
});

Deno.test('only the exact value "1" turns it on', () => {
  assertEquals(leaveLeagueEnabled('1'), true);
  assertEquals(leaveLeagueEnabled('true'), false);
  assertEquals(leaveLeagueEnabled('0'), false);
  assertEquals(leaveLeagueEnabled(''), false);
});
