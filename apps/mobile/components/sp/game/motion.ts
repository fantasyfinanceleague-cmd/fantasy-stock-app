// Stockpile — game-surface-only motion (Phase 2 foundation).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §4 / §9.
//
// `spring.lively` (damping 14, stiffness 220, mass 1 — a slight overshoot)
// is scoped to THIS file on purpose: §9 says "`lively` is importable only
// from game components", so money-surface code can't reach for it by
// accident. General `components/sp/motion.ts` never exports it.

import { ReduceMotion } from 'react-native-reanimated';
import type { WithSpringConfig } from 'react-native-reanimated';
import { useMotion } from '@/components/sp/motion';

export const lively: WithSpringConfig = {
  damping: 14,
  stiffness: 220,
  mass: 1,
  reduceMotion: ReduceMotion.System,
};

/**
 * Returns the spring to use for a lead-change overshoot (TugBar) or score
 * slam (ScoreDigits). Reduced motion (§5): "Set to final value, no
 * overshoot" — so this returns `spring.snappy` (already zero-overshoot)
 * instead of `lively` when the user has Reduce Motion on.
 */
export function useLeadChangeSpring(): WithSpringConfig {
  const { reduced, spring } = useMotion();
  return reduced ? spring.snappy : lively;
}
