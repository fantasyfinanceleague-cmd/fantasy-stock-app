import { useReducedMotionConfig } from 'motion/react';
import { motion as motionTokens } from './tokens';

// DESIGN_DIRECTION.md §5 (binding): "one useMotion() hook returns the token
// set already reduced" when reduced motion is requested.
//
// Deliberately `useReducedMotionConfig()`, NOT the plain `useReducedMotion()`:
// the plain hook only ever reads the OS's prefers-reduced-motion media query
// (once, at mount — it doesn't even react to a later system-level change),
// and ignores the ambient `<MotionConfig reducedMotion="always">` override
// entirely. `useReducedMotionConfig()` composes both — 'never'/'always' from
// context short-circuits the OS preference, otherwise it falls through to
// it — which is what actually lets the gallery's toggle force reduced
// motion for its screenshot/recording proof without the tester's OS needing
// to be in that state.
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
  const reduced = useReducedMotionConfig() ?? false;
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
