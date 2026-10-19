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

/** A footer's gaps never compress below this (Design Lead, 2026-10-19). */
export const MIN_FOOTER_GAP = 8;

/** The sheet's ceiling, as a fraction of the screen: Sheet.tsx's `maxHeight: '90%'`. */
export const SHEET_MAX_HEIGHT_FRACTION = 0.9;

export interface FooterSpacingInput {
  /** The room the body, the footer and the bottom space share: the sheet's ceiling minus its handle row. */
  room: number;
  /** The scrolled content's full height (what the body would take if it never scrolled). */
  content: number;
  /** The footer items' heights, summed (they never shrink). */
  items: number;
  /** How many gaps sit between the footer's items. */
  gaps: number;
  /** One gap's natural height. */
  gap: number;
  /** The bottom space's natural height: the footer's bottom padding plus the sheet's own. */
  bottom: number;
  /** The least the bottom space yields to: the home-indicator inset. */
  floor: number;
}

/**
 * The spacing under a pinned footer (Design Lead, 2026-10-19). A sheet's own bottom padding and its footer's used to stack; they are ONE
 * bottom space, and a content-sized sheet keeps its natural spacing exactly. When the sheet would pass its 90% ceiling the layers yield in a
 * fixed order: the bottom space first, down to the home-indicator inset; then the footer's gaps, down to MIN_FOOTER_GAP; only then does the
 * body scroll (it takes the rest). Pure and explicit: flexbox only redistributes shrink twice, so a three-layer priority cannot be left to it.
 */
export function footerSpacing(i: FooterSpacingInput): { bottom: number; gap: number } {
  const gap0 = Number.isFinite(i.gap) && i.gap > 0 ? i.gap : 0;
  const bottom0 = Number.isFinite(i.bottom) && i.bottom > 0 ? i.bottom : 0;
  const natural = { bottom: bottom0, gap: gap0 };
  if (![i.room, i.content, i.items, i.gaps].every(Number.isFinite) || i.room <= 0) return natural;
  const floor = Math.min(bottom0, Number.isFinite(i.floor) && i.floor > 0 ? i.floor : 0);
  const minGap = Math.min(gap0, MIN_FOOTER_GAP);
  const deficit = i.content + i.items + Math.max(i.gaps, 0) * gap0 + bottom0 - i.room;
  if (deficit <= 0) return natural;
  const bottom = Math.max(floor, bottom0 - deficit);
  const rest = deficit - (bottom0 - bottom);
  const gap = i.gaps > 0 ? Math.max(minGap, gap0 - rest / i.gaps) : gap0;
  return { bottom, gap };
}
