/**
 * Push taps (3c-2): the draft pushes open the League tab (lobby or room by
 * phase), never the legacy (tabs)/draft route, which is kept only for the
 * finalize heal. The other screens route as before.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { notificationRoute } from '../lib/shell/notificationRoute.ts';

Deno.test("screen 'draft' (draft_turn, draft_order_set) opens the League tab", () => {
  assertEquals(notificationRoute({ screen: 'draft' }), '/(tabs)/league');
});

Deno.test('nothing routes a push to the legacy draft route', () => {
  for (const screen of ['draft', 'matchup', 'league', 'leaderboard', 'other', undefined]) {
    assertEquals(notificationRoute({ screen }) === ('/(tabs)/draft' as unknown), false, String(screen));
  }
});

Deno.test('the other screens route as before', () => {
  assertEquals(notificationRoute({ screen: 'matchup' }), '/(tabs)/matchup');
  assertEquals(notificationRoute({ screen: 'league' }), '/(tabs)/league');
  assertEquals(notificationRoute({ screen: 'leaderboard' }), '/(tabs)/league');
});

Deno.test('an unknown or missing screen opens nothing', () => {
  assertEquals(notificationRoute({ screen: 'portfolio' }), null);
  assertEquals(notificationRoute({}), null);
  assertEquals(notificationRoute(null), null);
  assertEquals(notificationRoute(undefined), null);
});
