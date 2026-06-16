import FontAwesome from '@expo/vector-icons/FontAwesome';
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
import { useAuth } from '@/lib/useAuth';

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
const AUTH_SCREEN_OPTIONS = { headerShown: false } as const;

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

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

          if (accessToken && refreshToken) {
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
          <Stack.Screen name="login" />
          <Stack.Screen name="forgot-password" options={HIDDEN_HEADER_MODAL} />
          <Stack.Screen name="reset-password" options={HIDDEN_HEADER_FULLSCREEN} />
        </Stack>
      </ThemeProvider>
    );
  }

  // Authenticated — full app with tabs
  return (
    <ThemeProvider value={DefaultTheme}>
      <StatusBar style="dark" />
      <LeagueProvider>
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
