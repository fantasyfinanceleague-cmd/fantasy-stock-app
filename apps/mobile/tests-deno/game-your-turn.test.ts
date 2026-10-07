/**
 * Your turn, unmissable (3c-2; Design Lead spec, board #your-turn ac74345, audit
 * afb9336): the once-per-turn signal, the flash timeline, and the last-10-s haptic. Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  FLASH_STEPS, TURN_SIGNAL_START, flashCount, flashDurationMs, flashSteps, flashTextSchedule, nextLastTenBuzz, nextTurnSignal,
  type TurnObservation, type TurnSignalState,
} from '../lib/game/yourTurn.ts';

function run(observations: TurnObservation[]): boolean[] {
  let state: TurnSignalState = TURN_SIGNAL_START;
  return observations.map((o) => {
    const r = nextTurnSignal(state, o);
    state = r.state;
    return r.fire;
  });
}
const on = (myTurnPick: number | null, appActive = true): TurnObservation => ({ myTurnPick, appActive });

Deno.test('fires the moment the turn becomes yours, once', () => {
  assertEquals(run([on(null), on(11), on(11), on(11)]), [false, true, false, false]);
});

Deno.test('a re-opened or refreshed room already on your turn doesn\'t replay it', () => {
  assertEquals(run([on(11), on(11)]), [false, false]); // the first reading only records
});

Deno.test('every new turn of yours fires once, including the snake\'s back-to-back picks', () => {
  assertEquals(run([on(null), on(11), on(null), on(14), on(null)]), [false, true, false, true, false]);
  assertEquals(run([on(null), on(6), on(7)]), [false, true, true]); // last of round 1, first of round 2
});

Deno.test('a turn that starts while the app is in the background is consumed silently, not replayed later', () => {
  assertEquals(run([on(null), on(11, false), on(11, true)]), [false, false, false]);
});

Deno.test('the flash: two pulses, ≈0.95 s, on 90 / hold 220 / settle 160 twice', () => {
  assertEquals(FLASH_STEPS.map((s) => s.ms), [90, 220, 160, 90, 220, 160]);
  assertEquals(flashDurationMs(FLASH_STEPS), 940);
  assertEquals(flashCount(FLASH_STEPS), 2);
  // Under WCAG 2.3.1: fewer than three flashes in any one second.
  assertEquals(flashCount(FLASH_STEPS) < 3 && flashDurationMs(FLASH_STEPS) <= 1000, true);
  assertEquals(FLASH_STEPS[FLASH_STEPS.length - 1].to, 0); // ends at rest: one-shot, never a loop
});

Deno.test('Reduce Motion: no flash at all (straight to the rest state)', () => {
  assertEquals(flashSteps(true), []);
  assertEquals(flashSteps(false), FLASH_STEPS);
});

Deno.test('the last-10-s haptic: once per turn, inside 1..10 s, only while it\'s your turn and the app is in front', () => {
  const at = (secondsLeft: number | null, myTurnPick: number | null = 11, appActive = true) => ({ myTurnPick, secondsLeft, appActive });
  let buzzed: number | null = null;
  const seq = [at(30), at(11), at(10), at(9), at(3)].map((o) => {
    const r = nextLastTenBuzz(buzzed, o);
    buzzed = r.buzzedPick;
    return r.buzz;
  });
  assertEquals(seq, [false, false, true, false, false]);
  assertEquals(nextLastTenBuzz(11, at(5, 14)).buzz, true); // the next turn of yours buzzes again
  assertEquals(nextLastTenBuzz(null, at(5, null)).buzz, false); // not your turn
  assertEquals(nextLastTenBuzz(null, at(0)).buzz, false); // time's up: the auto-pick runs
  assertEquals(nextLastTenBuzz(null, at(null)).buzz, false); // no clock
  assertEquals(nextLastTenBuzz(null, at(5, 11, false)), { buzzedPick: 11, buzz: false }); // in the background: consumed
});

Deno.test('the flash text: navy from each rise until its settle, never on the rest card; nothing with Reduce Motion', () => {
  assertEquals(flashTextSchedule(FLASH_STEPS), [
    { atMs: 0, onLive: true },
    { atMs: 310, onLive: false },
    { atMs: 470, onLive: true },
    { atMs: 780, onLive: false },
  ]);
  const last = flashTextSchedule(FLASH_STEPS).at(-1);
  assertEquals(last?.onLive, false);
  assertEquals(flashTextSchedule(flashSteps(true)), []);
});
