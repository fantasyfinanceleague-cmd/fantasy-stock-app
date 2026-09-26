/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { color } from '@/constants/tokens';
import { useMotion } from '@/components/sp/motion';

// Stockpile — <LiveDot> (Phase 2 foundation). SOURCE OF TRUTH: §4 "What never
// animates": "Anything looping, except the live dot while the market is
// open." This is that one exception.
//
// Reduced motion isn't listed for this component specifically in §5's table,
// but a perpetual pulse is exactly the class of motion Reduce Motion exists
// to remove, so it renders as a static, full-opacity dot instead of looping
// when `reduced` is true — consistent with the rest of §5, not a literal
// table entry.

export interface LiveDotProps {
  size?: number;
}

export function LiveDot({ size = 8 }: LiveDotProps) {
  const { reduced } = useMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      cancelAnimation(opacity);
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(withSequence(withTiming(0.35, { duration: 700 }), withTiming(1, { duration: 700 })), -1, true);
    return () => cancelAnimation(opacity);
  }, [reduced, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityLabel="Live"
      style={[styles.dot, { width: size, height: size, borderRadius: size / 2 }, animatedStyle]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    backgroundColor: color.live,
  },
});
