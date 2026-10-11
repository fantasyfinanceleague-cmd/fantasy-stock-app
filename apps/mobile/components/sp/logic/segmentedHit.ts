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

/** One segment's width: the track's inner width (its 2 pt padding on each side is
 * inside the measured width) over the CURRENT option count. Derived on every render,
 * never stored from the last layout: the League tab's segments go from three to four
 * when a league with playoffs is chosen, the track keeps its width (no new layout
 * event), and a width stored at three segments put the indicator past the track's end
 * (capture pass, 2026-10-08). Zero until the track is measured or with no options. */
export function segmentWidthFor(trackWidth: number, trackPadding: number, count: number): number {
  if (!(trackWidth > 0) || !(count > 0)) return 0;
  return Math.max(0, (trackWidth - trackPadding * 2) / count);
}
