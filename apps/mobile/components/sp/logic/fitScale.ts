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

// Alignment-aware anchoring (2026-10-07, a RollingMoney follow-up): a
// RIGHT-aligned value (e.g. the far side of an opposing pair) needs to
// shrink toward ITS OWN edge, not the left one -- a left-anchored
// transformOrigin on a right-aligned row shrinks it away from where it's
// supposed to sit, reading as drifting toward the middle. `alignSelfFor`
// positions the (possibly narrower-than-container) row within its
// container; `transformOriginFor` anchors the scale to the same edge, so
// the two always agree.
export type RollingMoneyAlign = 'left' | 'right' | 'center';

export function alignSelfFor(align: RollingMoneyAlign): 'flex-start' | 'flex-end' | 'center' {
  if (align === 'right') return 'flex-end';
  if (align === 'center') return 'center';
  return 'flex-start';
}

export function transformOriginFor(align: RollingMoneyAlign): string {
  if (align === 'right') return 'right center';
  if (align === 'center') return 'center center';
  return 'left center';
}
