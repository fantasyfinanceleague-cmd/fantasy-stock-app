// Stockpile — pure logic for <Icon> (DESIGN_DIRECTION §9B, "one drawn icon set").
// Dependency-free, so tests-deno can import it without RN. The semantic names
// are the ONLY names a screen may use; a raw Ionicons glyph name never leaks.

export type IconName =
  | 'chevronRight' | 'chevronLeft' | 'chevronDown' | 'chevronUp'
  | 'check' | 'circle' | 'info' | 'close' | 'search' | 'add' | 'remove' | 'share'
  | 'trophy' | 'lock' | 'mail' | 'alert' | 'star' | 'starFilled'
  | 'checkCircle' | 'pending'
  // The tab bar's four tabs: outline when idle, filled when selected (TabIcon).
  | 'tabHome' | 'tabHomeSelected' | 'tabMatchup' | 'tabMatchupSelected'
  | 'tabLeague' | 'tabLeagueSelected' | 'tabPortfolio' | 'tabPortfolioSelected';

/** The text roles an icon sits beside, plus the medallion (a 36 pt glyph in a
 * 72 pt disc, used only by the season-complete trophy and the Run it back card). */
export type IconRole = 'caption' | 'callout' | 'body' | 'headline' | 'title' | 'medallion' | 'tab';

/** The Ionicons glyph for each semantic name (outline by default). */
export const ICON_GLYPHS: Record<IconName, string> = {
  chevronRight: 'chevron-forward',
  chevronLeft: 'chevron-back',
  chevronDown: 'chevron-down',
  chevronUp: 'chevron-up',
  check: 'checkmark',
  circle: 'ellipse-outline',
  info: 'information-circle-outline',
  close: 'close',
  search: 'search',
  add: 'add',
  remove: 'remove',
  share: 'share-outline',
  trophy: 'trophy',
  lock: 'lock-closed-outline',
  mail: 'mail-outline',
  alert: 'alert-circle-outline',
  // The player card's Save (outline) and Saved (filled) — §9C, the W3 gate (2026-10-12).
  star: 'star-outline',
  starFilled: 'star',
  // A done state (reset-password's "Password updated") and a wait ("One moment"; gn-sweep).
  checkCircle: 'checkmark-circle-outline',
  pending: 'hourglass-outline',
  // The tab bar (Design Lead ruling 2026-09-29): home, the line chart, the trophy, the bars.
  // The filled glyph is the selected state only, the one exception to "outline by default".
  tabHome: 'home-outline',
  tabHomeSelected: 'home',
  tabMatchup: 'trending-up-outline',
  tabMatchupSelected: 'trending-up',
  tabLeague: 'trophy-outline',
  tabLeagueSelected: 'trophy',
  tabPortfolio: 'bar-chart-outline',
  tabPortfolioSelected: 'bar-chart',
};

/** Icon size (pt) by the text role it sits with (the board's scale). */
export const ICON_SIZE: Record<IconRole, number> = {
  caption: 14,
  callout: 16,
  body: 18,
  headline: 20,
  title: 24,
  // The medallion's glyph; its disc is MEDALLION_DISC_PT.
  medallion: 36,
  // The tab bar's glyph: 24, and it never scales (the tab bar keeps its height at every
  // text size, as iOS's does; its labels carry Dynamic Type within their own cap).
  tab: 24,
};

/** The medallion's disc (pt) at standard Dynamic Type. */
export const MEDALLION_DISC_PT = 72;

/** The medallion's Dynamic Type ceiling (the heading beneath it caps at 1.3×). */
export const MEDALLION_MAX_SCALE = 1.3;

/** The Dynamic Type ceiling per role, matching the paired text role's maxScale. */
export const ICON_MAX_SCALE: Record<IconRole, number> = {
  caption: 1.4,
  callout: 1.6,
  body: 1.6,
  headline: 1.6,
  title: 1.6,
  medallion: MEDALLION_MAX_SCALE,
  tab: 1,
};

/** The icon's point size at a given Dynamic Type scale: it scales, up to the role's ceiling. */
export function iconPointSize(role: IconRole, fontScale: number): number {
  const scale = Math.min(Math.max(fontScale, 1), ICON_MAX_SCALE[role]);
  if (role === 'medallion') return Math.round(ICON_SIZE.medallion * scale);
  return Math.round(ICON_SIZE[role] * scale * 10) / 10;
}

/** The medallion's disc at a given Dynamic Type scale, scaled with its glyph (the heading's factor, capped).
 * `basePt` is the disc at standard size (72 by default; Home's season-over card is 60). */
export function medallionDiscPt(fontScale: number, basePt: number = MEDALLION_DISC_PT): number {
  const scale = Math.min(Math.max(fontScale, 1), MEDALLION_MAX_SCALE);
  return Math.round(basePt * scale);
}

/** The medallion's glyph for a disc of `basePt`: half the disc, as the 36-in-72 default. */
export function medallionGlyphPt(fontScale: number, basePt: number = MEDALLION_DISC_PT): number {
  const scale = Math.min(Math.max(fontScale, 1), MEDALLION_MAX_SCALE);
  return Math.round(ICON_SIZE.medallion * (basePt / MEDALLION_DISC_PT) * scale);
}

/** Accessibility for an icon: decorative (hidden from VoiceOver) unless it has a label. */
export function iconAccessibility(label: string | undefined): { accessible: boolean; hidden: boolean; label: string | undefined } {
  if (label === undefined || label.trim() === '') return { accessible: false, hidden: true, label: undefined };
  return { accessible: true, hidden: false, label };
}
