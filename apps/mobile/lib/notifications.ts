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
  // Writes to the owner-scoped push_tokens table if it exists, else the legacy
  // user_profiles column. The fallback makes this ONE client ship work both
  // before and after the phase-2 relocation migration, so the two phases can be
  // deployed and verified independently instead of having to land together.
  // Remove the fallback once the migration is applied everywhere.
  try {
    const { error: newErr } = await supabase
      .from('push_tokens')
      .upsert({ user_id: userId, token, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (!newErr) return true;

    const { error: legacyErr } = await supabase
      .from('user_profiles')
      .update({ expo_push_token: token })
      .eq('id', userId);
    if (legacyErr) {
      console.error('Failed to save push token (both paths):', legacyErr.message ?? legacyErr);
      return false;
    }
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
  // Clear from BOTH stores — during the phase-1/phase-2 overlap a token may exist
  // in either, and a logout that leaves one behind leaves a live capability
  // pointing at a device the user just signed out of.
  try {
    await supabase.from('push_tokens').delete().eq('user_id', userId);
  } catch { /* table may not exist yet (pre-phase-2) */ }
  try {
    await supabase.from('user_profiles').update({ expo_push_token: null }).eq('id', userId);
  } catch { /* column may be gone (post-phase-2) */ }
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

// getLeagueMemberTokens was REMOVED 2026-07-28. It was dead code (zero callers)
// that read EVERY league member's expo_push_token to the device. An Expo push
// token is a bearer capability — exp.host/--/api/v2/push/send requires nothing
// but the token — so bulk-reading other users' tokens client-side is a
// capability leak with no caller to justify it. See docs/architecture
// annotations tbl.user_profiles (L2). Do not reintroduce a client-side
// token reader; notification sending belongs behind an edge function.

/**
 * Notify a user that it's their turn to draft.
 *
 * CUT OVER 2026-07-30 to the send-notification edge function (scan F7/F8).
 * This used to read the TARGET user's expo_push_token client-side and POST to
 * Expo directly, which is why every authenticated user needed to be able to read
 * every other user's token. An Expo token is a bearer capability, so that was a
 * spam/phishing primitive. The token never reaches the client now.
 *
 * SIGNATURE CHANGED: leagueId, not leagueName. The league name used to be a
 * caller-supplied string that went straight into the notification body — content
 * the sender controlled. The server now looks it up from the id, so the body
 * cannot be forged. Callers pass the id they already have.
 *
 * Still fire-and-forget and still swallows errors: a failed notification must
 * never block a draft pick.
 */
export async function notifyDraftTurn(
  userId: string,
  leagueId: string
): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('send-notification', {
      body: { type: 'draft_turn', league_id: leagueId, target_user_id: userId },
    });
    if (error) {
      console.error('notifyDraftTurn failed:', error.message ?? error);
      return;
    }
    // `sent: false` is a normal outcome (no device, notifications off, bot target),
    // not a failure — log it so a silent non-delivery is still visible.
    if (data && data.sent === false) {
      console.log('Draft-turn notification not delivered:', data.reason);
    }
  } catch (error) {
    console.error('Error sending draft turn notification:', error);
  }
}
