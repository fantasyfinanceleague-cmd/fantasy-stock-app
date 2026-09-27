import { Ionicons } from '@expo/vector-icons';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
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
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { LeagueProvider } from '@/lib/LeagueContext';
import { addNotificationListeners } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { verifyAndConsumeRecoveryNonce } from '@/lib/recoveryNonce';
import { useAuth } from '@/lib/useAuth';

export {
  ErrorBoundary,
} from 'expo-router';

// DEV-ONLY, TWICE OVER (Phase 2 foundation): normal runs never set
// EXPO_PUBLIC_DEV_START_ROUTE, so this is `false` and behavior is identical
// to today. It exists because a real OS deep link (`simctl openurl` /
// Universal Link) into the signed-out Stack lands on login instead of the
// requested screen regardless of target — reproduced with forgot-password,
// an unrelated, always-registered screen, so it's a pre-existing race
// between Linking's initial-URL handling and RootLayoutNav's async auth
// check (its own task now, not fixed here). This gives dev verification a
// deterministic way in that doesn't touch that race: start Metro with
// `EXPO_PUBLIC_DEV_START_ROUTE=design-gallery npx expo start --go --port 8085 --clear`.
const DEV_START_ON_GALLERY = __DEV__ && process.env.EXPO_PUBLIC_DEV_START_ROUTE === 'design-gallery';

// Neither an `initialRouteName` prop on the `<Stack>` JSX element NOR setting
// it here in `unstable_settings` actually changes which screen opens first —
// both verified inert (the Stack still opened on its first declared
// `<Stack.Screen>` child regardless, even after a full simulator reboot ruled
// out stale navigation state). `unstable_settings.initialRouteName` governs
// back-history synthesis for a deep-linked route GROUP, not which screen a
// Stack opens on with no navigation state — '(tabs)' below is the default
// simply because it's the first-listed screen in the authenticated Stack,
// not because of this export. Left as '(tabs)' (its original, unconditional
// value) since it isn't the mechanism DEV_START_ON_GALLERY needs — see the
// signed-out Stack below, where that screen's position in the JSX list is
// the actual lever.
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

// Stable references — defined outside the component so re-renders
// don't create new objects that cause native-stack to reconfigure
const HIDDEN_HEADER = { headerShown: false } as const;
const HIDDEN_HEADER_MODAL = { headerShown: false, presentation: 'modal' } as const;
const HIDDEN_HEADER_FULLSCREEN = { headerShown: false, presentation: 'fullScreenModal' } as const;
const AUTH_SCREEN_OPTIONS = { headerShown: false } as const;

function RootLayoutNav() {
  const { user, loading } = useAuth();

  // Handle deep links for password reset
  useEffect(() => {
    // Handle URL when app is opened from a link
    const handleDeepLink = async (event: { url: string }) => {
      const url = event.url;

      // Check if this is a password reset link
      if (url.includes('reset-password') || url.includes('type=recovery')) {
        // Extract the hash fragment (contains access_token, refresh_token, etc.)
        const hashIndex = url.indexOf('#');
        if (hashIndex !== -1) {
          const hash = url.substring(hashIndex + 1);
          const params = new URLSearchParams(hash);
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');

          // Parse the per-request nonce from the QUERY (strictly before the
          // '#'), so an rn smuggled into the fragment cannot satisfy the check.
          const queryStart = url.indexOf('?');
          let inboundNonce: string | null = null;
          if (queryStart !== -1 && queryStart < hashIndex) {
            const query = url.substring(queryStart + 1, hashIndex);
            inboundNonce = new URLSearchParams(query).get('rn');
          }

          if (accessToken && refreshToken) {
            // Fixes F2 (deep-link session fixation): only set a session from a
            // recovery link whose nonce matches one THIS device generated for a
            // reset it requested. Fail closed — an attacker's crafted link (or a
            // genuine link opened on a device that never requested the reset)
            // carries no matching nonce and is refused.
            const nonceOk = await verifyAndConsumeRecoveryNonce(inboundNonce);
            if (!nonceOk) {
              return;
            }

            // Set the session with the tokens from the URL
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (!error) {
              // Navigate to reset password screen
              router.replace('/reset-password');
            }
          }
        }
      }
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

  // Show nothing while loading auth state to prevent flash
  if (loading) {
    return null;
  }

  // Not authenticated — no LeagueProvider needed, stable screenOptions
  if (!user) {
    return (
      <ThemeProvider value={DefaultTheme}>
        <StatusBar style="dark" />
        <Stack screenOptions={AUTH_SCREEN_OPTIONS}>
          {/* DEV-ONLY (Phase 2 foundation): this Stack is otherwise limited to
              auth screens, so design-gallery.tsx (which needs no sign-in) is
              unreachable while signed out unless explicitly registered here.
              design-gallery.tsx's own !__DEV__ redirect is the belt to this
              suspenders — either one alone keeps it out of a release build.
              A Stack Navigator's opening screen (with no navigation state)
              is simply its first-declared child — neither an `initialRouteName`
              prop nor `unstable_settings` changed it here (both verified
              inert) — so DEV_START_ON_GALLERY controls this by conditionally
              registering design-gallery FIRST instead of after reset-password;
              it must still appear exactly once, so the two branches are
              mutually exclusive. */}
          {DEV_START_ON_GALLERY && <Stack.Screen name="design-gallery" options={HIDDEN_HEADER} />}
          <Stack.Screen name="login" />
          <Stack.Screen name="forgot-password" options={HIDDEN_HEADER_MODAL} />
          <Stack.Screen name="reset-password" options={HIDDEN_HEADER_FULLSCREEN} />
          {__DEV__ && !DEV_START_ON_GALLERY && <Stack.Screen name="design-gallery" options={HIDDEN_HEADER} />}
        </Stack>
      </ThemeProvider>
    );
  }

  // Authenticated — full app with tabs
  return (
    <ThemeProvider value={DefaultTheme}>
      <StatusBar style="dark" />
      <LeagueProvider>
        {/* design-gallery.tsx (Phase 2 foundation, dev-only) is NOT listed
            here: expo-router auto-appends unlisted file routes to whatever
            Stack mounts, so it's already implicitly reachable in this
            authenticated tree. It redirects itself when !__DEV__. */}
        <Stack>
          <Stack.Screen name="(tabs)" options={HIDDEN_HEADER} />
          <Stack.Screen name="login" options={HIDDEN_HEADER} />
          <Stack.Screen name="forgot-password" options={HIDDEN_HEADER_MODAL} />
          <Stack.Screen name="reset-password" options={HIDDEN_HEADER_FULLSCREEN} />
          <Stack.Screen name="create-league" options={HIDDEN_HEADER_FULLSCREEN} />
          <Stack.Screen name="join-league" options={HIDDEN_HEADER_FULLSCREEN} />
          <Stack.Screen name="league-settings" options={HIDDEN_HEADER_MODAL} />
          <Stack.Screen name="player-portfolio" options={HIDDEN_HEADER_MODAL} />
          <Stack.Screen name="trade-history" options={HIDDEN_HEADER_MODAL} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
      </LeagueProvider>
    </ThemeProvider>
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

  useEffect(() => {
    // Splash hides once the CORE fonts are ready. Archivo is intentionally
    // excluded from this gate (see above) so a slow or failed Archivo load
    // never keeps the app on the splash screen.
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  // `archivoLoaded` isn't read anywhere: it exists only so useFonts' return
  // tuple is fully destructured for clarity at the call site above; nothing
  // needs to branch on it, because a failure already falls back gracefully.
  void archivoLoaded;

  return <RootLayoutNav />;
}
