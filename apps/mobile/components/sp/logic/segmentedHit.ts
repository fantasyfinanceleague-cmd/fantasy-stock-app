// Stockpile — the segmented control's hit area (DESIGN_DIRECTION §9B, "Hit
// areas"): every segment reaches 44 pt through a vertical hitSlop of
// (44 - visualHeight) / 2, so the visual height stays. Pure, for tests-deno.

export const MIN_HIT_PT = 44;

/** Vertical hitSlop that brings a segment of `visualHeight` up to 44 pt. Zero
 * until the height is measured (never a guessed slop), and zero for a segment
 * already 44 pt or taller. */
export function segmentHitSlop(visualHeight: number): { top: number; bottom: number } {
  if (!(visualHeight > 0)) return { top: 0, bottom: 0 };
  const each = Math.max(0, (MIN_HIT_PT - visualHeight) / 2);
  return { top: each, bottom: each };
}
