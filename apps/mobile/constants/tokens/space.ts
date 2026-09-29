// Stockpile — "Game Day" space tokens (Phase 2 foundation).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §9.
// Screen gutter 20 (space.5), card padding 16 (space.4), section gap 32 (space.8).

export const space = {
  1: 2,
  2: 4,
  3: 8,
  4: 12,
  5: 16,
  6: 20,
  7: 24,
  8: 32,
  9: 40,
  10: 48,
  11: 64,
} as const;

export type SpaceToken = keyof typeof space;
