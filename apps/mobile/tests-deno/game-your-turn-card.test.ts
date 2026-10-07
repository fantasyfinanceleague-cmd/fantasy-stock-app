/**
 * The draft room's your-turn card (3c-2; the Design Lead's spec, board #your-turn
 * ac74345). The rules live in lib/game/yourTurn (game-your-turn.test.ts); these
 * source guards pin how DraftRoom wires them.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

const room = SOURCES['components/game/DraftRoom.tsx'];

Deno.test('the signal keys on the server reading, your turn only, once the room is read', () => {
  assert(room.includes("const myTurnPick = room.status === 'ready' && !draftDone && isMyTurn && (room.clock.kind === 'on_clock' || room.clock.kind === 'last10') ? onClockPick : null;"));
  assert(room.includes('const next = nextTurnSignal(turnSignal.current, { myTurnPick, appActive });'));
  // The loading reading never initializes the state (or a loaded room already on your turn would fire).
  assert(room.includes("if (room.status !== 'ready') return;"));
  assert(room.includes("AppState.addEventListener('change', (next) => setAppActive(next === 'active'))"));
});

Deno.test('the haptic is a Warning, with the signal; the flash only on screen and never with Reduce Motion', () => {
  assert(room.includes('Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});'));
  assert(room.includes('const steps = roomOnScreen ? flashSteps(reduced) : [];'));
  assert(room.includes('const { reduced } = useMotion();'));
  assert(room.includes('flash.value = withSequence(first, ...rest);'));
});

Deno.test('the flash is a layer under the text that never takes a touch', () => {
  const flash = room.match(/<Animated\.View testID="your-turn-flash"[^>]*>/)?.[0] ?? '';
  assert(flash.includes('pointerEvents="none"'), flash);
  assert(flash.includes('StyleSheet.absoluteFill'));
  assert(flash.includes('backgroundColor: colors.live'));
  // It sits before the clock row, so the text renders on top of it.
  assert(room.indexOf('testID="your-turn-flash"') < room.indexOf('<View style={styles.clockRow}>'));
});

Deno.test('rest: warn-tint over the surface, a 2 pt live border, the 44 pt clock, the 30 pt title in liveText', () => {
  assert(room.includes('testID="your-turn-tint" pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.warnTint }]}'));
  assert(room.includes("onTheClock ? [styles.yourTurnCard, { borderColor: colors.live }] : null"));
  assert(room.includes('yourTurnCard: { borderWidth: 2 },'));
  assert(room.includes('yourTurnClock: { fontSize: 44, lineHeight: 42 },'));
  assert(room.includes('yourTurnTitle: { fontSize: 30, lineHeight: 34 },'));
  assert(room.includes('variant="display" style={styles.yourTurnTitle} color={flashLit ? colors.onLive : colors.liveText}'));
});

Deno.test('the text is navy (on-live) only while the gold is up', () => {
  assert(room.includes('flashTextSchedule(steps).map((t) => setTimeout(() => setFlashLit(t.onLive), t.atMs))'));
  assert(room.includes('setTimeout(() => setFlashLit(false), flashDurationMs(steps))'));
  assertEquals((room.match(/colors\.onLive/g) ?? []).length, 2); // the clock and the title, both behind flashLit
});

Deno.test('the last 10 s: one more Warning haptic, keyed on the ticking clock, no sound or flash', () => {
  const at = room.indexOf('const lastTenBuzzed');
  const block = room.slice(at, room.indexOf('}, [myTurnPick, shownClock.secondsLeft, appActive]);', at));
  assert(block.includes('nextLastTenBuzz(lastTenBuzzed.current, { myTurnPick, secondsLeft: shownClock.secondsLeft, appActive })'));
  assert(block.includes('Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)'));
  assert(!block.includes('flash'));
});
