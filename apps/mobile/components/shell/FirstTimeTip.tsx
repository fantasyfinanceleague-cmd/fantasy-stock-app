/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { dismissTip, useTipVisible } from '@/lib/shell/firstTimeTip';
import { TIPS, type TipId } from '@/lib/shell/firstTimeTipPolicy';

// Onboarding W4 — a first-time tip (board #1.3 frame 3, "the week-window tip, once, dismissable"):
// a rimmed card with the drawn info icon in the accent, one line, and a 44pt × that hides it for
// good on this device. One line, never a tour (the research and the plan both say so).

export function FirstTimeTip({ tip }: { tip: TipId }) {
  const visible = useTipVisible(tip);
  if (!visible) return null;
  return (
    <Card style={styles.card}>
      <Icon name="info" size="body" tone="accent" />
      <Text variant="body" style={styles.text}>
        {TIPS[tip].text}
      </Text>
      <Pressable onPress={() => dismissTip(tip)} accessibilityRole="button" accessibilityLabel="Dismiss" style={styles.dismiss}>
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
