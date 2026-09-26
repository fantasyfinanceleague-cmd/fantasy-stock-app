import { Pressable, PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { useMotion } from '@/components/sp/motion';

// Stockpile — <PressableScale> (Phase 2 foundation). SOURCE OF TRUTH: §4.
// "Card / row press: Scale 0.98 + haptic (instant, spring.snappy)". Reduced
// motion doesn't remove the scale entirely (it's not a translate/wipe, and
// §5 doesn't list press feedback as a reduced case) — it flows through
// useMotion()'s spring, which already carries ReduceMotion.System, so a
// system-level "prefer cross-fade" setting is still respected by Reanimated.

const PRESSED_SCALE = 0.98;
const RESTING_SCALE = 1;

export interface PressableScaleProps extends PressableProps {
  /** Set false to skip the haptic (e.g. a press that already triggers one downstream). */
  haptic?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({ haptic = true, style, onPressIn, onPressOut, children, ...rest }: PressableScaleProps) {
  const scale = useSharedValue(RESTING_SCALE);
  const { spring, withSpring } = useMotion();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      style={[animatedStyle, style as object]}
      onPressIn={(event) => {
        scale.value = withSpring(PRESSED_SCALE, spring.snappy);
        if (haptic) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(RESTING_SCALE, spring.snappy);
        onPressOut?.(event);
      }}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
