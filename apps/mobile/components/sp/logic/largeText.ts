// Stockpile — large text (DESIGN_DIRECTION §9: the type scales with the system text
// size). Side-by-side columns and one-line table rows can't hold text at the
// accessibility sizes: the capture pass (2026-10-08, XL = accessibility-extra-large)
// found names wrapping a letter per line, results clipped off the card, and the two
// Matchup lineups running into each other. From LARGE_TEXT_SCALE up (the largest
// standard size, xxxLarge ≈ 1.35, and every accessibility size) those layouts stack.
// Pure, for tests-deno; useLargeText (components/sp/useLargeText.ts) reads the scale.

export const LARGE_TEXT_SCALE = 1.3;

export function isLargeText(fontScale: number): boolean {
  return Number.isFinite(fontScale) && fontScale >= LARGE_TEXT_SCALE;
}

/** A fixed-size badge (the standings' medal disc) grows with the text it holds, up to
 * a cap, so its numeral never spills out of it. */
export function scaledBadge(base: number, fontScale: number, cap = 1.6): number {
  const s = Number.isFinite(fontScale) && fontScale > 1 ? Math.min(fontScale, cap) : 1;
  return Math.round(base * s);
}

/** The lineHeight to hand React Native so a CAPPED text's line box matches its glyphs. iOS
 * scales `lineHeight` by the full Dynamic Type factor even when `maxFontSizeMultiplier` caps
 * the font (found at the W4 gate: at XL the 13pt "Yours" pill rendered a ~42pt line box around
 * ~21pt text). Pre-dividing gives `lineHeight × min(fontScale, cap)` on screen. Uncapped text,
 * or text under its cap, keeps its lineHeight. */
export function cappedLineHeight(lineHeight: number, fontScale: number, cap: number | undefined): number {
  if (!cap || !(fontScale > cap)) return lineHeight;
  return (lineHeight * cap) / fontScale;
}
