import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { motion as motionTokens } from './tokens';

// DESIGN_DIRECTION.md §5 (binding): "one useMotion() hook returns the token
// set already reduced" when reduced motion is requested.
//
// `reduced` = the OS preference OR an explicit <MotionConfig> override:
//   - useReducedMotion() reads prefers-reduced-motion via matchMedia.
//   - useReducedMotionConfig() reads the ambient <MotionConfig
//     reducedMotion>. On its own it is NOT enough: motion's DEFAULT context
//     is reducedMotion "never", under which it returns false whatever the
//     OS says, so any tree without a MotionConfig wrapper silently ignored
//     reduced-motion users (found in phase 3a: the landing kept pinning and
//     scrubbing under an emulated OS "reduce"; the gallery masked it because
//     it wraps itself). Fixed per the Design Lead, 2026-09-26.
// The OS preference therefore always wins toward reduced — nothing can
// force motion ON over the user's setting — while MotionConfig "always"
// (the gallery's toggle) can still force it on for proof screenshots.
// Wrap app roots in <MotionRoot> (reducedMotion="user") as well, so motion's
// own components also skip transform animations for those users.
//
// This hook supplies the shared numbers; several §5 rows (digit roll ->
// instant swap, tug overshoot -> no overshoot, stagger -> appear together)
// are behaviorally different enough per component that each one branches on
// `reduced` itself rather than this hook trying to encode every case.

function msToSeconds(msString: string): number {
  return parseFloat(msString) / 1000;
}

function parseCubicBezier(css: string): [number, number, number, number] {
  const match = /cubic-bezier\(([^)]+)\)/.exec(css);
  if (!match) throw new Error(`Not a cubic-bezier() string: ${css}`);
  const nums = match[1].split(',').map((n) => parseFloat(n.trim()));
  return nums as [number, number, number, number];
}

export const DURATION_SECONDS = {
  instant: msToSeconds(motionTokens.duration.instant),
  quick: msToSeconds(motionTokens.duration.quick),
  base: msToSeconds(motionTokens.duration.base),
  slow: msToSeconds(motionTokens.duration.slow),
  feature: msToSeconds(motionTokens.duration.feature),
};

export const EASE_ARRAYS = {
  settle: parseCubicBezier(motionTokens.ease.settle),
  exit: parseCubicBezier(motionTokens.ease.exit),
};

export interface UseMotionResult {
  /** True when the user (or the gallery's override) prefers reduced motion. */
  reduced: boolean;
  duration: typeof DURATION_SECONDS;
  ease: typeof EASE_ARRAYS;
  spring: typeof motionTokens.spring;
  /** DESIGN_DIRECTION §5's generic rule for route/card enter: translate +
   * rise in full motion, an opacity crossfade at `quick` when reduced. */
  enterTransition: { duration: number; ease: [number, number, number, number] };
}

export function useMotion(): UseMotionResult {
  const osReduced = useReducedMotion() ?? false;
  const configReduced = useReducedMotionConfig() ?? false;
  const reduced = osReduced || configReduced;
  return {
    reduced,
    duration: DURATION_SECONDS,
    ease: EASE_ARRAYS,
    spring: motionTokens.spring,
    enterTransition: reduced
      ? { duration: DURATION_SECONDS.quick, ease: EASE_ARRAYS.settle }
      : { duration: DURATION_SECONDS.base, ease: EASE_ARRAYS.settle },
  };
}
