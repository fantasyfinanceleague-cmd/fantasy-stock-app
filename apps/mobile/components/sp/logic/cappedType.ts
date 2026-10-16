// Stockpile — a Dynamic Type cap applied in JS instead of by `maxFontSizeMultiplier`. Pure,
// for tests-deno.
//
// Why (P2, 2026-10-16, Portfolio's hero sub-lines at XL/XXXL): on iOS, a Text capped with
// `maxFontSizeMultiplier` can be laid out at the UNCAPPED size while its glyphs draw capped —
// when another, uncapped Text with the same string in the same face was measured first. Home
// draws "+2.86%", "+$121.27", " · " and (one Text per digit) every single digit in the same 700
// callout, uncapped, so Portfolio's capped copies took Home's boxes: digits spread across the
// line, "·" floating, lines far apart. Isolation: docs/design/captures/portfolio-xxxl-digits/
// README.md. Taking Home's sub-line off that face fixed Portfolio's colliding strings; dropping
// the cap did too. The measurement result is reused across Texts whose cap differs.
//
// So where the cap is ENGAGED (the system scale is above it), the capped size is set
// explicitly — fontSize/lineHeight × cap, with font scaling off — which is the size iOS draws
// it at anyway, and a different measurement from any uncapped Text. Below the cap nothing
// changes: the Text scales natively, exactly as an uncapped one would.

export interface BaseFont {
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
}

export interface CappedFont {
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
}

/** The explicit font metrics for a `cap`ped text at `fontScale`, or null when the cap is not
 * engaged (no cap, a scale at or under it, or a non-finite scale): scale natively then. */
export function cappedFont(base: BaseFont, fontScale: number, cap: number | undefined): CappedFont | null {
  if (cap === undefined || !Number.isFinite(fontScale) || fontScale <= cap) return null;
  const out: CappedFont = { fontSize: base.fontSize * cap, lineHeight: base.lineHeight * cap };
  if (base.letterSpacing !== undefined) out.letterSpacing = base.letterSpacing * cap;
  return out;
}

/** Props for an RN/sp Text carrying `cap`: the explicit capped metrics with font scaling off
 * when the cap is engaged, else native scaling under `maxFontSizeMultiplier`. */
export function cappedTextProps(base: BaseFont, fontScale: number, cap: number | undefined): {
  style: CappedFont | null;
  allowFontScaling: boolean;
  maxFontSizeMultiplier: number | undefined;
} {
  const capped = cappedFont(base, fontScale, cap);
  return capped
    ? { style: capped, allowFontScaling: false, maxFontSizeMultiplier: undefined }
    : { style: null, allowFontScaling: true, maxFontSizeMultiplier: cap };
}
