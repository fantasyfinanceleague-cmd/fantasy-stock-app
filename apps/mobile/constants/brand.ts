// Stockade — brand tokens (Phase 2 foundation).
//
// NAME DECIDED 2026-09-26 (Orchestrator, relaying Giorgio): "Stockpile"
// collided with an existing US investing app (stockpile.com, "stockpile™")
// and has been replaced with "Stockade". `brand.name` / `brand.wordmark`
// stay the ONE token for the product name — no new screen, component or
// copy string hard-codes it; import it from here instead. This is exactly
// why that rule existed: the rename touches one file, not a grep-and-replace
// across the app.

export const brand = {
  name: 'Stockade',
  wordmark: 'Stockade',
} as const;

export { BrandMark } from '@/components/sp/BrandMark';
export type { BrandMarkProps } from '@/components/sp/BrandMark';
