// Stockpile — when <RollingMoney> may draw its value one Text per character (the roll), and
// when it must draw ONE Text instead. Pure, for tests-deno.
//
// The bug (Design Lead, P2, 2026-10-16): at XL and XXXL, Portfolio's hero sub-lines read
// "+ $ 3 4 3 . 5 1 ·" — each character spread across the line, the lines far apart. Cause
// (docs/design/captures/portfolio-xxxl-digits/README.md): iOS laid a Text capped by
// `maxFontSizeMultiplier` out at the UNCAPPED size when an uncapped twin (same string, same
// face) had been measured first; Home draws every digit uncapped in the same face. The capped
// size is now applied explicitly where the cap is engaged (cappedType.ts). On top of that, the
// Design Lead's rule: the roll (one Text per character, the shape most exposed to twins — one
// glyph "3" matches every other "3") runs only where it is the ordinary case:
//  1. the variant's Dynamic Type cap is not engaged (fontScale <= cap);
//  2. and below LARGE_TEXT_SCALE, the app's existing large-text line (largeText.ts, xxxLarge
//     and every accessibility size), where layouts already restructure for one-line text.
//     A reader at those sizes loses nothing by the figure changing in place.
// Anything else (including a non-finite scale, as largeText.ts treats it) rolls as before.

import { isLargeText } from './largeText';

export function rollsDigits(fontScale: number, cap: number | undefined): boolean {
  if (isLargeText(fontScale)) return false;
  if (cap !== undefined && fontScale > cap) return false;
  return true;
}
