import { useRef, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';

import { PushPrePrompt } from '@/components/shell/PushPrePrompt';
import type { ButtonStatus } from '@/components/sp/Button';
import { setupPushNotifications } from '@/lib/notifications';
import { useSession } from '@/lib/SessionProvider';
import { pushAskDestination, writePushAskRecord } from '@/lib/shell/pushAsk';

// Onboarding W4 — the notifications ask, shown right after a league was joined or created
// (lib/shell/pushAsk.ts pushAskRouteFor decides whether it is due). "Continue" records the answer
// and raises the iOS permission prompt; "Not now" records a decline (never pre-prompted again).
// Either way the person lands where the ending was sending them (`next`, an allow-listed route),
// and nothing here can strand them: every failure just continues.
export default function NotificationsAskScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { user } = useSession();
  const to = pushAskDestination(next);
  const [status, setStatus] = useState<ButtonStatus>('idle');
  const busy = useRef(false);

  const finish = () => router.replace(to);

  async function onContinue() {
    if (busy.current) return;
    busy.current = true;
    setStatus('loading');
    await writePushAskRecord('continued');
    try {
      if (user?.id) await setupPushNotifications(user.id);
    } catch {
      // A failed registration is not the person's problem; they can still turn it on in Settings.
    }
    finish();
  }

  async function onNotNow() {
    if (busy.current) return;
    busy.current = true;
    await writePushAskRecord('declined');
    finish();
  }

  return (
    <>
      {/* Nothing to go back to: the league is already joined or created. */}
      <Stack.Screen options={{ gestureEnabled: false }} />
      <PushPrePrompt onContinue={onContinue} onNotNow={onNotNow} status={status} />
    </>
  );
}
