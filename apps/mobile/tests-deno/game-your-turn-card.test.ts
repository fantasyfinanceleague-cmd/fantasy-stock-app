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
  assert(room.includes('variant="display" style={styles.yourTurnTitle} color={titleRest} animatedStyle={titleInk}'));
  assert(room.includes('const titleRest = colors.liveText;'));
});

Deno.test('the text is navy (on-live) only while the gold is up, on the UI thread, in the fill\'s own frames', () => {
  assert(room.includes('const ink = useSharedValue(0);'));
  assert(room.includes('const atStart = flashTextAtStepStart(steps);'));
  // Navy as each rise starts (the previous step's end); back to rest at the last step's end regardless.
  assert(room.includes("const riseNext = i + 1 < steps.length && atStart[i + 1] === true;"));
  assert(room.includes('if (riseNext) ink.value = 1;'));
  assert(room.includes('if (last) ink.value = 0;'));
  // B-2: back to rest as each settle crosses the midpoint, from the fill itself.
  assert(room.includes('if (settleCrossedMidpoint(prev, level)) ink.value = 0;'));
  assert(room.includes('() => flash.value,'));
  // No JS round trip (a React state switch landed ~3 frames late in the B-2 capture), no timers.
  assert(!room.includes('runOnJS'));
  assert(!room.includes('setFlashLit'));
  assert(!/setTimeout\(\(\) => set/.test(room));
});

Deno.test('every line on the card takes the ink: the clock, the title, the round line, the captions', () => {
  for (const name of ['clockInk', 'titleInk', 'bodyInk', 'captionInk']) {
    assert(room.includes(`const ${name} = useAnimatedStyle(() => ({ color: ink.value === 1 ? onLive : `), name);
  }
  assert(room.includes('const onLive = colors.onLive;'));
  assertEquals((room.match(/colors\.onLive/g) ?? []).length, 1); // only through `ink`
  assert(room.includes('animatedStyle={onTheClock ? clockInk : undefined}'));
  assert(room.includes('animatedStyle={titleInk}'));
  assert(room.includes('animatedStyle={onTheClock ? bodyInk : undefined}'));
  assertEquals((room.match(/animatedStyle=\{onTheClock \? captionInk : undefined\}/g) ?? []).length, 2); // "N-second picks", waiting for prices
});

Deno.test('the sp Text takes a UI-thread style as an opt-in (Animated.Text only when given one)', () => {
  const text = SOURCES['components/sp/Text.tsx'];
  assert(text.includes('animatedStyle?: AnimatedStyle<TextStyle>;'));
  assert(text.includes('if (animatedStyle) {'));
  assert(text.includes('style={[baseStyle, animatedStyle]}'));
  assert(text.includes('style={baseStyle}'));
});

Deno.test('the last 10 s: one more Warning haptic, keyed on the ticking clock, no sound or flash', () => {
  const at = room.indexOf('const lastTenBuzzed');
  const block = room.slice(at, room.indexOf('}, [myTurnPick, shownClock.secondsLeft, appActive]);', at));
  assert(block.includes('nextLastTenBuzz(lastTenBuzzed.current, { myTurnPick, secondsLeft: shownClock.secondsLeft, appActive })'));
  assert(block.includes('Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)'));
  assert(!block.includes('flash'));
});

Deno.test('the chime plays with the signal (and the haptic), our own file, in the spec\'s audio mode', () => {
  const chime = SOURCES['lib/game/useTurnChime.ts'];
  assert(chime.includes("require('../../assets/sounds/your-turn.wav')"));
  assert(chime.includes('setAudioModeAsync(CHIME_AUDIO_MODE)'));
  assert(chime.includes('player.seekTo(0)')); // a finished player stays at its end
  assert(!/https?:\/\//.test(chime)); // never a downloaded sound
  assert(room.includes('const playChime = useTurnChime();'));
  const fire = room.slice(room.indexOf('if (!next.fire) return;'), room.indexOf('const steps = roomOnScreen'));
  assert(fire.includes('Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)'));
  assert(fire.includes('playChime();'));
  // Not in the last-10 block: the 10 s mark is haptic only.
  const lastTen = room.slice(room.indexOf('const lastTenBuzzed'), room.indexOf('}, [myTurnPick, shownClock.secondsLeft, appActive]);'));
  assert(!lastTen.includes('playChime'));
});

Deno.test('the chime logs its evidence in dev only (a simulator recording has no audio)', () => {
  const chime = SOURCES['lib/game/useTurnChime.ts'];
  assert(chime.includes("if (__DEV__) setTimeout(() => console.info(`[your-turn] chime ${player.playing ? 'playing' : 'NOT playing'}"));
});

Deno.test('B-4: no clock (auto-picking, idle) draws no clock row, never an empty gap', () => {
  assert(room.includes('const clockLabel = pickClockLabel(shownClock);'));
  assert(room.includes('{clockLabel ? (\n          <View style={styles.clockRow}>'));
  assertEquals((room.match(/pickClockLabel\(/g) ?? []).length, 1); // the row and its text share one label
});
