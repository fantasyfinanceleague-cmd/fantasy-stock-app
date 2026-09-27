// Stockpile — brand tokens (Phase 2 foundation).
//
// NAME PLACEHOLDER (Orchestrator, 2026-09-26, relaying Giorgio): the product
// name went through several proposals (including "Stockade") and is now
// deferred to a final decision later — "Stockpile" is the placeholder in the
// meantime, matching the web app's own brand.ts on main. The exact value is
// irrelevant to this branch's work; what matters is that `brand.name` /
// `brand.wordmark` stay the ONE token for the product name — no new screen,
// component or copy string hard-codes it; import it from here instead. That
// is exactly why the token exists: the eventual rename touches one file, not
// a grep-and-replace across the app.

export const brand = {
  name: 'Stockpile',
  wordmark: 'Stockpile',
} as const;

export { BrandMark } from '@/components/sp/BrandMark';
export type { BrandMarkProps } from '@/components/sp/BrandMark';
