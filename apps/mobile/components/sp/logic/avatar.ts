// Stockpile — pure sizing logic for <Avatar>'s fallback initial (Phase 2
// foundation, DESIGN-CHANGES follow-up 2026-09-29). Dependency-free, same
// reasoning as ./money.ts and ./tug.ts.
//
// The initial is a glyph inside a fixed-diameter circle, not running text —
// if it scales with the circle's own `size` prop is ignored, it can outgrow
// (or look lost inside) circles far from the component's DEFAULT_SIZE. Sized
// proportionally instead, and (in Avatar.tsx) rendered with
// `allowFontScaling={false}` so Dynamic Type never grows it past the circle
// either — those are the two independent causes of the same clipping bug.

export const INITIAL_FONT_RATIO = 0.4;

export function initialFontSize(size: number): number {
  return Math.round(size * INITIAL_FONT_RATIO);
}
