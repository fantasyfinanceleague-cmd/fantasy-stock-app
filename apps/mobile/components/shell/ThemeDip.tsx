/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { color } from '@/constants/tokens';
import { THEME_FORCED, useTheme, type ThemePreference } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { dipTarget } from '@/lib/shell/themeDip';

// Phase 3b-1 — the Appearance change transition (spec: "the whole app
// crossfades, base"; Design Lead ruling: a dip, quick in / base out).
//
// A true pixel crossfade needs a snapshot of the old frame (a native module;
// declined for this build). Instead: a cover in the NEW theme's `bg` fades
// in (`quick`), the preference swaps underneath it, and the cover fades out
// (`base`) only after the new theme has rendered — keyed on resolvedTheme
// actually changing plus one painted frame, so the old theme's background
// can never flash at the end. A choice that changes nothing on screen (see
// lib/shell/themeDip.ts) swaps with no cover. Reduce Motion: instant swap.
//
// This is the one component that reads BOTH themes' values: it has to
// paint the theme that is about to arrive, not the one on screen.

interface ThemeDipValue {
  changeAppearance: (next: ThemePreference) => void;
}

const ThemeDipContext = createContext<ThemeDipValue | undefined>(undefined);

export function ThemeDipProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme, setPreference } = useTheme();
  const systemScheme = useColorScheme();
  const { reduced, duration, easing } = useMotion();
  const [cover, setCover] = useState<string | null>(null);
  const opacity = useSharedValue(0);
  const waitingFor = useRef<string | null>(null);

  const changeAppearance = useCallback(
    (next: ThemePreference) => {
      const target = dipTarget(resolvedTheme, next, systemScheme, THEME_FORCED, __DEV__);
      if (!target || reduced) {
        setPreference(next);
        return;
      }
      waitingFor.current = target;
      setCover(color[target].bg);
      opacity.value = withTiming(1, { duration: duration.quick, easing: easing.settle }, (done) => {
        if (done) runOnJS(setPreference)(next);
      });
    },
    [resolvedTheme, systemScheme, reduced, setPreference, duration.quick, easing.settle, opacity]
  );

  // Uncover once the new theme is actually on screen.
  useEffect(() => {
    if (waitingFor.current !== resolvedTheme) return;
    waitingFor.current = null;
    const frame = requestAnimationFrame(() => {
      opacity.value = withTiming(0, { duration: duration.base, easing: easing.settle }, (done) => {
        if (done) runOnJS(setCover)(null);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme, duration.base, easing.settle, opacity]);

  const coverStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <ThemeDipContext.Provider value={{ changeAppearance }}>
      {children}
      {cover ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: cover }, coverStyle]} />
      ) : null}
    </ThemeDipContext.Provider>
  );
}

export function useChangeAppearance(): (next: ThemePreference) => void {
  const ctx = useContext(ThemeDipContext);
  if (!ctx) throw new Error('useChangeAppearance must be used within a ThemeDipProvider');
  return ctx.changeAppearance;
}
