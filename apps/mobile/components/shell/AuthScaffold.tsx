/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { forwardRef, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';

// Phase 3b-1 — the frame every auth / first-run screen shares: the theme's
// `bg`, safe areas, a scrolling body, and an optional footer that rides
// above the keyboard (spec row 2: "the button stays above the keyboard").
// An optional back row matches the board's "‹ Back to sign in".

export interface AuthScaffoldProps {
  children: ReactNode;
  /** Docked under the body; lifted above the keyboard when it opens. */
  footer?: ReactNode;
  back?: { label: string; onPress: () => void };
}

export const AuthScaffold = forwardRef<ScrollView, AuthScaffoldProps>(function AuthScaffold({ children, footer, back }, ref) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.fill, { backgroundColor: colors.bg }]}
    >
      <View style={{ height: insets.top }} />
      {back ? (
        <Pressable onPress={back.onPress} accessibilityRole="button" accessibilityLabel={back.label} style={styles.back} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={colors.text2} />
          <Text variant="callout" tone="secondary">
            {back.label}
          </Text>
        </Pressable>
      ) : null}
      <ScrollView
        ref={ref}
        style={styles.fill}
        contentContainerStyle={[styles.body, { paddingBottom: footer ? space[5] : insets.bottom + space[8] }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space[5]) }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
});

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: space[5],
  },
  body: {
    paddingHorizontal: space[6],
    paddingTop: space[5],
    gap: space[6],
  },
  footer: {
    paddingHorizontal: space[6],
    paddingTop: space[3],
    gap: space[4],
  },
});
