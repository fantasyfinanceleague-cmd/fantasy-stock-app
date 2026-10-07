/**
 * Foreground quiet (3c-2, Design Lead UX rule 11): while the app itself is
 * showing the thing a push would announce, a foreground banner is noise. A
 * screen turns a quiet REASON on while it applies and off when it doesn't
 * (and on unmount); the notification handler (lib/notifications.ts) asks
 * foregroundPresentation() for each foreground notification.
 * - 'own_pick_clock': your draft pick clock is running AND the draft room is on
 *   screen (the room shows it). Elsewhere in the app the your-turn push banner
 *   still shows (the Design Lead's your-turn spec, a consequence for U-14).
 * - 'trade_review': HOOK POINT for 3e's trade review (turn it on while the
 *   review is open; nothing on this branch sets it).
 * Quiet hides the banner and its sound only: the notification still lands in
 * Notification Center (list) and the badge still updates. Pure and
 * dependency-free, so tests-deno sees it.
 */
export type QuietReason = 'own_pick_clock' | 'trade_review';

const active = new Set<QuietReason>();

export function setForegroundQuiet(reason: QuietReason, on: boolean): void {
  if (on) active.add(reason);
  else active.delete(reason);
}

export function foregroundQuiet(): boolean {
  return active.size > 0;
}

/** What expo-notifications should do with a foreground notification. */
export function foregroundPresentation(quiet: boolean): {
  shouldShowAlert: boolean;
  shouldShowBanner: boolean;
  shouldPlaySound: boolean;
  shouldShowList: boolean;
  shouldSetBadge: boolean;
} {
  return {
    shouldShowAlert: !quiet,
    shouldShowBanner: !quiet,
    shouldPlaySound: !quiet,
    shouldShowList: true,
    shouldSetBadge: true,
  };
}

/** Is YOUR pick clock running? (The draft room's own state.) */
export function ownPickClockRunning(isMyTurn: boolean, clockKind: string): boolean {
  return isMyTurn && (clockKind === 'on_clock' || clockKind === 'last10');
}

/** Quiet the your-turn banner only while the draft room is ON SCREEN and your clock runs
 * (your-turn spec): a player elsewhere in the app still gets the banner. */
export function ownPickClockQuiet(isMyTurn: boolean, clockKind: string, roomOnScreen: boolean): boolean {
  return roomOnScreen && ownPickClockRunning(isMyTurn, clockKind);
}
