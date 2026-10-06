/**
 * The capture seam's gate, pure (3c): on only in a dev build AND with the flag set
 * to exactly '1'. No RN or Expo globals here, so the rule is tested under deno.
 */
export function seamActive(isDev: boolean, flag: string | undefined): boolean {
  return isDev === true && flag === '1';
}

/** Which league fixture the shared league context uses (3c): the shell fixture when
 * one is set, else the board's leagues under the seam, else none (the real reads). */
export function pickLeagueFixture<T>(shellFixture: T | null, seamOn: boolean, seamLeagues: T): T | null {
  if (shellFixture !== null) return shellFixture;
  return seamOn ? seamLeagues : null;
}
