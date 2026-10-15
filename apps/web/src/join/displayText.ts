/**
 * Text that comes from OUTSIDE (a league's name, an inviter's username, from the
 * preview calls) and is dropped into our own headline templates ("{inviter}
 * invited you to {league}"). React renders it as text, so it can't inject
 * markup; this closes the other holes (security review, 2026-10-14):
 *  - control and bidi-override characters, which can reorder or hide the words
 *    around them in a template we vouch for;
 *  - an unbounded length (a name that pushes the real sentence off the screen).
 * Whitespace is collapsed (a name is one line) and the result is capped by CODE
 * POINTS, never mid-character.
 */
export const MAX_DISPLAY_LENGTH = 60;

// C0/C1 controls, zero-width and bidi marks/overrides/isolates, the BOM.
const UNSAFE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

/** The string cleaned for display, or null when nothing is left. */
export function cleanDisplay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  if (collapsed === '') return null;
  return Array.from(collapsed).slice(0, MAX_DISPLAY_LENGTH).join('').trim() || null;
}
