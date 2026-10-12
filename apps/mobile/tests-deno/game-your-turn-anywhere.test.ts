/**
 * Your turn, anywhere in the open app (Giorgio 2026-10-11): the buzz + chime fire
 * wherever the player is when their turn starts, once per turn, shared between the
 * foreground push and the draft room. Rules in lib/game/yourTurnPush.ts; the
 * source guards pin that both paths go through the ONE alert (lib/game/yourTurnAlert.ts).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { claimYourTurn, foregroundPushPlan, yourTurnKey, yourTurnPushKey } from '../lib/game/yourTurnPush.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const LEAGUE = '6f1c2b3a-0000-4000-8000-00000000abcd';
const turnPush = (over: Record<string, unknown> = {}) => ({ type: 'draft_turn', screen: 'draft', league_id: LEAGUE, pick_number: 7, ...over });

Deno.test('the key: one league, one pick (ids compared case-insensitively)', () => {
  assertEquals(yourTurnKey(LEAGUE, 7), `${LEAGUE}:7`);
  assertEquals(yourTurnKey(LEAGUE.toUpperCase(), 7), yourTurnKey(LEAGUE, 7));
  assert(yourTurnKey(LEAGUE, 7) !== yourTurnKey(LEAGUE, 8));
  assert(yourTurnKey(LEAGUE, 7) !== yourTurnKey('other-league', 7));
});

Deno.test('which pushes qualify: draft_turn naming its league and pick, nothing else', () => {
  assertEquals(yourTurnPushKey(turnPush()), yourTurnKey(LEAGUE, 7));
  // The room and the push name the same turn the same way.
  assertEquals(yourTurnPushKey(turnPush({ league_id: LEAGUE.toUpperCase() })), yourTurnKey(LEAGUE, 7));
  for (const type of ['draft_order_set', 'draft_stall', 'draft_outage', 'matchup_result', undefined]) {
    assertEquals(yourTurnPushKey(turnPush({ type })), null, String(type));
  }
  // A push from a server before league_id + pick_number: keeps the old behaviour (no app alert).
  assertEquals(yourTurnPushKey({ type: 'draft_turn', screen: 'draft' }), null);
  assertEquals(yourTurnPushKey(turnPush({ league_id: '' })), null);
  assertEquals(yourTurnPushKey(turnPush({ league_id: 42 })), null);
  assertEquals(yourTurnPushKey(turnPush({ pick_number: '7' })), null);
  assertEquals(yourTurnPushKey(turnPush({ pick_number: 0 })), null);
  assertEquals(yourTurnPushKey(turnPush({ pick_number: 1.5 })), null);
  assertEquals(yourTurnPushKey(null), null);
  assertEquals(yourTurnPushKey(undefined), null);
  assertEquals(yourTurnPushKey('draft_turn'), null);
});

Deno.test('once per turn: whichever path claims the key first alerts, the other is silent', () => {
  const claimed = new Set<string>();
  // The push arrives first (player on Home), then the room reads the same turn.
  assertEquals(claimYourTurn(claimed, yourTurnPushKey(turnPush())!), true);
  assertEquals(claimYourTurn(claimed, yourTurnKey(LEAGUE, 7)), false);
  // The room first, then the push: the same.
  assertEquals(claimYourTurn(claimed, yourTurnKey(LEAGUE, 9)), true);
  assertEquals(claimYourTurn(claimed, yourTurnPushKey(turnPush({ pick_number: 9 }))!), false);
  // The next turn (snake turnaround included) and another league's turn are new.
  assertEquals(claimYourTurn(claimed, yourTurnKey(LEAGUE, 10)), true);
  assertEquals(claimYourTurn(claimed, yourTurnKey('other-league', 7)), true);
});

Deno.test('foreground: a your-turn push shows its banner with no OS sound and alerts its turn', () => {
  const plan = foregroundPushPlan(turnPush(), false, true);
  assertEquals(plan.alertKey, yourTurnKey(LEAGUE, 7));
  assertEquals(plan.presentation, { shouldShowAlert: true, shouldShowBanner: true, shouldPlaySound: false, shouldShowList: true, shouldSetBadge: true });
  // The room on screen (quiet): no banner either, and the alert is still offered (the claim decides).
  const quiet = foregroundPushPlan(turnPush(), true, true);
  assertEquals(quiet.alertKey, yourTurnKey(LEAGUE, 7));
  assertEquals(quiet.presentation.shouldShowBanner, false);
  assertEquals(quiet.presentation.shouldPlaySound, false);
});

Deno.test('foreground: every other notification keeps its sound, and alerts nothing', () => {
  for (const data of [{ type: 'draft_order_set', screen: 'draft' }, { type: 'matchup_result', screen: 'matchup' }, { type: 'draft_turn', screen: 'draft' }, {}]) {
    const plan = foregroundPushPlan(data, false, true);
    assertEquals(plan.alertKey, null, JSON.stringify(data));
    assertEquals(plan.presentation.shouldPlaySound, true, JSON.stringify(data));
    assertEquals(plan.presentation.shouldShowBanner, true);
  }
});

Deno.test('not active (e.g. Notification Center down): no app alert, the OS sound as before', () => {
  const plan = foregroundPushPlan(turnPush(), false, false);
  assertEquals(plan.alertKey, null);
  assertEquals(plan.presentation.shouldPlaySound, true);
});

// --- Wiring (source guards) ---

const notifications = SOURCES['lib/notifications.ts'];
const room = SOURCES['components/game/DraftRoom.tsx'];
const alert = SOURCES['lib/game/yourTurnAlert.ts'];

Deno.test('wiring: the foreground handler plans each push and fires the shared alert', () => {
  const handler = notifications.slice(notifications.indexOf('Notifications.setNotificationHandler({'), notifications.indexOf('\n});', notifications.indexOf('Notifications.setNotificationHandler({')));
  assert(handler.includes("const plan = foregroundPushPlan(notification.request.content.data, foregroundQuiet(), AppState.currentState === 'active');"));
  assert(handler.includes('if (plan.alertKey) alertYourTurn(plan.alertKey);'));
  assert(handler.includes('return plan.presentation;'));
  assert(notifications.includes("import { alertYourTurn } from './game/yourTurnAlert';"));
  // The handler makes no haptic or sound of its own.
  assert(!notifications.includes('Haptics'));
  assert(!notifications.includes('expo-audio'));
});

Deno.test('wiring: the draft room alerts through the same shared alert, keyed by league + pick', () => {
  assert(room.includes("import { alertYourTurn } from '@/lib/game/yourTurnAlert';"));
  assert(room.includes('alertYourTurn(yourTurnKey(leagueId, myTurnPick));'));
  // No second, independent turn haptic or chime: the room's ONE Warning haptic is the 10-s buzz.
  assertEquals((room.match(/Haptics\.notificationAsync\(/g) ?? []).length, 1);
  const lastTen = room.slice(room.indexOf('const lastTenBuzzed'), room.indexOf('}, [myTurnPick, shownClock.secondsLeft, appActive]);'));
  assert(lastTen.includes('Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)'));
  assert(!room.includes('expo-audio'));
  assert(!room.includes('useTurnChime'));
});

Deno.test('wiring: the one alert claims before it buzzes and chimes, from ONE app-wide set', () => {
  const fn = alert.slice(alert.indexOf('export function alertYourTurn'));
  assert(fn.indexOf('if (!claimYourTurn(claimed, key)) return false;') < fn.indexOf('Haptics.notificationAsync'));
  assert(fn.indexOf('if (!claimYourTurn(claimed, key)) return false;') < fn.indexOf('playChime();'));
  assertEquals((alert.match(/new Set<string>\(\)/g) ?? []).length, 1);
  assert(alert.includes('\nconst claimed = new Set<string>();')); // module level, not per call or per screen
  // The only sources that play the your-turn chime: this file.
  const chimers = Object.entries(SOURCES).filter(([, src]) => src.includes('your-turn.wav')).map(([p]) => p);
  assertEquals(chimers, ['lib/game/yourTurnAlert.ts']);
});
