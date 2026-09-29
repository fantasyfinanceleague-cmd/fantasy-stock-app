import { Ionicons } from '@expo/vector-icons';
import { DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LeagueProvider } from '@/lib/LeagueContext';
import { addNotificationListeners } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { verifyAndConsumeRecoveryNonce, setRecoverySession } from '@/lib/recoveryNonce';
import { parseRecoveryLink } from '@/lib/recoveryLink';
import { SessionProvider, useSession } from '@/lib/SessionProvider';
import { pendingRoute, type AuthPhase } from '@/lib/shell/pendingRoute';
import { ShellOverlayProvider } from '@/components/shell/ShellOverlay';
import { useMotion } from '@/components/sp/motion';
import { takeSignInIntent } from '@/lib/shell/signInTransition';
import { useOnboardingSeen } from '@/lib/shell/firstRun';
import { ThemeDipProvider } from '@/components/shell/ThemeDip';
import { ThemeProvider, useTheme } from '@/components/sp/ThemeProvider';

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

// Stable references — defined outside the component so re-renders
// don't create new objects that cause native-stack to reconfigure
const HIDDEN_HEADER = { headerShown: false } as const;
const HIDDEN_HEADER_MODAL = { headerShown: false, presentation: 'modal' } as const;
const HIDDEN_HEADER_FULLSCREEN = { headerShown: false, presentation: 'fullScreenModal' } as const;
const WITH_HEADER = { headerShown: true } as const;
const ROOT = { flex: 1 } as const;
const WITH_HEADER_MODAL = { headerShown: true, presentation: 'modal' } as const;

