/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { radius, space } from '@/constants/tokens';
import type { FinalBannerModel } from '@/lib/game/finalBanner';

export interface FinalBannerProps {
  /** The result line and record (lib/game/finalBanner.ts). */
  model: FinalBannerModel;
  /** Plays the rise (G3). False: the banner is simply there, no motion. */
  play: boolean;
}

/** The G3 winner band (board `.ks-winner`, GS-2): your colour with on-accent text when
 * you won, a neutral sunken fill when you lost or tied, the record on the right. It
 * rises over `slow` once on the reveal; Reduce Motion shows it in place. It never
 * blocks input. */
export function FinalBanner({ model, play }: FinalBannerProps) {
  const { colors } = useTheme();
  const { reduced, duration, easing } = useMotion();
  const progress = useSharedValue(play && !reduced ? 0 : 1);

  useEffect(() => {
    if (!play || reduced) return;
    progress.value = withTiming(1, { duration: duration.slow, easing: easing.settle });
    // Mount-only: the reveal plays once per matchup-week (see useRevealOnce).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }],
  }));

  const won = model.outcome === 'won';
  const fill = won ? colors.you : colors.sunken;
  const ink = won ? colors.onAccent : colors.text;

  return (
    <Animated.View
      style={[styles.banner, { backgroundColor: fill }, style]}
      pointerEvents="none"
      accessible
      accessibilityRole="text"
      accessibilityLabel={model.a11yLabel}
    >
      <Text variant="callout" color={ink} style={[styles.text, styles.result]}>{model.text}</Text>
      <Text variant="callout" color={ink} style={[styles.text, styles.record]}>{model.recordText}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The board's .ks-winner: 12/14 padding, radius md, one row with the record at the end.
  // It wraps at large text rather than clipping the result line.
  banner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space[3],
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  text: { fontWeight: '800' },
  result: { flexShrink: 1 },
  record: { fontVariant: ['tabular-nums'], marginLeft: 'auto' },
});
