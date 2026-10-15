/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space } from '@/constants/tokens';
import { Button, type ButtonStatus } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { PUSH_ASK_COPY } from '@/lib/shell/pushAskPolicy';

// Onboarding W4 — the notifications pre-prompt (board #1.3 frame 4; words approved by Giorgio,
// 2026-10-14: the line, "Continue", and "Not now" as a text link under it). Shown once, right after
// a league was joined or created (app/notifications-ask.tsx); "Continue" then raises the iOS
// permission prompt. "Not now" is final: the person is never pre-prompted again, and iOS Settings
// still reaches the setting. The bell sits on an `accentTint` disc (the accent is small, ≤ 5%).

export interface PushPrePromptProps {
  onContinue: () => void;
  onNotNow: () => void;
  status?: ButtonStatus;
}

export function PushPrePrompt({ onContinue, onNotNow, status = 'idle' }: PushPrePromptProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, space[5]) }]}>
      <View style={styles.body}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.disc, { backgroundColor: colors.accentTint }]}>
          <Icon name="bell" size="title" tone="accent" />
        </View>
        <Text variant="title" numberOfLines={0} accessibilityRole="header" style={styles.title}>
          {PUSH_ASK_COPY.title}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button label={PUSH_ASK_COPY.continue} status={status} onPress={onContinue} />
        <Pressable
          onPress={onNotNow}
          disabled={status !== 'idle'}
          accessibilityRole="button"
          style={styles.notNow}
        >
          <Text variant="body" tone="secondary" maxFontSizeMultiplier={1.6}>
            {PUSH_ASK_COPY.notNow}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: space[6],
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[5],
  },
  disc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
  actions: {
    gap: space[3],
  },
  notNow: {
    alignSelf: 'center',
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingHorizontal: space[4],
  },
});
