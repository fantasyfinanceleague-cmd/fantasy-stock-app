// Stockpile — brand tokens (Phase 2 foundation).
//
// NAME CAVEAT (docs/design/DESIGN_DIRECTION.md, "Decisions — 2026-09-26"):
// the name "Stockpile" collides with an existing US investing app
// (stockpile.com, "stockpile™") and is under review by Giorgio separately
// from the visual direction. `brand.name` / `brand.wordmark` are the ONE
// swappable token for the product name — no new screen, component or copy
// string may hard-code "Stockpile"; import it from here instead.

export const brand = {
  name: 'Stockpile',
  wordmark: 'Stockpile',
} as const;

export { BrandMark } from '@/components/sp/BrandMark';
export type { BrandMarkProps } from '@/components/sp/BrandMark';
