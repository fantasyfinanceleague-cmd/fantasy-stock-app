// Stockpile — "Game Day" motion tokens (Phase 2 foundation).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §4 (table) and §9.
//
// `spring.lively` (the game-surface-only overshoot spring) is deliberately
// NOT exported here — DESIGN_DIRECTION §9: "`lively` is importable only from
// game components." It lives in components/sp/game/motion.ts. Importing it
// from this general file would make it reachable from money surfaces, which
// is exactly the mixing the token architecture exists to prevent.
//
// Nothing in components/sp/** reads these values directly — always go
// through components/sp/motion.ts's useMotion(), which already applies the
// reduced-motion substitutions from §5.

export const motion = {
  duration: {
    instant: 90,
    quick: 160,
    base: 240,
    slow: 380,
    feature: 700,
  },
  ease: {
    settle: [0.2, 0.7, 0.2, 1] as const,
    exit: [0.4, 0, 1, 1] as const,
  },
  spring: {
    snappy: { damping: 26, stiffness: 320, mass: 1 },
  },
} as const;

export type MotionDuration = keyof typeof motion.duration;
export type MotionEase = keyof typeof motion.ease;
