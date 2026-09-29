// Stockpile — "Game Day" radius tokens (Phase 2 foundation).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §9.
// Scoreboard bands on mobile run edge to edge — use `radius.none` (0) there,
// never a card radius, so the stadium surface reads as a band, not a card.

export const radius = {
  none: 0,
  sm: 6, // chips
  md: 10, // inputs, buttons
  lg: 14, // cards
  xl: 20, // sheets
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radius;
