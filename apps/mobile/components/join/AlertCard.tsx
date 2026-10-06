/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius, space, type } from '@/constants/tokens';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';

// 3f — the board's `Alert` card (key-screens.html, the Join / Draft-refused
// frames): a warn-tint card carrying ONE sentence, announced to VoiceOver the
// moment it appears. The icon is decorative; the sentence carries the meaning.
export function AlertCard({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[styles.card, { backgroundColor: colors.warnTint, borderColor: colors.warnLine }]}
    >
      <View style={styles.icon}>
        <Icon name="alert" size="callout" tone="text" />
      </View>
      <Text variant="callout" style={styles.text}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: space[3],
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: space[4],
    paddingHorizontal: space[4],
  },
  icon: {
    paddingTop: 1,
  },
  text: {
    flex: 1,
    fontFamily: type.headline.fontFamily,
  },
});
