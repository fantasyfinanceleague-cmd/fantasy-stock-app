/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode, useRef } from 'react';
import { useFixtureScrollEnd } from '@/lib/shell/fixtureRoute';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space } from '@/constants/tokens';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ScreenTitle } from '@/components/shell/ScreenTitle';

// 3c-2 — the frame Create league and League settings share (board: "Create
// league · Season" / "· Draft step"): a back row with the "Step N of 4"
// caption on the right, the 4-segment progress bar, the step title and its
// subtitle, a scrolling body, and a footer that rides above the keyboard.
// Modeled on 3b-1's AuthScaffold rather than extending it, so the shell's
// shared frame stays untouched.

/** The standout stays loudest (W4 Onboarding gate, Design Lead 2026-10-14): the step title is
 * `display` (32pt, its own 1.6× = 51.2pt). Uncapped, the subtitle (body 15pt) reached the title's
 * cap height at XXXL and ran four lines, pushing the card below the fold; the "Back · Step N of 4"
 * row grew past the subtitle. Capped: subtitle 2× (30pt), the top row 1.6× (20.8pt / 19.2pt). */
export const SUBTITLE_MAX_SCALE = 2;
export const TOP_ROW_MAX_SCALE = 1.6;

export interface SetupScaffoldProps {
  /** Omitted on a screen with nowhere to go back to (Create league's done screen). */
  /** `modal`: an iOS modal's text-only "Cancel", no back chevron (G-7; League settings). */
  back?: { label: string; onPress: () => void; modal?: boolean };
  /** Shows "Step N of M" and the progress bar (Create league only). */
  step?: { number: number; total: number };
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Docked under the body; lifted above the keyboard when it opens. */
  footer?: ReactNode;
}

export function SetupScaffold({ back, step, title, subtitle, children, footer }: SetupScaffoldProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  // DEV captures only (lib/shell/fixtureRoute.ts).
  useFixtureScrollEnd(scrollRef);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.fill, { backgroundColor: colors.bg }]}>
      <View style={{ height: insets.top }} />
      <View style={styles.topRow}>
        {back ? (
          <Pressable onPress={back.onPress} accessibilityRole="button" accessibilityLabel={back.label} style={[styles.back, back.modal ? styles.backModal : null]} hitSlop={8}>
            {back.modal ? null : <Icon name="chevronLeft" size="callout" tone="text2" />}
            <Text variant="callout" tone="secondary" maxFontSizeMultiplier={TOP_ROW_MAX_SCALE}>
              {back.label}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.back} />
        )}
        {step ? (
          <Text variant="caption" tone="secondary" maxFontSizeMultiplier={TOP_ROW_MAX_SCALE} style={styles.tabular}>
            {`Step ${step.number} of ${step.total}`}
          </Text>
        ) : null}
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.fill}
        contentContainerStyle={[styles.body, { paddingBottom: footer ? space[5] : insets.bottom + space[8] }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.heading}>
          {step ? (
            // Decorative: the caption above already says which step this is.
            <View style={styles.progress} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {Array.from({ length: step.total }, (_, i) => (
                <View key={i} style={[styles.segment, { backgroundColor: i < step.number ? colors.accent : colors.border }]} />
              ))}
            </View>
          ) : null}
          <ScreenTitle>{title}</ScreenTitle>
          {subtitle ? (
            <Text variant="body" tone="secondary" maxFontSizeMultiplier={SUBTITLE_MAX_SCALE}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space[5]) }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: space[6],
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: 44,
    paddingHorizontal: space[5],
  },
  // A text-only Cancel sits on the content gutter (the chevron's glyph inset no longer offsets it).
  backModal: {
    paddingHorizontal: space[6],
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  body: {
    paddingHorizontal: space[6],
    paddingTop: space[3],
    gap: space[5],
  },
  heading: {
    gap: space[2],
  },
  progress: {
    flexDirection: 'row',
    gap: space[2],
    marginBottom: space[4],
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  footer: {
    paddingHorizontal: space[6],
    paddingTop: space[3],
  },
});
