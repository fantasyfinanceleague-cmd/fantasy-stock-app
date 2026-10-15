/**
 * Text that comes from OUTSIDE (a league's name, an inviter's name, from the
 * preview calls) and is dropped into our own headline templates ("{inviter}
 * invited you to {league}"). React renders it as text, so it can't inject
 * markup; this closes the other holes (security review, 2026-10-14):
 *  - control, format and bidi characters (all of Unicode's Cc and Cf, plus the
 *    invisible fillers and variation selectors), which can reorder or hide the
 *    words around them in a template we vouch for, or make a name look empty;
 *  - an unbounded length (a name that pushes the real sentence off the screen).
 * Whitespace is collapsed (a name is one line) and the result is capped by CODE
 * POINTS, never mid-character. Stripping format characters also splits joined
 * emoji (a ZWJ sequence becomes its parts): a fair price for a headline we vouch for.
 *
 * What it cannot do: plain words. A 40-character name that reads "Call this number"
 * is still text; the template's own words ("invited you to") are the frame.
 */
export const MAX_DISPLAY_LENGTH = 60;
/** An inviter's name is shorter: it sits at the start of the sentence (W3's review, 2026-10-14). */
export const MAX_INVITER_LENGTH = 40;

// Cc controls, Cf format (ZW*, bidi marks/overrides/isolates, soft hyphen, BOM, tags, the Arabic letter mark…),
// then what is invisible but is NOT Cc/Cf: the grapheme joiner, Hangul and braille blanks, variation selectors,
// the object-replacement character; plus the format block spelled out so a reserved gap in it can't slip by.
const UNSAFE = /[\p{Cc}\p{Cf}͏؜ᅟᅠ᠎​-‏‪-‮⁠-⁯⠀ㅤ︀-️﻿ﾠ￹-￼\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

/** The string cleaned for display, or null when nothing is left. */
export function cleanDisplay(value: unknown, max: number = MAX_DISPLAY_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  if (collapsed === '') return null;
  return Array.from(collapsed).slice(0, max).join('').trim() || null;
}