function RootLayoutNav({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { user, authPhase } = useSession();
  const onboardingSeen = useOnboardingSeen();

  // The phase the navigator renders. authPhase passes through 'unknown' not
  // only at cold start but on EVERY sign-in, while the new account's profile
  // is read. Rendering nothing then would unmount the whole Stack and rebuild
  // it on its first available screen (a hard cut, and it once landed on
  // reset-password). So only the cold start waits; afterwards the last known
  // phase stays on screen (e.g. sign-in, its button busy) until the new one
  // resolves. An intentional sign-in also holds for `quick` so the button's
  // ✓ is seen before the app takes over (S4; lib/shell/signInTransition.ts).
  const { duration: motionDuration, reduced: reducedMotion } = useMotion();
  const [shownPhase, setShownPhase] = useState<AuthPhase>(authPhase);
  useEffect(() => {
    if (authPhase === 'unknown' || authPhase === shownPhase) return;
    const signingIn = shownPhase === 'signedOut' && (authPhase === 'ready' || authPhase === 'gated');
    if (signingIn && takeSignInIntent()) {
      const t = setTimeout(() => setShownPhase(authPhase), motionDuration.quick);
      return () => clearTimeout(t);
    }
    setShownPhase(authPhase);
  }, [authPhase, shownPhase, motionDuration.quick]);
  // §9A ("One design, two themes", 2026-09-29): the status bar's own content
  // colour must flip with the app's theme, not stay hardcoded to "dark"
  // (dark content, for a light background) — "light" content is needed for
  // Dark's navy background, or the clock/battery icons disappear into it.
  const { resolvedTheme, colors, ready: themeReady } = useTheme();
  const statusBarStyle = resolvedTheme === 'dark' ? 'light' : 'dark';

  // Orchestrator, 2026-09-29 follow-up: React Navigation's own chrome (the
  // native-stack background behind transitions, header/tab-bar surfaces)
  // was still hardcoded to React Navigation's light DefaultTheme regardless
  // of app/_layout.tsx's own theme — exactly the light/dark mixing §9A
  // exists to remove. Built from useTheme() instead; `fonts` is unrelated
  // to colour and stays React Navigation's own default.
  const navigationTheme = useMemo(
    () => ({
      dark: resolvedTheme === 'dark',
      colors: {
        primary: colors.accent,
        background: colors.bg,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.loss,
      },
      fonts: DefaultTheme.fonts,
    }),
    [resolvedTheme, colors]
  );

  // Cold-start flash fix (components/sp/ThemeProvider.tsx has the full
  // reasoning): hold the splash screen until the theme preference has
  // been read from storage, alongside the existing font-loading gate —
  // `fontsLoaded` is already guaranteed true by the time this component
  // ever mounts (RootLayout below returns null until then), kept explicit
  // here anyway so the gate reads as a real AND, not an assumption.
  //
  // Phase 3b-1: the splash also holds until the auth phase is known
  // (session read AND, when signed in, the profile's username read). The
  // guards below pick the first screen from that phase, so rendering before
  // it resolves would flash the wrong one.
  const phaseKnown = shownPhase !== 'unknown' && onboardingSeen !== null;
  useEffect(() => {
    if (fontsLoaded && themeReady && phaseKnown) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, themeReady, phaseKnown]);

  // Signed-out deep-link resume (spec gate 9). app/+native-intent.tsx records
  // each incoming link; here every phase change is reported, and when the
  // user reaches the full app from a state in which they couldn't open the
  // link themselves, it is opened now. The deferral lets Stack.Protected's own
  // redirect to the newly available first screen settle before the push.
  const lastPhase = useRef<AuthPhase>('unknown');
  useEffect(() => {
    if (shownPhase === lastPhase.current) return;
    lastPhase.current = shownPhase;
    const target = pendingRoute.authChanged(shownPhase);
    if (target) {
      const t = setTimeout(() => router.push(target as never), 0);
      return () => clearTimeout(t);
    }
  }, [shownPhase]);

  // Handle deep links for password reset
  useEffect(() => {
    // Handle URL when app is opened from a link
    const handleDeepLink = async (event: { url: string }) => {
      const parsed = parseRecoveryLink(event.url);

      if (parsed.kind === 'none') {
        return;
      }

      if (parsed.kind === 'error') {
        // Expired, already-used, or otherwise malformed link — Supabase
        // redirected here with an error instead of tokens. Route to the
        // invalid state rather than leaving reset-password with no session.
        setRecoverySession(false);
        router.replace('/reset-password?status=invalid');
        return;
      }

      // Fixes F2 (deep-link session fixation): only set a session from a
      // recovery link whose nonce matches one THIS device generated for a
      // reset it requested. Fail closed — an attacker's crafted link (or a
      // genuine link opened on a device that never requested the reset, or
      // an older link superseded by a newer request) carries no matching
      // nonce and is refused.
      const nonceOk = await verifyAndConsumeRecoveryNonce(parsed.nonce);
      if (!nonceOk) {
        setRecoverySession(false);
        router.replace('/reset-password?status=invalid');
        return;
      }

      // Set the session with the tokens from the URL
      const { error } = await supabase.auth.setSession({
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken,
      });

      if (error) {
        setRecoverySession(false);
        router.replace('/reset-password?status=invalid');
        return;
      }

      // Mark this session as a recovery session — reset-password.tsx's form
      // state keys off this flag, not "is there any session at all", so a
      // user who lands there some other way while signed in for an
      // unrelated reason doesn't see the form. Cleared on Cancel or success.
      setRecoverySession(true);

      // Navigate to reset password screen
      router.replace('/reset-password');
    };

    // Get the initial URL if app was opened from a link
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink({ url });
      }
    });

    // Listen for URL changes while app is running
    const subscription = Linking.addEventListener('url', handleDeepLink);

    return () => {
      subscription.remove();
    };
  }, []);

  // Set up notification listeners (only when authenticated)
  useEffect(() => {
    if (!user) return;

    const cleanup = addNotificationListeners(
      // When notification is received while app is open
      (notification) => {
        console.log('Notification received in foreground:', notification);
      },
      // When user taps on notification
      (response) => {
        const data = response.notification.request.content.data;
        console.log('Notification tapped, data:', data);

        // Navigate based on notification type
        if (data?.screen === 'draft') {
          router.push('/(tabs)/draft');
        } else if (data?.screen === 'matchup') {
          router.push('/(tabs)/matchup');
        } else if (data?.screen === 'leaderboard' || data?.screen === 'league') {
          router.push('/(tabs)/league');
        }
      }
    );

    return cleanup;
  }, [user]);

  // Nothing renders until the phase is known (the splash is still up).
  if (!phaseKnown) {
    return null;
  }

  const signedIn = shownPhase === 'ready' || shownPhase === 'gated';
  const needsUsername = shownPhase === 'gated';

  // S4: the app and the auth screens crossfade into each other (never a hard
  // cut) — `feature` into the app, where (tabs) adds its 0.96 → 1 scale-in;
  // Reduce Motion: a `base` crossfade.
  const crossfade = {
    headerShown: false,
    animation: 'fade',
    animationDuration: reducedMotion ? motionDuration.base : motionDuration.feature,
  } as const;

  // ONE Stack for every state (Phase 3b-1). Stack.Protected removes a guarded
  // screen from the navigator entirely while its guard is false, so a
  // signed-out deep link to a context-dependent screen can't render it: the
  // router falls back to the first available screen (sign-in), and the link
  // is resumed after sign-in (above).
  //
  // EVERY route must be declared here. expo-router auto-adds any route file
  // that ISN'T declared as an unguarded screen, which would put it outside
  // both guards and make it reachable signed out.
  return (
    <ThemeDipProvider>
      <NavigationThemeProvider value={navigationTheme}>
        <StatusBar style={statusBarStyle} />
        <LeagueProvider>
          {/* The league sheet and S3's flying label are drawn in a layer above
              the Stack (components/shell/ShellOverlay.tsx explains why). */}
          <ShellOverlayProvider>
            <Stack screenOptions={HIDDEN_HEADER}>
              <Stack.Protected guard={!signedIn}>
                {/* First run only (the stored "seen" flag), and skipped when a
                    deep link is waiting: that user already knows where they're
                    going, so they land on sign-in (spec gate 9). */}
                <Stack.Protected guard={!onboardingSeen && !pendingRoute.peek()}>
                  <Stack.Screen name="onboarding" options={crossfade} />
                  <Stack.Screen name="get-started" />
                </Stack.Protected>
                <Stack.Screen name="login" options={crossfade} />
                <Stack.Screen name="create-account" />
                <Stack.Screen name="forgot-password" options={HIDDEN_HEADER_MODAL} />
              </Stack.Protected>

              <Stack.Protected guard={signedIn}>
                {/* A NULL username puts Pick a username in front of everything
                    else (spec row 8); saving it lifts this guard. */}
                <Stack.Protected guard={needsUsername}>
                  <Stack.Screen name="pick-username" options={crossfade} />
                </Stack.Protected>
                <Stack.Protected guard={!needsUsername}>
                  <Stack.Screen name="(tabs)" options={crossfade} />
                  <Stack.Screen name="profile" />
                  <Stack.Screen name="username" />
                  <Stack.Screen name="appearance" />
                  <Stack.Screen name="change-password" />
                  <Stack.Screen name="create-league" options={HIDDEN_HEADER_FULLSCREEN} />
                  <Stack.Screen name="join-league" options={HIDDEN_HEADER_FULLSCREEN} />
                  <Stack.Screen name="league-settings" options={HIDDEN_HEADER_MODAL} />
                  <Stack.Screen name="player-portfolio" options={HIDDEN_HEADER_MODAL} />
                  <Stack.Screen name="trade-history" options={HIDDEN_HEADER_MODAL} />
                  <Stack.Screen name="design-gallery" options={WITH_HEADER} />
                  <Stack.Screen name="modal" options={WITH_HEADER_MODAL} />
                </Stack.Protected>
              </Stack.Protected>

              {/* The recovery link signs the user in to show this screen, so it
                  sits outside both guards; its own nonce-checked handler above
                  decides whether the form appears (PR #41). It is declared LAST
                  on purpose: with no target (a cold start, a remount, or a guard
                  flipping at sign-in/out) the Stack opens its FIRST available
                  screen, which must be sign-in when signed out and (tabs) when
                  signed in — never this one. */}
              <Stack.Screen name="reset-password" options={HIDDEN_HEADER_FULLSCREEN} />
            </Stack>
          </ShellOverlayProvider>
        </LeagueProvider>
      </NavigationThemeProvider>
    </ThemeDipProvider>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...Ionicons.font,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Archivo (Phase 2 foundation, constants/tokens/type.ts): loaded in its OWN
  // useFonts call, deliberately NOT gating the splash screen or throwing on
  // failure like the core fonts above. Per the Orchestrator (2026-09-26): "If
  // Archivo fails to load, the app must still render (fall back; don't hang
  // on the splash)." A missing/corrupt Archivo file falls back to the system
  // font wherever `constants/tokens/type.ts`'s fontFamily isn't registered —
  // RN does this automatically — rather than taking down the whole app the
  // way a core-font failure still does.
  const [archivoLoaded, archivoError] = useFonts({
    'Archivo-Condensed-Black': require('../assets/fonts/archivo/Archivo-Condensed-Black.ttf'),
    'Archivo-Expanded-ExtraBold': require('../assets/fonts/archivo/Archivo-Expanded-ExtraBold.ttf'),
    'Archivo-Regular': require('../assets/fonts/archivo/Archivo-Regular.ttf'),
    'Archivo-Medium': require('../assets/fonts/archivo/Archivo-Medium.ttf'),
    'Archivo-SemiBold': require('../assets/fonts/archivo/Archivo-SemiBold.ttf'),
    'Archivo-Bold': require('../assets/fonts/archivo/Archivo-Bold.ttf'),
    'Archivo-ExtraBold': require('../assets/fonts/archivo/Archivo-ExtraBold.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (archivoError) {
      console.warn('[fonts] Archivo failed to load — sp.* text falls back to the system font.', archivoError);
    }
  }, [archivoError]);

  if (!loaded) {
    return null;
  }

  // `archivoLoaded` isn't read anywhere: it exists only so useFonts' return
  // tuple is fully destructured for clarity at the call site above; nothing
  // needs to branch on it, because a failure already falls back gracefully.
  void archivoLoaded;

  return (
    <GestureHandlerRootView style={ROOT}>
      <ThemeProvider>
        <SessionProvider>
          <RootLayoutNav fontsLoaded={loaded} />
        </SessionProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
