// Stockpile — "Game Day" type tokens (Phase 2 foundation).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §9.
//
// React Native can't drive Archivo's variable width axis, so we bundle
// static instances cut from the variable TTF (see
// assets/fonts/archivo/README.md) and reference them by fontFamily here.
// Every variant that carries money or scores sets fontVariant tabular-nums —
// the static instances were verified to keep the `tnum` GSUB feature.

export type TypeVariant =
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
   * caps are chosen so `score ≥ display ≥ title ≥ headline` holds at every
   * fontScale — see `effectiveFontSize` and its test in tests-deno/.
   */
  maxScale?: number;
}

// Font family keys — must match the keys passed to useFonts() in
// app/_layout.tsx, not any name baked into the TTF's own name table.
const FONT = {
  condensedBlack: 'Archivo-Condensed-Black', // wdth 62,  wght 900
  expandedExtraBold: 'Archivo-Expanded-ExtraBold', // wdth 125, wght 800
  regular: 'Archivo-Regular', // wdth 100, wght 400
  medium: 'Archivo-Medium', // wdth 100, wght 500
  semiBold: 'Archivo-SemiBold', // wdth 100, wght 600
  bold: 'Archivo-Bold', // wdth 100, wght 700
  extraBold: 'Archivo-ExtraBold', // wdth 100, wght 800
} as const;

export const type: Record<TypeVariant, TypeStyle> = {
  'score.xl': { fontFamily: FONT.condensedBlack, fontSize: 56, lineHeight: 52, tabularNums: true, maxScale: 1.2 },
  'score.lg': { fontFamily: FONT.condensedBlack, fontSize: 40, lineHeight: 38, tabularNums: true, maxScale: 1.2 },
  'score.md': { fontFamily: FONT.condensedBlack, fontSize: 28, lineHeight: 28, tabularNums: true, maxScale: 1.2 },
  // The only uppercase in the app, and game surfaces only (§9).
  tag: {
    fontFamily: FONT.expandedExtraBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.44, // 0.04em @ 11px
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
 * (score ≥ display ≥ title ≥ headline at every fontScale) is testable
 * without rendering an actual RN tree. Not used at render time itself; the
 * real cap is enforced by passing `maxScale` as `maxFontSizeMultiplier`.
 */
export function effectiveFontSize(variant: TypeVariant, fontScale: number): number {
  const style = type[variant];
  const cappedScale = style.maxScale !== undefined ? Math.min(fontScale, style.maxScale) : fontScale;
  return style.fontSize * cappedScale;
}
