/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius, space, type } from '@/constants/tokens';
import { CONFIRM_EMAIL_COPY } from '@/constants/confirmEmailCopy';
import { Icon } from '@/components/sp/Icon';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Text } from '@/components/sp/Text';
import { confirmedChipLabel } from '@/lib/shell/confirmedChip';

// Onboarding W4 — the chip above "Pick a username" when the confirmation link brings you back
// (board #1.3, frame 9 "The return: username"; the words are Giorgio's, approved 2026-10-14 via
// the Planner: CONFIRM_EMAIL_COPY.confirmedChip, "✓ EMAIL CONFIRMED"). The check is DRAWN (sp/Icon,
// §9B: no glyphs for icons), so the label is the constant minus its leading ✓; the spoken label is
// the same words in sentence case. `gain` on its own tint, which is a pair on the page
// (contrastPairs.ts: gain / gainTint over bg, 4.5:1 in both themes).

export function EmailConfirmedChip() {
  const { colors } = useTheme();
  const label = confirmedChipLabel(CONFIRM_EMAIL_COPY.confirmedChip);
  return (
    <View
      accessible
      accessibilityLabel={label.spoken}
      style={[styles.chip, { backgroundColor: colors.gainTint }]}
    >
      <Icon name="check" size="caption" tone="gain" />
      <Text variant="tag" color={colors.gain} maxFontSizeMultiplier={1.3} style={styles.text}>
        {label.shown}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1] + 2,
    paddingHorizontal: space[3],
    paddingVertical: space[1] + 1,
    borderRadius: radius.pill,
  },
  text: {
    fontFamily: type.tag.fontFamily,
  },
});
