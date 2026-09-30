import { Pressable, PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { useMotion } from '@/components/sp/motion';

// Stockpile — <PressableScale> (Phase 2 foundation). SOURCE OF TRUTH: §4.
// "Card / row press: Scale 0.98 + haptic (instant, spring.snappy)".
//
// Reduce Motion (amended Phase 3b-1, per the 3b-1 spec's "Pressables" row:
// "no scale; haptic kept"): the scale is skipped entirely when useMotion()
// reports reduced motion; the light haptic still fires, since it's
// feedback, not motion.

const PRESSED_SCALE = 0.98;
const RESTING_SCALE = 1;

export interface PressableScaleProps extends PressableProps {
  /** Set false to skip the haptic (e.g. a press that already triggers one downstream). */
  haptic?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({ haptic = true, style, onPressIn, onPressOut, children, ...rest }: PressableScaleProps) {
  const scale = useSharedValue(RESTING_SCALE);
  const { reduced, spring, withSpring } = useMotion();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      style={[animatedStyle, style as object]}
      onPressIn={(event) => {
        if (!reduced) scale.value = withSpring(PRESSED_SCALE, spring.snappy);
        if (haptic) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (!reduced) scale.value = withSpring(RESTING_SCALE, spring.snappy);
        onPressOut?.(event);
      }}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
