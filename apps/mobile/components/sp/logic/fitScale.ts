// Stockpile — pure fit-to-container scale math for <RollingMoney> (X-1 fix,
// 2026-10-07, Design Lead final check). RollingMoney draws one Text per
// digit (for the roll animation), so it can't use RN's own
// adjustsFontSizeToFit the way a single Text could -- this is the
// equivalent: shrink the whole digit row by one uniform scale so it always
// fits its container on one line, floored at 0.7 (the Design Lead's call;
// below that the digits read as illegible at these type sizes) rather than
// ever clipping.

export const FIT_MIN_SCALE = 0.7;
const MAX_SCALE = 1;

/**
 * The scale to apply to a row whose natural (unscaled) width is
 * `naturalWidth`, so it fits within `containerWidth` -- clamped to
 * [FIT_MIN_SCALE, 1]. Either dimension not yet measured (null, from a
 * layout pass that hasn't landed) means "don't shrink yet": render at 1
 * until both are in, rather than guess.
 */
export function fitScale(containerWidth: number | null, naturalWidth: number | null): number {
  if (containerWidth == null || naturalWidth == null || naturalWidth <= 0) return MAX_SCALE;
  const raw = containerWidth / naturalWidth;
  return Math.min(MAX_SCALE, Math.max(FIT_MIN_SCALE, raw));
}
