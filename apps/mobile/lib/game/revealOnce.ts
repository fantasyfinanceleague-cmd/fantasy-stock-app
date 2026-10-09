/**
 * revealOnce: the G3 Friday reveal plays once per matchup-week (3c). The
 * flag is persisted through an injected key-value store (AsyncStorage in the
 * app, a Map in tests). Callers wrap the store's own reads and writes in
 * try/catch: a failed read means "not played yet", never a crash.
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function revealKey(leagueId: string, week: number): string {
  return `reveal:${leagueId}:${week}`;
}

/** Plays only once the matchup is final, and only the first time. */
export function shouldPlayReveal(store: KeyValueStore, key: string, isFinal: boolean): boolean {
  return isFinal && store.get(key) === null;
}

export function markRevealPlayed(store: KeyValueStore, key: string): void {
  store.set(key, '1');
}
