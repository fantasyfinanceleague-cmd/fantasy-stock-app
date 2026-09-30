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

/**
 * Two initials (Design Lead ruling, Phase 3b-1): the first letter of the
 * first word + the first letter of the last word ("Roberto B." → "RB");
 * one letter for a single word; "?" when there's nothing usable. Usernames
 * split on _ . - as well as spaces ("roberto_b" → "RB", matching the board),
 * and an email uses its local part.
 */
export function avatarInitials(name: string): string {
  const local = name.includes('@') ? name.split('@')[0] : name;
  const words = local
    .split(/[\s_.\-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0).toUpperCase();
  if (words.length === 1) return first;
  return first + words[words.length - 1].charAt(0).toUpperCase();
}
