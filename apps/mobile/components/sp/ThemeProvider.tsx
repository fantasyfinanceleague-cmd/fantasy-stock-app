import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { color, ThemeColors, ThemeMode } from '@/constants/tokens/color';
import { elevation } from '@/constants/tokens/elevation';

// Stockpile — <ThemeProvider> / useTheme() (§9A, "One design, two themes",
// 2026-09-29). SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §9A.
// Replaces <Surface kind="money" | "game">: a screen is entirely Light or
// entirely Dark, resolved once here and read by every `sp.*` component —
// nothing branches on a surface kind any more.
//
// Storage: @react-native-async-storage/async-storage was already a
// dependency (lib/supabase.ts, lib/recoveryNonce.ts) — reused here rather
// than adding a new native module, which would force a new EAS build instead
// of shipping this over-the-air. Guarded the same way lib/supabase.ts guards
// it (native only, not during web/static rendering) since this app also
// builds for Expo web, where this module doesn't apply.
//
// System resolution is LIVE: useColorScheme() subscribes to the OS
// Appearance change listener internally and re-renders this provider
// whenever the OS theme flips while the app is running, not just at launch —
// that's RN's own behaviour, nothing extra needed here for it.
//
// Cold-start flash: the AsyncStorage read is necessarily async, so the very
// first render can't yet know a stored override. Chose to default to System
// immediately (resolved synchronously via useColorScheme(), no wait) rather
// than holding the first frame until the read completes — System is already
// correct for anyone who hasn't set an explicit preference, i.e. most users,
// and it's the Design Lead's own stated recommendation. The minority who
// explicitly chose Light or Dark against their OS setting see one silent
// correction moments after mount once the stored value loads, which reads as
// a normal settle rather than a flash. A read/write failure (storage full,
// unavailable, denied) falls back to System rather than throwing.

export type ThemePreference = 'system' | ThemeMode;

const STORAGE_KEY = '@stockpile/theme-preference';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

// Same guard as lib/supabase.ts: AsyncStorage only applies on native, and a
// top-level require would break static/web rendering.
function getAsyncStorage(): typeof import('@react-native-async-storage/async-storage').default | null {
  if (Platform.OS === 'web' || typeof window === 'undefined') return null;
  return require('@react-native-async-storage/async-storage').default;
}

export interface ThemeContextValue {
  /** The user's stored choice — may be 'system'. */
  preference: ThemePreference;
  /** The theme actually in effect right now (System already resolved). */
  resolvedTheme: ThemeMode;
  colors: ThemeColors;
  elevation: (typeof elevation)[ThemeMode];
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() must be called within a <ThemeProvider>.');
  }
  return ctx;
}

export interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    const storage = getAsyncStorage();
    if (!storage) return;
    let cancelled = false;
    storage
      .getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled || !isThemePreference(stored)) return;
        setPreferenceState(stored);
      })
      .catch(() => {
        // Falls back to the initial 'system' state — nothing to do.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function setPreference(next: ThemePreference) {
    setPreferenceState(next);
    const storage = getAsyncStorage();
    if (!storage) return;
    storage.setItem(STORAGE_KEY, next).catch(() => {
      // Best-effort persistence: the in-memory preference above still holds
      // for the rest of this session even if the write fails.
    });
  }

  const resolvedTheme: ThemeMode = preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      colors: color[resolvedTheme],
      elevation: elevation[resolvedTheme],
      setPreference,
    }),
    [preference, resolvedTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
