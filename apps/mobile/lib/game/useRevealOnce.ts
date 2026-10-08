/**
 * useRevealOnce (3c, G3): tells the Friday reveal whether to play for this
 * matchup-week. It plays once, when the matchup is final and the reveal has
 * not played for that matchup-week, and it is persisted in AsyncStorage. A
 * failed read or write is never a crash: a failed read means "not played yet"
 * and a failed write only means the reveal may play once more.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { markRevealPlayed, revealKey, shouldPlayReveal, type KeyValueStore } from './revealOnce';

// In-memory copy of what has been read or written, so the synchronous store
// shape holds; the effect below fills it from AsyncStorage before any check.
const cache = new Map<string, string>();

const asyncStore: KeyValueStore = {
  get: (key) => cache.get(key) ?? null,
  set: (key, value) => {
    cache.set(key, value);
    AsyncStorage.setItem(key, value).catch(() => {});
  },
};

/** Returns true while the reveal should PLAY (the banner rises). */
export function useRevealOnce(leagueId: string | null, week: number | null, isFinal: boolean): boolean {
  const [play, setPlay] = useState(false);
  useEffect(() => {
    if (!leagueId || week === null || !isFinal) return;
    const key = revealKey(leagueId, week);
    let cancelled = false;
    (async () => {
      let stored: string | null = cache.get(key) ?? null;
      if (stored === null) {
        try {
          stored = await AsyncStorage.getItem(key);
        } catch {
          stored = null;
        }
        if (stored !== null) cache.set(key, stored);
      }
      if (cancelled) return;
      if (shouldPlayReveal(asyncStore, key, true)) {
        markRevealPlayed(asyncStore, key);
        setPlay(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, week, isFinal]);
  return play;
}
