// Stockpile — type tokens. §9 originally; the score type and the new
// `hero` / `money` / `ticker` variants are §9C ("Game Night", 2026-10-12).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §9C (display / title /
// headline / body / callout / caption unchanged from §9).
//
// §9C: "Game numbers heavy, money numbers regular" (rule 5) — scores and the
// team value at ExtraBold (800), the Portfolio value at Medium (500). The
// condensed Black cut (62/900) LEAVES the app's numbers; it stays bundled only
// for the landing's hero. No new font files.
//
// React Native can't drive Archivo's variable width axis, so we bundle
// static instances cut from the variable TTF (see
// assets/fonts/archivo/README.md) and reference them by fontFamily here.
// Every variant that carries money or scores sets fontVariant tabular-nums —
// the static instances were verified to keep the `tnum` GSUB feature.

export type TypeVariant =
  | 'hero'
  | 'money'
  | 'ticker'
  | 'score.xl'
  | 'score.lg'
  | 'score.md'
  | 'tag'
  | 'display'
  | 'title'
  | 'headline'
  | 'body'
  | 'callout'
  | 'caption';

export interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: 'uppercase';
  /** tabular-nums for anything that renders digits that must not jitter. */
  tabularNums?: boolean;
  /**
   * Dynamic Type ceiling (RN's `maxFontSizeMultiplier`) — undefined means
   * uncapped. Design Lead, 2026-09-29: without per-variant caps, a style
   * that scales less (or not at all, like `display`, which callers often
   * render at a fixed size) can end up SMALLER on screen than one that
   * scales more, inverting the type ramp at accessibility sizes even though
   * their base sizes are correctly ordered. score/display/title/headline
   * caps are chosen so `display ≥ title ≥ headline` holds at every fontScale,
   * and `score.xl ≥ display` at the base size (§9C: `score.md` is a row size
   * now, so it leaves the ramp) — see `effectiveFontSize` and its test in
   * tests-deno/sp-type.test.ts.
   */
  maxScale?: number;
}

// Font family keys — must match the keys passed to useFonts() in
// app/_layout.tsx, not any name baked into the TTF's own name table.
const FONT = {
  condensedBlack: 'Archivo-Condensed-Black', // wdth 62,  wght 900 — landing hero only since §9C
  expandedExtraBold: 'Archivo-Expanded-ExtraBold', // wdth 125, wght 800
  regular: 'Archivo-Regular', // wdth 100, wght 400
  medium: 'Archivo-Medium', // wdth 100, wght 500
  semiBold: 'Archivo-SemiBold', // wdth 100, wght 600
  bold: 'Archivo-Bold', // wdth 100, wght 700
  extraBold: 'Archivo-ExtraBold', // wdth 100, wght 800
} as const;

export const type: Record<TypeVariant, TypeStyle> = {
  // §9C: the one standout (Home's team value). 46/48, −0.015em.
  hero: { fontFamily: FONT.extraBold, fontSize: 46, lineHeight: 48, letterSpacing: -0.69, tabularNums: true, maxScale: 1.2 },
  // §9C: the Portfolio value, regular weight (rule 5, Robinhood). 44/46, −0.015em.
  money: { fontFamily: FONT.medium, fontSize: 44, lineHeight: 46, letterSpacing: -0.66, tabularNums: true, maxScale: 1.2 },
  // §9C: tickers on rows (16/20, +0.01em); the player card sets 26/28 itself.
  ticker: { fontFamily: FONT.extraBold, fontSize: 16, lineHeight: 20, letterSpacing: 0.16 },
  'score.xl': { fontFamily: FONT.extraBold, fontSize: 32, lineHeight: 36, tabularNums: true, maxScale: 1.2 },
  'score.lg': { fontFamily: FONT.extraBold, fontSize: 28, lineHeight: 30, tabularNums: true, maxScale: 1.2 },
  // A row size now (roster week gain); standings' season gain sets 15/20 itself.
  'score.md': { fontFamily: FONT.extraBold, fontSize: 17, lineHeight: 22, tabularNums: true, maxScale: 1.3 },
  // The only uppercase in the app, and game surfaces only (§9). §9C: +0.06em.
  tag: {
    fontFamily: FONT.expandedExtraBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.66, // 0.06em @ 11px
    textTransform: 'uppercase',
    maxScale: 1.4,
  },
  display: { fontFamily: FONT.extraBold, fontSize: 32, lineHeight: 36, letterSpacing: -0.5, tabularNums: true, maxScale: 1.6 },
  title: { fontFamily: FONT.bold, fontSize: 22, lineHeight: 28, maxScale: 1.6 },
  headline: { fontFamily: FONT.semiBold, fontSize: 17, lineHeight: 22, maxScale: 1.6 },
  body: { fontFamily: FONT.regular, fontSize: 15, lineHeight: 22 },
  callout: { fontFamily: FONT.medium, fontSize: 13, lineHeight: 18 },
  // The smallest informational size (§9) — never drop below this for text
  // that conveys information (CLAUDE.md / DESIGN_DIRECTION §2 non-negotiable).
  caption: { fontFamily: FONT.medium, fontSize: 12, lineHeight: 16 },
};

export const typeFontFamily = FONT;

/**
 * The effective on-screen font size after RN applies Dynamic Type and this
 * variant's `maxScale` ceiling — pure math mirroring what
 * `maxFontSizeMultiplier` does natively, so the type-ramp ordering invariant
 * (display ≥ title ≥ headline at every fontScale; score.xl ≥ display at
 * the base size) is testable
 * without rendering an actual RN tree. Not used at render time itself; the
 * real cap is enforced by passing `maxScale` as `maxFontSizeMultiplier`.
 */
export function effectiveFontSize(variant: TypeVariant, fontScale: number): number {
  const style = type[variant];
  const cappedScale = style.maxScale !== undefined ? Math.min(fontScale, style.maxScale) : fontScale;
  return style.fontSize * cappedScale;
}
