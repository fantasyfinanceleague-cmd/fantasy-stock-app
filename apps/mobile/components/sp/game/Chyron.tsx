/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, Text as RNText } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { radius, space, type } from '@/constants/tokens';
import { useMotion } from '@/components/sp/motion';
import { useTheme } from '@/components/sp/ThemeProvider';

// Stockpile — <Chyron> (Phase 2 foundation). SOURCE OF TRUTH: the Phase 2
// brief: "slides in, auto-dismisses, announced via
// AccessibilityInfo.announceForAccessibility." A broadcast-style callout
// ("NVDA just put you ahead") that appears over a live scoreboard.

export interface ChyronProps {
  /** null/undefined hides the chyron. Passing a NEW message re-triggers the
   * slide-in + announcement, even if the text happens to repeat. */
  message: string | null | undefined;
  onDismiss?: () => void;
  durationMs?: number;
}

const OFFSCREEN_X = 320;

export function Chyron({ message, onDismiss, durationMs = 3500 }: ChyronProps) {
  const { colors } = useTheme();
  const { reduced, duration, easing, withTiming } = useMotion();
  const translateX = useSharedValue(OFFSCREEN_X);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!message) return;

    AccessibilityInfo.announceForAccessibility(message);

    if (reduced) {
      // §5: translate/wipe -> opacity crossfade at `quick`.
      translateX.value = 0;
      opacity.value = withTiming(1, { duration: duration.quick });
    } else {
      translateX.value = withTiming(0, { duration: duration.slow, easing: easing.settle });
      opacity.value = withTiming(1, { duration: duration.base, easing: easing.settle });
    }

    const timer = setTimeout(() => {
      if (reduced) {
        opacity.value = withTiming(0, { duration: duration.quick }, (finished) => {
          if (finished && onDismiss) runOnJS(onDismiss)();
        });
      } else {
        translateX.value = withTiming(OFFSCREEN_X, { duration: duration.quick, easing: easing.exit });
        opacity.value = withTiming(0, { duration: duration.quick }, (finished) => {
          if (finished && onDismiss) runOnJS(onDismiss)();
        });
      }
    }, durationMs);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-runs only on `message` (a new chyron), not on every reduced/duration identity change from useMotion().
  }, [message]);

  // useAnimatedStyle runs unconditionally, ABOVE this early return —
  // react-hooks/rules-of-hooks (error-level in this repo) forbids a hook
  // after a conditional return, even one as simple as `!message`.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  if (!message) return null;

  return (
    <Animated.View style={[styles.container, { backgroundColor: colors.inverseBg }, animatedStyle]} accessibilityLiveRegion="polite">
      <RNText
        style={{
          fontFamily: type.headline.fontFamily,
          fontSize: type.headline.fontSize,
          lineHeight: type.headline.lineHeight,
          color: colors.inverseFg,
        }}
        numberOfLines={1}
      >
        {message}
      </RNText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.sm,
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    alignSelf: 'flex-start',
  },
});
