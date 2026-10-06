// Stockpile — pure logic for <Icon> (DESIGN_DIRECTION §9B, "one drawn icon set").
// Dependency-free, so tests-deno can import it without RN. The semantic names
// are the ONLY names a screen may use; a raw Ionicons glyph name never leaks.

export type IconName =
  | 'chevronRight' | 'chevronLeft' | 'chevronDown' | 'chevronUp'
  | 'check' | 'circle' | 'info' | 'close' | 'search' | 'add' | 'share'
  | 'trophy' | 'lock' | 'mail';

export type IconRole = 'caption' | 'callout' | 'body' | 'headline' | 'title';

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
  share: 'share-outline',
  trophy: 'trophy',
  lock: 'lock-closed-outline',
  mail: 'mail-outline',
};

/** Icon size (pt) by the text role it sits with (the board's scale). */
export const ICON_SIZE: Record<IconRole, number> = {
  caption: 14,
  callout: 16,
  body: 18,
  headline: 20,
  title: 24,
};

/** The Dynamic Type ceiling per role, matching the paired text role's maxScale. */
export const ICON_MAX_SCALE: Record<IconRole, number> = {
  caption: 1.4,
  callout: 1.6,
  body: 1.6,
  headline: 1.6,
  title: 1.6,
};

/** The icon's point size at a given Dynamic Type scale: it scales, up to the role's ceiling. */
export function iconPointSize(role: IconRole, fontScale: number): number {
  const scale = Math.min(Math.max(fontScale, 1), ICON_MAX_SCALE[role]);
  return Math.round(ICON_SIZE[role] * scale * 10) / 10;
}

/** Accessibility for an icon: decorative (hidden from VoiceOver) unless it has a label. */
export function iconAccessibility(label: string | undefined): { accessible: boolean; hidden: boolean; label: string | undefined } {
  if (label === undefined || label.trim() === '') return { accessible: false, hidden: true, label: undefined };
  return { accessible: true, hidden: false, label };
}
