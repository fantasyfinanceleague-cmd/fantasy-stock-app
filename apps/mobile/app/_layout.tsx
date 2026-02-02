import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { LeagueProvider } from '@/lib/LeagueContext';
import { addNotificationListeners } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
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

  // Set up notification listeners
  useEffect(() => {
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
  }, []);

  return (
    <ThemeProvider value={DarkTheme}>
      <LeagueProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="forgot-password" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="reset-password" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="create-league" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="join-league" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="league-settings" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="player-portfolio" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="trade-history" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
      </LeagueProvider>
    </ThemeProvider>
  );
}
