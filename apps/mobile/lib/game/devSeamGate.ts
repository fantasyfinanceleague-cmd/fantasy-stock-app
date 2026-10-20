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

/**
 * DEV capture only (EXPO_PUBLIC_CAPTURE_FAIL_ONCE=<read key>[,<read key>...]): the named seam read FAILS on its first
 * call and answers normally after, so a load-failure card's "Try again" can be tapped and seen to recover. A read key is
 * the seam's own name for it: an rpc name (get_league_history, get_renewal_roster ...), a table name (matchups_playoff,
 * matchups_week, week_snapshots ...), or get_portfolio_ledger. Gated like every capture knob: with the seam off (a
 * production build, or no GAME_SEAM flag) the set is empty and no read ever fails, whatever the variable holds.
 */
export function parseFailOnce(seamOn: boolean, raw: string | undefined): ReadonlySet<string> {
  if (seamOn !== true || !raw) return new Set();
  return new Set(raw.split(',').map((k) => k.trim()).filter((k) => /^[A-Za-z0-9_]+$/.test(k)));
}

/** A one-shot per key: true the first time a named read is asked, false every time after (and for every other read). */
export function createFailOnce(seamOn: boolean, raw: string | undefined): (key: string) => boolean {
  const pending = new Set(parseFailOnce(seamOn, raw));
  return (key) => pending.delete(key);
}
