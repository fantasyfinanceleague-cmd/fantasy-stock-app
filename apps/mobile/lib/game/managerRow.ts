/**
 * One manager row everywhere (UX final sweep S-10; Giorgio, 2026-10-08: "just bold the
 * users name. dont need to put the (you), people know their name. just bold it." and
 * "blue tint as well"; board #call-manager-row, b4edc955). Your name bold on a light-blue
 * you-tint row; everyone else regular; no visible "(you)". VoiceOver still hears "you"
 * (bold isn't announced). Where bold already means something else (a bracket's winner,
 * the renewal list's "Running back"), the tint alone marks you. Pure, so Deno tests it.
 */

/** Your name's weight; everyone else keeps the type's own (Medium, 500). */
export const YOUR_NAME_WEIGHT = '700' as const;

export function yourNameStyle(isYou: boolean): { fontWeight: typeof YOUR_NAME_WEIGHT } | null {
  return isYou ? { fontWeight: YOUR_NAME_WEIGHT } : null;
}

/** Your row's tint. `bleed` widens it past the row's text by that many points on each
 * side (with matching padding, so the text doesn't move), so the tint isn't flush on it. */
export function yourRowTint(isYou: boolean, youTint: string, bleed = 8): Record<string, string | number> | null {
  if (!isYou) return null;
  return { backgroundColor: youTint, borderRadius: 8, marginHorizontal: -bleed, paddingHorizontal: bleed };
}

/** The accessibility label's "you" ("Roberto B., you"). */
export function youA11y(isYou: boolean): string {
  return isYou ? ', you' : '';
}
