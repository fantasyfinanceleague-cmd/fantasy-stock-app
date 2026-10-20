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
 * DEV capture only (EXPO_PUBLIC_CAPTURE_FAIL_ONCE=<read key>[*<n>][,<read key>...]): the named seam read FAILS on its first
 * call and answers normally after, so a load-failure card's "Try again" can be tapped and seen to recover. A read key is
 * the seam's own name for it: an rpc name (get_league_history, get_renewal_roster ...), a table name (matchups_playoff,
 * matchups_week, week_snapshots ...), get_portfolio_ledger (Portfolio's read, and the Matchup roster's ledger state under the seam),
 * or league_draft_slots (the Matchup roster's slots read). The first reader of a key wins. Gated like every capture knob: with the seam off (a
 * production build, or no GAME_SEAM flag) the set is empty and no read ever fails, whatever the variable holds.
 */
export function parseFailOnce(seamOn: boolean, raw: string | undefined): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  if (seamOn !== true || !raw) return out;
  for (const part of raw.split(',')) {
    // <key> fails its first call; <key>*<n> fails its first n calls (a read that another screen makes first, as Home does
    // for get_renewal_roster, needs more than one).
    const m = /^\s*([A-Za-z0-9_]+)(?:\*([1-9]))?\s*$/.exec(part);
    if (m) out.set(m[1], m[2] ? Number(m[2]) : 1);
  }
  return out;
}

/** A counter per key: true for the first n calls of a named read (n = 1 unless `key*n`), false after (and for every other read). */
export function createFailOnce(seamOn: boolean, raw: string | undefined): (key: string) => boolean {
  const left = new Map(parseFailOnce(seamOn, raw));
  return (key) => {
    const n = left.get(key) ?? 0;
    if (n <= 0) return false;
    left.set(key, n - 1);
    return true;
  };
}
