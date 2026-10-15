/**
 * The notifications ask (onboarding W4; plan 2026-10-14, PRODUCT_RULES "Onboarding"): the iOS
 * permission prompt is NOT shown at sign-in any more. It comes right after the person has joined
 * or created a league, preceded by one line of why, with "Continue" and a "Not now" text link
 * under it. A "Not now" is never pre-prompted again; the setting stays reachable in iOS Settings.
 *
 * Pure (no React Native, no storage), so tests-deno pins every rule. lib/shell/pushAsk.ts reads the
 * stored record and the OS status; this file only decides.
 */

/** What the person did the one time we asked. null = never asked. */
export type PushAskRecord = 'continued' | 'declined' | null;

/** The OS notification permission; 'unavailable' on a simulator / Expo Go (no push token exists there). */
export type OsPush = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/**
 * Pre-prompt only a person who has never been asked AND whose OS permission is still undetermined.
 * A "Not now" (declined) or a Continue (continued) is final; an OS answer already given (a person who
 * had granted before this flow existed, or denied it) is never overridden by our own screen; and an
 * unreadable record is treated as asked (never nag because storage failed: pushAsk.ts reports it as 'declined').
 */
export function shouldPrePrompt(record: PushAskRecord, os: OsPush): boolean {
  return record === null && os === 'undetermined';
}

/** The words on the pre-prompt (the board's frame 4; Giorgio approved "Not now" on 2026-10-14). */
export const PUSH_ASK_COPY = {
  title: "Turn on notifications so you don't miss the draft room opening or your turn.",
  continue: 'Continue',
  notNow: 'Not now',
} as const;

/** Where the ask hands back to. An allow-list: the param is a route string a link could carry. */
export type PushAskDestination = '/(tabs)' | '/(tabs)/league';

export function pushAskDestination(next: string | null | undefined): PushAskDestination {
  return next === '/(tabs)/league' ? '/(tabs)/league' : '/(tabs)';
}

/** The route that shows the ask in front of `next`, or null when the ask is not due. */
export function pushAskRoute(record: PushAskRecord, os: OsPush, next: PushAskDestination): string | null {
  return shouldPrePrompt(record, os) ? `/notifications-ask?next=${encodeURIComponent(next)}` : null;
}
