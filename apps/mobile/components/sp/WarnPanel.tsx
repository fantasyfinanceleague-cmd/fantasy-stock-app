/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';

// Stockpile — <WarnPanel> (W4, Game Night): a refusal or a blocker on a money surface — the
// stock sheet's pre-review blocks and the review's refusals. `warnTint` with its `warnLine`
// edge, the text in `warnText` (§9C rule 4: every fill has its own ink), and NO icon (the
// Design Lead's ruling for refusals and blockers). Announced as an alert.
// Moved to sp/ in W4 Onboarding: the same panel carries Join's refusals and Create account's
// signups-paused line, so a refusal looks the same on every surface.

/** The panel's text cap; the links that sit with it (Sign in, Try again) take the same cap so they never outrank the message. */
export const WARN_TEXT_MAX_SCALE = 1.6;

export function WarnPanel({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.warn, { backgroundColor: colors.warnTint, borderColor: colors.warnLine }]}>
      <Text variant="callout" maxFontSizeMultiplier={WARN_TEXT_MAX_SCALE} color={colors.warnText} accessibilityRole="alert" style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  warn: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: space[4],
    paddingHorizontal: 14,
  },
  text: {
    fontWeight: '700',
  },
});
