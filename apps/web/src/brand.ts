// Swappable brand token (DESIGN_DIRECTION.md "Decisions — 2026-09-26", name
// caveat): "Stockpile" collides with an existing investing app of the same
// name (stockpile.com, a ™ since 2010). Giorgio is deciding the name
// separately; until then, `brand.name` / `brand.wordmark` are the ONE place
// the name is spelled in new code. Nothing else under src/design hard-codes
// the string "Stockpile" — enforced by design/lib/brand.test.ts, which greps
// src/design/** for the literal and expects zero matches.
//
// Plain data only (no JSX) so this file can be imported from any context,
// including a future non-React one, without a JSX pragma. The mark
// component (`brand.mark`) lives in design/BrandMark.tsx and is combined
// with this file's exports into the full `brand` token in design/index.ts.
export const brand = {
  name: 'Stockpile',
  wordmark: 'Stockpile',
};
