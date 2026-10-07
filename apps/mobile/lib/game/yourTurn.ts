/**
 * Your turn, unmissable (3c-2; Giorgio's board review 2026-10-06, the Design
 * Lead's spec: board #your-turn ac74345, audit "Your turn must be unmissable"
 * afb9336). Pure rules, so Deno tests them; the draft room wires them.
 *
 * - The SIGNAL fires once per turn, the moment the server's clock makes it your
 *   turn. The first reading after the room mounts only records where things
 *   stand, so a re-opened or refreshed room that is already on your turn doesn't
 *   replay it. While the app isn't in front the turn is consumed silently (the
 *   push banner covers it).
 * - The FLASH: the clock card fills with live gold, two pulses then rest; one-shot,
 *   never a loop, never blocks input; none with Reduce Motion (straight to rest).
 * - At 10 s left, one more Warning haptic (no sound, no second flash), once per turn.
 */

/** What the room knows right now: your turn's overall pick number, or null when it isn't your turn. */
export interface TurnObservation {
  myTurnPick: number | null;
  appActive: boolean;
}

export interface TurnSignalState {
  /** False until the first reading after mount (that reading never fires). */
  initialized: boolean;
  /** The pick whose turn has already been signalled (or seen at mount). */
  seenPick: number | null;
}

export const TURN_SIGNAL_START: TurnSignalState = { initialized: false, seenPick: null };

/** `fire`: play the haptic + chime (and the flash, when the room is on screen). */
export function nextTurnSignal(prev: TurnSignalState, obs: TurnObservation): { state: TurnSignalState; fire: boolean } {
  if (!prev.initialized) return { state: { initialized: true, seenPick: obs.myTurnPick }, fire: false };
  if (obs.myTurnPick === null || obs.myTurnPick === prev.seenPick) return { state: prev, fire: false };
  // A new turn: consume it either way; announce it only while the app is in front.
  return { state: { initialized: true, seenPick: obs.myTurnPick }, fire: obs.appActive };
}

/** One step of the flash: animate the card's gold fill to `to` (0 rest, 1 gold) over `ms`. */
export interface FlashStep {
  to: 0 | 1;
  ms: number;
}

/** The spec's timeline: on 90 ms (`instant`), hold 220 ms, settle 160 ms (`quick`), twice. */
export const FLASH_STEPS: readonly FlashStep[] = [
  { to: 1, ms: 90 },
  { to: 1, ms: 220 },
  { to: 0, ms: 160 },
  { to: 1, ms: 90 },
  { to: 1, ms: 220 },
  { to: 0, ms: 160 },
];

/** The flash for this run: none with Reduce Motion (the card goes straight to its rest state). */
export function flashSteps(reduced: boolean): readonly FlashStep[] {
  return reduced ? [] : FLASH_STEPS;
}

export function flashDurationMs(steps: readonly FlashStep[]): number {
  return steps.reduce((sum, s) => sum + s.ms, 0);
}

/** Pulses per second never reach WCAG 2.3.1's three-flash limit. */
export function flashCount(steps: readonly FlashStep[]): number {
  let count = 0;
  let level = 0;
  for (const s of steps) {
    if (s.to === 1 && level === 0) count++;
    level = s.to;
  }
  return count;
}

export const LAST_TEN_SECONDS = 10;

/** The last-10-s Warning haptic: once per turn, while it's your turn and 1..10 s remain. */
export function nextLastTenBuzz(
  buzzedPick: number | null,
  obs: { myTurnPick: number | null; secondsLeft: number | null; appActive: boolean },
): { buzzedPick: number | null; buzz: boolean } {
  if (obs.myTurnPick === null || obs.secondsLeft === null) return { buzzedPick, buzz: false };
  if (buzzedPick === obs.myTurnPick) return { buzzedPick, buzz: false };
  if (obs.secondsLeft > LAST_TEN_SECONDS || obs.secondsLeft <= 0) return { buzzedPick, buzz: false };
  return { buzzedPick: obs.myTurnPick, buzz: obs.appActive };
}
