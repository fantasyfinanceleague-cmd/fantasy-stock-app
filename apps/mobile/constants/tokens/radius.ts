// Stockpile — radius tokens. §9 originally; §9C (Game Night, 2026-10-12) adds
// `tile` (the draft tile, 5) and `row` (12: Standings' manager tiles and the
// roster's lit slab inner corners). Card 14, sheet 20, chip/pill 999 and the
// key-figures strip (14 = `lg`) are unchanged.
// Scoreboard bands on mobile run edge to edge — use `radius.none` (0) there,
// never a card radius, so the stadium surface reads as a band, not a card.

export const radius = {
  none: 0,
  tile: 5, // draft tiles (§9C)
  sm: 6, // chips
  md: 10, // inputs, buttons
  row: 12, // manager tiles, the lit slab's inner corners (§9C)
  lg: 14, // cards, the key-figures strip
  xl: 20, // sheets
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radius;
