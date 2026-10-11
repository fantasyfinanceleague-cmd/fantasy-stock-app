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

/** The reveal for this league-week: `decided` once the stored "played" flag has been
 * read (until then the banner must not mount: it takes its start pose from `play` on
 * mount, so a banner shown before the decision could never rise: capture pass,
 * 2026-10-08), and `play` when it should rise. Both are for the CURRENT key only, so a
 * league switch never carries one league's reveal into another's. */
export interface RevealState {
  decided: boolean;
  play: boolean;
}

export function useRevealOnce(leagueId: string | null, week: number | null, isFinal: boolean): RevealState {
  const key = leagueId && week !== null && isFinal ? revealKey(leagueId, week) : null;
  const [state, setState] = useState<{ key: string | null; play: boolean }>({ key: null, play: false });
  useEffect(() => {
    if (!key) return;
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
      const play = shouldPlayReveal(asyncStore, key, true);
      if (play) markRevealPlayed(asyncStore, key);
      setState({ key, play });
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return { decided: key !== null && state.key === key, play: key !== null && state.key === key && state.play };
}
