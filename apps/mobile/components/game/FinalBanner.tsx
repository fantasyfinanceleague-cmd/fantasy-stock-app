/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Text } from '@/components/sp/Text';
import { useMotion } from '@/components/sp/motion';
import { space } from '@/constants/tokens';

export interface FinalBannerProps {
  /** The result line, e.g. "Roberto B. wins Week 6" or "Gianluigi B. wins Week 6". */
  text: string;
  /** Plays the rise (G3). False: the banner is simply there, no motion. */
  play: boolean;
}

/** The G3 winner banner: it rises over `slow` once on the reveal. Reduce Motion
 * shows the same banner in place with no motion. It never blocks input. */
export function FinalBanner({ text, play }: FinalBannerProps) {
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

  return (
    <Animated.View style={[styles.banner, style]} pointerEvents="none" accessibilityRole="text">
      <Text variant="callout" style={styles.text}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingVertical: space[3], paddingHorizontal: space[4], borderRadius: 12 },
  text: { fontWeight: '700' },
});
