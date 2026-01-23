import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Configure how notifications are displayed when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request notification permissions and get push token
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Only works on physical devices
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permissions if not granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission denied');
    return null;
  }

  // Get Expo push token
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: '762da87e-578d-4041-ae85-37d8aa312187', // Your EAS project ID
    });

    console.log('Push token:', tokenData.data);
    return tokenData.data;
  } catch (error) {
    console.error('Failed to get push token:', error);
    return null;
  }
}

/**
 * Save push token to user's profile in database
 */
export async function savePushToken(userId: string, token: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('user_profiles')
      .update({ expo_push_token: token })
      .eq('id', userId);

    if (error) {
      console.error('Failed to save push token:', error);
      return false;
    }

    console.log('Push token saved successfully');
    return true;
  } catch (error) {
    console.error('Error saving push token:', error);
    return false;
  }
}

/**
 * Remove push token when user logs out
 */
export async function removePushToken(userId: string): Promise<void> {
  try {
    await supabase
      .from('user_profiles')
      .update({ expo_push_token: null })
      .eq('id', userId);
  } catch (error) {
    console.error('Error removing push token:', error);
  }
}

/**
 * Register and save push token for a user
 */
export async function setupPushNotifications(userId: string): Promise<void> {
  const token = await registerForPushNotifications();
  if (token) {
    await savePushToken(userId, token);
  }
}

/**
 * Send a push notification via Expo's push service
 * This can be called from the app or from a Supabase Edge Function
 */
export async function sendPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<boolean> {
  const message = {
    to: expoPushToken,
    sound: 'default',
    title,
    body,
    data: data || {},
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();
    console.log('Push notification sent:', result);
    return true;
  } catch (error) {
    console.error('Failed to send push notification:', error);
    return false;
  }
}

/**
 * Add listeners for notification events
 */
export function addNotificationListeners(
  onNotificationReceived?: (notification: Notifications.Notification) => void,
  onNotificationTapped?: (response: Notifications.NotificationResponse) => void
) {
  // When notification is received while app is open
  const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
    console.log('Notification received:', notification);
    onNotificationReceived?.(notification);
  });

  // When user taps on notification
  const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
    console.log('Notification tapped:', response);
    onNotificationTapped?.(response);
  });

  // Return cleanup function
  return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
  };
}

/**
 * Get push tokens for all members of a league
 */
export async function getLeagueMemberTokens(leagueId: string, excludeUserId?: string): Promise<Array<{ userId: string; token: string }>> {
  try {
    // Get all league members
    const { data: members, error: membersError } = await supabase
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId);

    if (membersError || !members) {
      console.error('Failed to get league members:', membersError);
      return [];
    }

    const userIds = members
      .map(m => m.user_id)
      .filter(id => id !== excludeUserId);

    if (userIds.length === 0) return [];

    // Get push tokens for these users
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('id, expo_push_token, notifications_enabled')
      .in('id', userIds)
      .eq('notifications_enabled', true)
      .not('expo_push_token', 'is', null);

    if (profilesError || !profiles) {
      console.error('Failed to get user profiles:', profilesError);
      return [];
    }

    return profiles
      .filter(p => p.expo_push_token)
      .map(p => ({ userId: p.id, token: p.expo_push_token! }));
  } catch (error) {
    console.error('Error getting league member tokens:', error);
    return [];
  }
}

/**
 * Notify a user that it's their turn to draft
 */
export async function notifyDraftTurn(
  userId: string,
  leagueName: string
): Promise<void> {
  try {
    // Get the user's push token
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('expo_push_token, notifications_enabled')
      .eq('id', userId)
      .single();

    if (!profile?.expo_push_token || !profile.notifications_enabled) {
      console.log('User has no push token or notifications disabled');
      return;
    }

    await sendPushNotification(
      profile.expo_push_token,
      "It's Your Turn! 🏈",
      `Time to make your pick in ${leagueName}`,
      { type: 'draft_turn', screen: 'draft' }
    );
  } catch (error) {
    console.error('Error sending draft turn notification:', error);
  }
}
