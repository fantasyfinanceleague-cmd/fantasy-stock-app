/**
 * sheetScroll: when a sheet's scroll body should show its soft bottom edge. Pure, so the rule is
 * testable without a render. The fade (SheetBody) exists to soften the line that is cut mid-glyph
 * where content scrolls under the pinned footer; it shows ONLY while the content can still scroll
 * further down. At Large nothing overflows, so it never shows (Large stays pixel-identical).
 */

/** Sub-pixel layout rounding is not "more to scroll". */
export const SCROLL_SLACK = 1;

export interface ScrollMetrics {
  /** The scrolled content's height. */
  content: number;
  /** The scroll view's own (visible) height. */
  layout: number;
  /** How far it is scrolled from the top (negative while the top bounces). */
  offset: number;
}

/** True when the content overflows AND there is still more below the visible part. */
export function scrollsFurther({ content, layout, offset }: ScrollMetrics): boolean {
  if (![content, layout, offset].every(Number.isFinite) || layout <= 0) return false;
  // The part still below the visible area. A top bounce (negative offset) counts as 0, so a body
  // that fits (content <= layout) is never "more below", however it bounces.
  return content - layout - Math.max(offset, 0) > SCROLL_SLACK;
}
