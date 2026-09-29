// Stockpile — useMotion() (Phase 2 foundation).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §5 (Reduced motion table).
//
// Every animation in components/sp/** goes through this hook — no inline
// durations, no reading constants/tokens/motion.ts directly from a
// component. That's the mechanism that makes §5's reductions automatic
// instead of something each component has to remember to implement.

import { useReducedMotion, ReduceMotion, Easing, withTiming, withSpring } from 'react-native-reanimated';
import type { WithTimingConfig, WithSpringConfig, EasingFunctionFactory } from 'react-native-reanimated';
import { motion } from '@/constants/tokens';

export interface MotionConfig {
  reduced: boolean;
  duration: typeof motion.duration;
  /** Reanimated Easing curves built from the §4 cubic-bezier tokens. */
  easing: {
    settle: EasingFunctionFactory;
    exit: EasingFunctionFactory;
  };
  spring: {
    snappy: WithSpringConfig;
  };
  /**
   * Standard "enter/settle" timing config for translate/scale/opacity moves.
   * Full motion: `duration.slow` + `easing.settle`. Reduced motion (§5):
   * translate/scale/wipe collapse to an opacity crossfade at `duration.quick`
   * — callers still apply this to an opacity value; it's on them to skip
   * animating transform/translate when `reduced` is true.
   */
  enterTiming: WithTimingConfig;
  /** Wraps `withTiming`/`withSpring` with `ReduceMotion.System` so a config
   * respects the OS-level toggle even for values this hook doesn't cover. */
  withTiming: typeof withTiming;
  withSpring: typeof withSpring;
}

/**
 * Returns the token set already reduced when the user has Reduce Motion on
 * (via `useReducedMotion()`, which reads `AccessibilityInfo` + `ReduceMotion.System`).
 * Screen/route enter, digit roll, tug overshoot, stagger, chart draw and the
 * celebration beat all read `reduced` from this hook rather than checking
 * `useReducedMotion()` themselves, so the §5 table lives in one place.
 */
export function useMotion(): MotionConfig {
  const reduced = useReducedMotion();

  const settle = Easing.bezier(...motion.ease.settle);
  const exit = Easing.bezier(...motion.ease.exit);

  return {
    reduced,
    duration: motion.duration,
    easing: { settle, exit },
    spring: { snappy: { ...motion.spring.snappy, reduceMotion: ReduceMotion.System } },
    enterTiming: reduced
      ? { duration: motion.duration.quick, easing: Easing.linear, reduceMotion: ReduceMotion.System }
      : { duration: motion.duration.slow, easing: settle, reduceMotion: ReduceMotion.System },
    withTiming,
    withSpring,
  };
}
