/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import type { TrailingIcon } from '@/lib/shell/usernameMachine';

// Phase 3b-1 — S6, the username field's trailing state.
//
//   checking  → three dots pulsing in turn (a progress indicator, only while
//               a check is actually in flight — never a decorative loop)
//   available → a ✓ drawn by its stroke, in `gain`, with a spring.snappy pop
//   taken     → ✗ in `danger`, INSTANTLY: errors never animate (§4; Design
//               Lead ruling — no shake)
//
// Reduce Motion: every state swaps instantly (static dots, a whole ✓).
// VoiceOver hears each state through the live region.

const SIZE = 22;
const CHECK_PATH = 'M5 12.5 10 17 19 7';
const CHECK_LENGTH = 22; // ≈ the polyline's length in the 24-unit viewBox

const AnimatedPath = Animated.createAnimatedComponent(Path);

const SPOKEN: Record<TrailingIcon, string> = {
  none: '',
  checking: 'Checking availability',
  available: 'Available',
  taken: 'Not available',
};

export function UsernameStatusIcon({ state }: { state: TrailingIcon }) {
  return (
    <View style={styles.slot} accessibilityLiveRegion="polite" accessibilityLabel={SPOKEN[state] || undefined} accessible={state !== 'none'}>
      {state === 'checking' ? <CheckingDots /> : null}
      {state === 'available' ? <DrawnCheck /> : null}
      {state === 'taken' ? <TakenMark /> : null}
    </View>
  );
}

function CheckingDots() {
  const { colors } = useTheme();
  const { reduced, duration } = useMotion();
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} index={i} color={colors.text2} reduced={reduced} period={duration.base} />
      ))}
    </View>
  );
}

function Dot({ index, color, reduced, period }: { index: number; color: string; reduced: boolean; period: number }) {
  const opacity = useSharedValue(reduced ? 0.6 : 0.25);
  useEffect(() => {
    if (reduced) return;
    opacity.value = withDelay(
      index * (period / 3),
      withRepeat(withSequence(withTiming(1, { duration: period }), withTiming(0.25, { duration: period })), -1)
    );
    return () => cancelAnimation(opacity);
  }, [reduced, index, period, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

function DrawnCheck() {
  const { colors } = useTheme();
  const { reduced, duration, easing, spring, withSpring } = useMotion();
  const draw = useSharedValue(reduced ? 1 : 0);
  const scale = useSharedValue(reduced ? 1 : 0.6);
  useEffect(() => {
    if (reduced) return;
    draw.value = withTiming(1, { duration: duration.base, easing: easing.settle });
    scale.value = withSpring(1, spring.snappy);
    // Mount-only: one draw per arrival at "available".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pathProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - draw.value) }));
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={popStyle}>
      <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none">
        <AnimatedPath
          d={CHECK_PATH}
          stroke={colors.gain}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={CHECK_LENGTH}
          animatedProps={pathProps}
        />
      </Svg>
    </Animated.View>
  );
}

function TakenMark() {
  const { colors } = useTheme();
  return <Ionicons name="close" size={SIZE} color={colors.danger} />;
}

const styles = StyleSheet.create({
  slot: {
    width: SIZE + 4,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 3,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});
