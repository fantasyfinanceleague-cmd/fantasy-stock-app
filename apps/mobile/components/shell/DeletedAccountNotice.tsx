/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useSyncExternalStore } from 'react';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { ACCOUNT_DELETED } from '@/lib/account/deleteCopy';
import { isDeletedNotice, setDeletedNotice, subscribeDeletedNotice } from '@/lib/account/deletedNotice';
import { DELETED_NOTICE_FIXTURE } from '@/lib/shell/captureDev';

// Account deletion (W4) — "Your account is deleted." on Sign in, once (plan decision 11; board: an info mark, the
// line, a × dismiss). The same plain rimmed Card as ConfirmedEmailNotice: information, not a refusal. It is raised
// by the delete screen right before the local sign-out (lib/account/deletedNotice.ts) and cleared by the × or the
// next sign-in attempt (app/login.tsx). The × is a 44pt target.

/** One sentence of information above the form: capped so it stays a card at XXXL. */
const NOTICE_MAX_SCALE = 2;

export function DeletedAccountNotice() {
  const shown = useSyncExternalStore(subscribeDeletedNotice, isDeletedNotice);
  // DEV captures only (captureDev reads nothing in release): the knob RAISES the notice once, through the real store.
  useEffect(() => {
    if (DELETED_NOTICE_FIXTURE) setDeletedNotice(true);
  }, []);
  // Once means once: leaving Sign in (a sign-in that worked, or any other screen) spends the line.
  useEffect(() => () => setDeletedNotice(false), []);
  if (!shown) return null;
  return (
    <Card style={styles.card} accessibilityLiveRegion="polite">
      <Icon name="info" size="body" tone="text2" />
      <Text variant="body" maxFontSizeMultiplier={NOTICE_MAX_SCALE} style={styles.text}>
        {ACCOUNT_DELETED}
      </Text>
      <Pressable onPress={() => setDeletedNotice(false)} accessibilityRole="button" accessibilityLabel="Dismiss" style={styles.dismiss}>
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
