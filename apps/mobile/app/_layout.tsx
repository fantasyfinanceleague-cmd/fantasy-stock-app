import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { LeagueProvider } from '@/lib/LeagueContext';
import { addNotificationListeners } from '@/lib/notifications';

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
        } else if (data?.screen === 'leaderboard') {
          router.push('/(tabs)/leaderboard');
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
          <Stack.Screen name="create-league" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="join-league" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="league-settings" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="player-portfolio" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
      </LeagueProvider>
    </ThemeProvider>
  );
}
