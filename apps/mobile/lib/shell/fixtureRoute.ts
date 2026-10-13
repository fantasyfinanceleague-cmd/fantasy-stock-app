/**
 * Captures only (DEV, headless; W4 League): EXPO_PUBLIC_SHELL_INITIAL_ROUTE opens one route
 * once, right after the tabs mount (e.g. "/league?segment=history"), because a simulator
 * deep link asks "Open in Expo Go?" every time and nothing can tap it without device
 * access. Production builds never read it (__DEV__ only), and it fires once per launch.
 */
import { useEffect } from 'react';
import { router } from 'expo-router';

export const FIXTURE_INITIAL_ROUTE: string | null = __DEV__ ? (process.env.EXPO_PUBLIC_SHELL_INITIAL_ROUTE || null) : null;

let consumed = false;

export function useFixtureInitialRoute(): void {
  useEffect(() => {
    if (!FIXTURE_INITIAL_ROUTE || consumed) return;
    consumed = true;
    // After the first frame, so the tab navigator exists.
    const t = setTimeout(() => router.push(FIXTURE_INITIAL_ROUTE as never), 0);
    return () => clearTimeout(t);
  }, []);
}

/** Captures only (DEV, headless): EXPO_PUBLIC_SHELL_SCROLL_END=1 scrolls a screen's scroll view
 * to its end once, after the content loads, so the bottom of a long screen (the bracket's
 * champion row, League settings' last rows) can be shot without a swipe. */
export const FIXTURE_SCROLL_END: boolean = __DEV__ ? process.env.EXPO_PUBLIC_SHELL_SCROLL_END === '1' : false;

export function useFixtureScrollEnd(ref: { current: { scrollToEnd?: (o?: { animated?: boolean }) => void } | null }): void {
  useEffect(() => {
    if (!FIXTURE_SCROLL_END) return;
    // After the fixture network delay (900 ms) and the reads behind it.
    const t = setTimeout(() => ref.current?.scrollToEnd?.({ animated: false }), 4000);
    return () => clearTimeout(t);
  }, [ref]);
}
