import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { AppState, Platform } from 'react-native';
import { supabase } from './supabase';
import { foregroundQuiet } from './foregroundQuiet';
import { foregroundPushPlan } from './game/yourTurnPush';
import { alertYourTurn } from './game/yourTurnAlert';
import { deletePushToken, upsertPushToken } from './pushTokenStore';

// Configure how notifications are displayed when app is in foreground
// Foreground banners stay quiet while the app already shows what they'd say
// (your pick clock in the draft room; 3e's trade review): lib/foregroundQuiet.ts.
// A "your turn" push buzzes + chimes once per turn, wherever you are in the open app,
// shared with the draft room; its banner plays no OS sound (lib/game/yourTurnPush.ts).
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const plan = foregroundPushPlan(notification.request.content.data, foregroundQuiet(), AppState.currentState === 'active');
    if (plan.alertKey) alertYourTurn(plan.alertKey);
    return plan.presentation;
  },
});

/**
 * Request notification permissions and get push token
 */
export async function registerForPushNotifications(prompt = true): Promise<string | null> {
  // Only works on physical devices
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permissions if not granted. Onboarding W4: only when asked to (prompt): the iOS prompt
  // comes from the notifications ask after a league exists (lib/shell/pushAsk.ts), never from
  // signing in, so a silent refresh registers a token only if permission was already given.
  if (existingStatus !== 'granted' && prompt) {
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

    console.log('Push token obtained:', !!tokenData.data); // presence only: the token is a bearer for this device's pushes
    return tokenData.data;
  } catch (error) {
    console.error('Failed to get push token:', error);
    return null;
  }
}

/**
 * Save the push token to the owner-scoped push_tokens table (F8: the only store; user_profiles.expo_push_token is dropped).
 * lib/pushTokenStore.ts checks the resolved { error } and logs its code.
 */
export async function savePushToken(userId: string, token: string): Promise<boolean> {
  return upsertPushToken(supabase, userId, token);
}

/**
 * Remove the push token when the user logs out. Best-effort: sign-out proceeds whatever happens here, but a failed delete is
 * logged (a token left behind is a live capability for a device the user just signed out of).
 */
export async function removePushToken(userId: string): Promise<void> {
  await deletePushToken(supabase, userId);
}

/**
 * Register and save push token for a user
 */
export async function setupPushNotifications(userId: string, prompt = true): Promise<void> {
  const token = await registerForPushNotifications(prompt);
  if (token) {
    await savePushToken(userId, token);
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

// notifyDraftTurn was REMOVED 2026-10-06. Its only caller (the legacy
// app/(tabs)/draft.tsx handleSubmit) pushed the next picker client-side after
// a pick on that one screen, so picks from the draft room and auto-picks pushed
// nobody. The turn push is now sent SERVER-side after every recorded pick
// (supabase/functions/_shared/draft-write.ts commitGatedPick); a client call
// as well would double-push.
