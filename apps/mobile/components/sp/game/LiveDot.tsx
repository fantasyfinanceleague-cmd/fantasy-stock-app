/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useMotion } from '@/components/sp/motion';
import { useTheme } from '@/components/sp/ThemeProvider';

// Stockpile — <LiveDot> (Phase 2 foundation). SOURCE OF TRUTH: §4 "What never
// animates": "Anything looping, except the live dot while the market is
// open." This is that one exception.
//
// Reduced motion isn't listed for this component specifically in §5's table,
// but a perpetual pulse is exactly the class of motion Reduce Motion exists
// to remove, so it renders as a static, full-opacity dot instead of looping
// when `reduced` is true — consistent with the rest of §5, not a literal
// table entry.
//
// Amended 2026-09-29 (Design Lead, DESIGN-CHANGES): the pulse was animating
// the CORE dot's own opacity down to 0.35, which read as the dot dimming to
// a dull olive rather than pulsing — `color.live` at 35% opacity over the
// game-navy surface desaturates enough to look like a different colour
// entirely. Fixed by separating the two: the core dot stays solid
// `color.live` at all times, and a second, larger "halo" element behind it
// expands (scale 1 → 2.2) while fading out (opacity .5 → 0), then snaps back
// to restart — a classic live/recording-indicator pulse. Reduce Motion drops
// the halo entirely rather than freezing it mid-fade, leaving a plain static
// dot.

export interface LiveDotProps {
  size?: number;
}

const HALO_MAX_SCALE = 2.2;
const HALO_DURATION = 1400;

export function LiveDot({ size = 8 }: LiveDotProps) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  const haloScale = useSharedValue(1);
  const haloOpacity = useSharedValue(0.5);

  useEffect(() => {
    if (reduced) {
      cancelAnimation(haloScale);
      cancelAnimation(haloOpacity);
      return;
    }
    haloScale.value = withRepeat(withTiming(HALO_MAX_SCALE, { duration: HALO_DURATION }), -1, false);
    haloOpacity.value = withRepeat(withTiming(0, { duration: HALO_DURATION }), -1, false);
    return () => {
      cancelAnimation(haloScale);
      cancelAnimation(haloOpacity);
    };
  }, [reduced, haloScale, haloOpacity]);

  const haloAnimatedStyle = useAnimatedStyle(() => ({
    opacity: haloOpacity.value,
    transform: [{ scale: haloScale.value }],
  }));

  const dimension = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View accessibilityLabel="Live" style={styles.wrap}>
      {reduced ? null : <Animated.View style={[styles.halo, dimension, { backgroundColor: colors.live }, haloAnimatedStyle]} />}
      <View style={[styles.core, dimension, { backgroundColor: colors.live }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {},
  halo: {
    position: 'absolute',
  },
});
