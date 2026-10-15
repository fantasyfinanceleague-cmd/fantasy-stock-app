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
import { notificationRoute } from '@/lib/shell/notificationRoute';
import { addNotificationListeners, removePushToken } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { isRecoveryHold, isRecoverySession, setRecoveryInProgress, setRecoverySession, subscribeRecoverySession } from '@/lib/auth/recoverySession';
import { verifierSlot } from '@/lib/auth/verifierStorage';
import { createAuthLinkHandler, type AuthLinkOutcome } from '@/lib/auth/authLinkHandlers';
import { raisesConfirmFailedNotice, setConfirmFailedNotice } from '@/lib/auth/confirmFailedNotice';
import { createLinkDedupe } from '@/lib/auth/authLink';
import { setEmailJustConfirmed } from '@/lib/auth/emailConfirmed';
import { SHELL_FIXTURE } from '@/lib/shell/devFixture';
import { SessionProvider, useSession } from '@/lib/SessionProvider';
import { pendingRoute, type AuthPhase } from '@/lib/shell/pendingRoute';
import { getLiveSession } from '@/lib/auth/liveSession';
import { inviteJoinRoute, inviteOwnerAction, shouldAutoOpenInvite, shouldClearInviteOnAuthChange, signedInAtArrivalFrom } from '@/lib/invite/autoJoin';
import { pendingInvite as inviteStore, useInviteSnapshot } from '@/lib/invite/pendingInviteStore';
import { ShellOverlayProvider } from '@/components/shell/ShellOverlay';
import { MoneyHostProvider } from '@/components/money/MoneyHost';
import { useMotion } from '@/components/sp/motion';
import { takeSignInIntent } from '@/lib/shell/signInTransition';
import { useGetStartedOpen, useOnboardingSeen } from '@/lib/shell/firstRun';
import { useArrivalInvite } from '@/lib/invite/useArrivalInvite';
import { ThemeDipProvider } from '@/components/shell/ThemeDip';
import { ThemeProvider, useTheme } from '@/components/sp/ThemeProvider';

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// A cold-start auth link can arrive twice (getInitialURL AND the 'url' event); handle it once. A code is
// single use, so a second exchange would fail (and flip a working password reset to "invalid").
const handledAuthLinks = createLinkDedupe();

// Rejects (harmlessly) when the splash is already gone, e.g. on a dev reload: handled.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Stable references — defined outside the component so re-renders
// don't create new objects that cause native-stack to reconfigure
const HIDDEN_HEADER = { headerShown: false } as const;
const HIDDEN_HEADER_MODAL = { headerShown: false, presentation: 'modal' } as const;
const HIDDEN_HEADER_FULLSCREEN = { headerShown: false, presentation: 'fullScreenModal' } as const;
const WITH_HEADER = { headerShown: true } as const;
const ROOT = { flex: 1 } as const;

