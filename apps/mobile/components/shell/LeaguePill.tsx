/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { radius, space } from '@/constants/tokens';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { useShellOverlay } from '@/components/shell/ShellOverlay';
import { moreLeaguesCount, pillAccessibilityLabel } from '@/lib/shell/leagueSheet';

// Phase 3b-1 — the league pill (spec row 10, Concept B): the active league's
// name, a "+N" more-leagues hint, and a chevron; opens the league sheet.
// On the focused screen it registers its label as S3's landing target. On
// each landing the "+N" badge gives one small pulse (quick) — the count
// itself only changes when the user joins or leaves a league.

const BUMP = 1.15;

export interface LeaguePillProps {
  name: string;
  totalLeagues: number;
}

export function LeaguePill({ name, totalLeagues }: LeaguePillProps) {
  const { colors } = useTheme();
  const { reduced, duration, easing } = useMotion();
  const { openLeagueSheet, registerPillLabel, pillLabelOpacity, landings } = useShellOverlay();
  const labelRef = useRef<View>(null);
  const more = moreLeaguesCount(totalLeagues);

  useFocusEffect(
    useCallback(() => {
      registerPillLabel(labelRef);
      return () => registerPillLabel(null);
    }, [registerPillLabel])
  );

  const badgeScale = useSharedValue(1);
  useEffect(() => {
    if (!landings || reduced) return;
    const half = { duration: duration.quick / 2, easing: easing.settle };
    badgeScale.value = withSequence(withTiming(BUMP, half), withTiming(1, half));
  }, [landings, reduced, duration.quick, easing.settle, badgeScale]);

  const labelStyle = useAnimatedStyle(() => ({ opacity: pillLabelOpacity.value }));
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badgeScale.value }] }));

  return (
    <PressableScale
      onPress={openLeagueSheet}
      accessibilityRole="button"
      accessibilityLabel={pillAccessibilityLabel(name, more)}
      accessibilityHint="Shows your leagues"
      hitSlop={{ top: 4, bottom: 4 }}
      style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Animated.View ref={labelRef} collapsable={false} style={[styles.label, labelStyle]}>
        <Text variant="headline" numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {name}
        </Text>
      </Animated.View>
      {more > 0 ? (
        <Animated.View style={[styles.badge, { backgroundColor: colors.accentTint }, badgeStyle]}>
          <Text variant="caption" color={colors.accent} maxFontSizeMultiplier={1.3} style={styles.badgeText}>
            {`+${more}`}
          </Text>
        </Animated.View>
      ) : null}
      <Ionicons name="chevron-down" size={14} color={colors.text2} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 36,
    maxWidth: 260,
    flexShrink: 1,
    paddingLeft: space[5],
    paddingRight: space[4],
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  label: {
    flexShrink: 1,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
  },
  badgeText: {
    fontVariant: ['tabular-nums'],
  },
});
