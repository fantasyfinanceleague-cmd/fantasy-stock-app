import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { color, ThemeColors, ThemeMode } from '@/constants/tokens/color';
import { elevation } from '@/constants/tokens/elevation';
import { resolveTheme } from '@/components/sp/logic/theme';

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
// Cold-start flash (Orchestrator, 2026-09-29 follow-up): the AsyncStorage
// read is necessarily async, so the very first render can't yet know a
// stored override — the initial state below defaults to System (resolved
// synchronously via useColorScheme()), then corrects once the read
// resolves. Left alone, that correction would visibly flash for anyone who
// explicitly chose Light or Dark against their OS setting. Fixed at the
// splash-screen layer instead of by delaying this provider's own first
// render: `ready` flips true once the read has resolved (success OR
// failure/fallback — never hangs), and app/_layout.tsx doesn't call
// SplashScreen.hideAsync() until `ready` is true alongside its existing
// font-loading gate. The read is milliseconds, so the splash (already
// showing regardless) simply covers it. A read/write failure (storage
// full, unavailable, denied) falls back to System rather than throwing.
//
// THEME_FORCED (Orchestrator, 2026-09-29, 1.1.0 regression fix): every
// legacy screen shipped before this migration — and app/(tabs)/_layout.tsx's
// tab bar/headers, hardcoded to Colors.white — is still LIGHT-ONLY; none of
// them read useTheme(). A 1.1.0 build on a phone in system Dark mode would
// otherwise show LIGHT status-bar content over those white screens
// (invisible clock/battery) and a dark navigator background flashing behind
// transitions, since app/_layout.tsx's status bar and navigation theme
// already follow resolvedTheme. Forcing resolvedTheme to 'light' keeps both
// consistent with what every screen actually renders, until the 3b shell
// ships and legacy screens read the theme themselves. The design gallery
// still needs to render both themes for review, so the force is gated on
// `!__DEV__` (see resolveTheme in components/sp/logic/theme.ts) rather than
// scoped to the gallery specifically — nothing outside the dev-only gallery
// calls setPreference() today, so the two are equivalent in practice, and
// gating on __DEV__ avoids threading a scoping prop through this hook.
//
// Phase 3b-1 (ui/mobile-shell-3b1): now null. The shell — tab bar, headers,
// league pill and sheet, auth, onboarding, username, profile, appearance and
// the placeholder tabs — reads useTheme() itself, so System/Light/Dark apply
// for real. Known remainder, owned by later phases: create-league,
// join-league, league-settings, player-portfolio, trade-history and the
// draft room are still light-only legacy screens and will render light
// inside a Dark app until 3c/3e rebuild them. Keep resolveTheme's forced
// path (and sp-theme.test.ts) for any future release that needs it again.
const THEME_FORCED: ThemeMode | null = null;

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
  /** True once the stored preference has been read (or the read failed and
   * fell back to System) — app/_layout.tsx holds the splash screen on this
   * so a stored Light/Dark override never flashes System first. */
  ready: boolean;
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
  // No storage available (web/static rendering) means there is nothing to
  // wait for — ready starts true in that case, false only while a real
  // AsyncStorage read is in flight.
  const [ready, setReady] = useState(() => getAsyncStorage() === null);

  useEffect(() => {
    const storage = getAsyncStorage();
    if (!storage) return;
    let cancelled = false;
    storage
      .getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (isThemePreference(stored)) setPreferenceState(stored);
      })
      .catch(() => {
        // Falls back to the initial 'system' state — nothing to do.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
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

  const resolvedTheme = resolveTheme(preference, systemScheme, THEME_FORCED, __DEV__);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      colors: color[resolvedTheme],
      elevation: elevation[resolvedTheme],
      setPreference,
      ready,
    }),
    [preference, resolvedTheme, ready]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
