/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useSyncExternalStore } from 'react';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { CAPTURE } from '@/lib/shell/captureDev';
import {
  CONFIRM_FAILED_NOTICE,
  isConfirmFailedNotice,
  setConfirmFailedNotice,
  subscribeConfirmFailedNotice,
} from '@/lib/auth/confirmFailedNotice';

// Onboarding W4 — the line on Sign in after a confirmation link reached this phone but its code
// couldn't be exchanged here (lib/auth/confirmFailedNotice.ts; the Planner's ruling, plan Decisions
// row 16): "Your email is confirmed. Sign in with your password." It is information, not a refusal,
// so it is a plain rimmed Card with a drawn ✓ (not the warn panel). Shown once; the next sign-in
// attempt or the × clears it. The × is a 44pt target.

/** One sentence of information above the form: capped so it stays a card at XXXL (it wrapped to a column of words). */
const NOTICE_MAX_SCALE = 2;

export function ConfirmedEmailNotice() {
  const shown = useSyncExternalStore(subscribeConfirmFailedNotice, isConfirmFailedNotice);
  // DEV captures only (captureDev reads nothing in release): the knob RAISES the notice once, through the real store, so dismissing it works.
  useEffect(() => {
    if (CAPTURE.confirmed === 'notice') setConfirmFailedNotice(true);
  }, []);
  if (!shown) return null;
  return (
    <Card style={styles.card} accessibilityLiveRegion="polite">
      <Icon name="checkCircle" size="body" tone="gain" />
      <Text variant="body" maxFontSizeMultiplier={NOTICE_MAX_SCALE} style={styles.text}>
        {CONFIRM_FAILED_NOTICE}
      </Text>
      <Pressable
        onPress={() => setConfirmFailedNotice(false)}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.dismiss}
      >
        <View>
          <Icon name="close" size="body" tone="text2" />
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingLeft: space[4],
    paddingRight: space[1],
    paddingVertical: space[1],
  },
  text: {
    flex: 1,
    paddingVertical: space[3],
  },
  dismiss: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