function RootLayoutNav({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { user, authPhase } = useSession();
  const onboardingSeen = useOnboardingSeen();
  const getStartedOpen = useGetStartedOpen();
  // W4's arrival: the pending invite as the arrival screen reads it (a DEV fixture may stand in), or null. W3's store is
  // imported as `inviteStore` so this name stays W4's.
  const pendingInvite = useArrivalInvite();
  const invite = useInviteSnapshot();

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
  // The stored invite is read before the first screen is chosen too: a person who tapped an invite link and
  // relaunched must not see the sign-in form flash before the invite does (W3).
  const phaseKnown = shownPhase !== 'unknown' && onboardingSeen !== null && invite.loaded;
  useEffect(() => {
    if (fontsLoaded && themeReady && phaseKnown) {
      // hideAsync REJECTS when no native splash is up (every JS reload after the first launch:
      // "No native splash screen registered…"). Nothing to hide is not an error — and an
      // unhandled rejection surfaced as a red dev toast over every reloaded screen (W4 gate).
      SplashScreen.hideAsync().catch(() => {});
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
    // While a password-recovery link is being exchanged (or its form is open) the link is KEPT, not replayed:
    // supabase-js emits SIGNED_IN inside the exchange, and a pushed screen would land on top of the reset form.
    const target = pendingRoute.authChanged(shownPhase, isRecoveryHold());
    if (target) {
      const t = setTimeout(() => router.push(target as never), 0);
      return () => clearTimeout(t);
    }
  }, [shownPhase]);

  // An invite belongs to the person who tapped it: when the signed-in person CHANGES or signs out (from any phase,
  // the username gate included), it is dropped, so person B on the same phone never auto-joins A's pending league.
  // The first sign-in (nobody before) keeps it: that is the invited friend arriving.
  const userId = user?.id ?? null;
  const lastUserId = useRef<string | null>(null);
  // The invite code THIS render saw: the effects below clear only that one, so a link captured between the commit and the
  // effect is not wiped by a decision made about the previous one.
  const renderedInviteCode = useRef<string | null>(null);
  renderedInviteCode.current = invite.code;
  useEffect(() => {
    const seen = renderedInviteCode.current;
    if (seen && shouldClearInviteOnAuthChange(lastUserId.current, userId)) void inviteStore.clear(seen);
    lastUserId.current = userId;
  }, [userId]);

  // Whose invite is it? Stamped with the person signed in the first time they are signed in with it pending; a
  // DIFFERENT person signing in later (even after a cold start that never saw the first one sign out) drops it.
  const ownerAction = invite.loaded && invite.code ? inviteOwnerAction(invite.ownerUserId, userId) : 'none';
  useEffect(() => {
    const seen = renderedInviteCode.current;
    if (ownerAction === 'claim' && userId && seen) inviteStore.claim(userId, seen);
    else if (ownerAction === 'clear' && seen) void inviteStore.clear(seen);
  }, [ownerAction, userId]);

  // A link that arrived at a cold start (auth not resolved yet) records "unknown"; the first resolved phase settles whether
  // the person had a session then. The https link never needs it (it auto-joins either way).
  useEffect(() => {
    if (invite.code && invite.signedInAtArrival === null && shownPhase !== 'unknown') {
      // The live session first (no lag), the phase only as the fallback.
      inviteStore.settleArrival(getLiveSession().signedIn ?? signedInAtArrivalFrom(shownPhase) === true);
    }
  }, [invite.code, invite.signedInAtArrival, shownPhase]);
  const arrivalSettled = invite.origin === 'https' || invite.signedInAtArrival !== null;

  // ...and opened when the hold ends (the reset finished or was cancelled, or the link was refused).
  const [holdTick, setHoldTick] = useState(0);
  useEffect(() => {
    return subscribeRecoverySession(() => {
      setHoldTick((n) => n + 1); // the pending invite (below) re-checks whether it may open now
      if (isRecoveryHold()) return;
      const held = pendingRoute.releaseHold();
      if (held) setTimeout(() => router.push(held as never), 0);
    });
  }, []);

  // Onboarding W3: the invite link's code, kept as the pending invite (app/+native-intent.tsx), opens the join
  // screen ONCE per code per launch, the moment the person is in the full app: after sign-in, after the username
  // step, after an email-confirmation round trip, or straight away for someone already signed in. The screen
  // (app/join-league.tsx, invite mode) joins without a tap and clears the invite on every definitive answer.
  // No cleanup on the timer on purpose: marking the code opened re-runs this effect, which would cancel it.
  useEffect(() => {
    if (!shouldAutoOpenInvite({ phase: shownPhase, code: invite.code, autoOpenedCode: invite.autoOpenedCode, recoveryHold: isRecoveryHold(), ownerAction, arrivalSettled })) return;
    inviteStore.markAutoOpened(invite.code as string);
    // Auto-join for the shared https link; the "Join {league}" preview that waits for a tap for a scheme link that
    // arrived while signed in (inviteJoinRoute, decision 18).
    const route = inviteJoinRoute(invite);
    setTimeout(() => router.push(route as never), 0);
  }, [shownPhase, invite, holdTick, ownerAction, arrivalSettled]);

  // The two email return links, both PKCE one-time codes (lib/supabase.ts flowType 'pkce'):
  //   fantasystockapp://auth/confirm?code=…                  sign-up confirmation (onboarding W2)
  //   fantasystockapp://reset-password?flow=pkce&code=…      password recovery
  // supabase.auth.exchangeCodeForSession(code) succeeds only on the device that holds the code verifier
  // stored when the flow began, so a forged, replayed or intercepted link fails. The decisions live in
  // lib/auth/authLinkHandlers.ts (tested without React); this binds the real client, router and flags.
  useEffect(() => {
    const handleDeepLink = createAuthLinkHandler({
      confirmEnabled: !SHELL_FIXTURE,
      getSession: () => supabase.auth.getSession(),
      exchangeCodeForSession: (code) => supabase.auth.exchangeCodeForSession(code),
      readVerifier: verifierSlot.read,
      writeVerifier: verifierSlot.write,
      signOut: () => supabase.auth.signOut({ scope: 'local' }),
      isRecoveryActive: isRecoverySession,
      setRecoveryInProgress,
      removePushToken,
      setEmailJustConfirmed,
      setRecoverySession,
      replaceRoute: (path) => router.replace(path as never),
      warn: (message, code) => console.warn(message, code),
      dedupe: handledAuthLinks,
    });

    // The one outcome the screens care about: a confirmation link reached THIS phone with a code the
    // phone couldn't exchange, so Sign in says the email is confirmed (lib/auth/confirmFailedNotice.ts;
    // plan Decisions row 16). Every other outcome, 'confirm-ignored' and 'confirm-wrong-type' included,
    // leaves Sign in as it was.
    const noteOutcome = (outcome: AuthLinkOutcome) => {
      if (raisesConfirmFailedNotice(outcome)) setConfirmFailedNotice(true);
    };

    // Get the initial URL if app was opened from a link
    Linking.getInitialURL().then((url) => {
      if (url) {
        void handleDeepLink(url).then(noteOutcome).catch(() => console.warn('[auth] link handler failed', ''));
      }
    });

    // Listen for URL changes while app is running
    const subscription = Linking.addEventListener('url', (event) => {
      void handleDeepLink(event.url).then(noteOutcome).catch(() => console.warn('[auth] link handler failed', ''));
    });

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

        // Navigate based on notification type. Draft pushes open the League
        // tab (lobby or room by phase), never the legacy (tabs)/draft route.
        const target = notificationRoute(data);
        if (target) router.push(target);
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
          <MoneyHostProvider>
          {/* The league sheet and S3's flying label are drawn in a layer above
              the Stack (components/shell/ShellOverlay.tsx explains why). */}
          <ShellOverlayProvider>
            <Stack screenOptions={HIDDEN_HEADER}>
              <Stack.Protected guard={!signedIn}>
                {/* An invite link's arrival (W4; W3 supplies the pending invite). First in the group, so a
                    signed-out person with an invite pending lands here, not on the cards or Sign in. */}
                <Stack.Protected guard={pendingInvite !== null}>
                  <Stack.Screen name="invite" options={crossfade} />
                </Stack.Protected>
                {/* First run only (the stored "seen" flag), and skipped when a
                    deep link or an invite is waiting: that user already knows where
                    they're going, so they land on sign-in (spec gate 9). */}
                <Stack.Protected guard={!onboardingSeen && !pendingRoute.peek() && !invite.code}>
                  <Stack.Screen name="onboarding" options={crossfade} />
                </Stack.Protected>
                {/* Get started follows the cards on the cold path. It stays open after a Skip marks the
                    cards seen (lib/shell/firstRun.ts openGetStarted), until the person leaves it. */}
                <Stack.Protected guard={getStartedOpen || (!onboardingSeen && !pendingRoute.peek())}>
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
                  <Stack.Screen name="notifications-ask" options={HIDDEN_HEADER} />
                  <Stack.Screen name="create-league" options={HIDDEN_HEADER_FULLSCREEN} />
                  <Stack.Screen name="join-league" options={HIDDEN_HEADER_FULLSCREEN} />
                  <Stack.Screen name="league-settings" options={HIDDEN_HEADER_MODAL} />
                  <Stack.Screen name="player-portfolio" options={HIDDEN_HEADER_MODAL} />
                  <Stack.Screen name="trade-history" options={HIDDEN_HEADER_MODAL} />
                  {/* S-15: was undeclared, so expo-router auto-added it outside
                      both guards (reachable signed out by deep link). Default
                      options, exactly as it was presented when auto-added. */}
                  <Stack.Screen name="stock-search" />
                  {/* A dev tool: registered ONLY in a development build. Guarded out
                      in a release, the navigator never learns the route, so a link
                      to it falls back to the first screen (Home when signed in,
                      sign-in when signed out) instead of opening the gallery.
                      design-gallery's own `!__DEV__` redirect stays as the second
                      layer. Checked in a --no-dev bundle:
                      docs/design/1.2.0-release-route-check.md */}
                  <Stack.Protected guard={__DEV__}>
                    <Stack.Screen name="design-gallery" options={WITH_HEADER} />
                  </Stack.Protected>
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
          </MoneyHostProvider>
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
