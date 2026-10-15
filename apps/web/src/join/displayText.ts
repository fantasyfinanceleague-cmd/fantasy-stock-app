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

// Written as \u ESCAPES on purpose (an editor or formatter that strips zero-width characters must not be able
// to weaken this silently; displayText.test.ts also asserts the file is pure ASCII).
//   \p{Cc}  controls                       \p{Cf}  format: zero-width, bidi marks/overrides/isolates, soft hyphen, BOM, tags
//   U+034F grapheme joiner                 U+061C Arabic letter mark
//   U+115F, U+1160, U+3164, U+FFA0         Hangul fillers (blank)       U+2800 braille blank
//   U+17B4-17B5 Khmer inherent vowels      U+180B-180F Mongolian free variation selectors / vowel separator
//   U+200B-200F, U+202A-202E, U+2060-206F  the format blocks, spelled out so a reserved gap can't slip by
//   U+FE00-FE0F variation selectors        U+FEFF BOM                    U+FFF0-FFFC specials / annotation / object replacement
//   U+E0000-E0FFF tags, variation-selector supplement and the reserved default-ignorables around them
const UNSAFE = /[\p{Cc}\p{Cf}\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFC\u{E0000}-\u{E0FFF}]/gu;

/** The string cleaned for display, or null when nothing is left. */
export function cleanDisplay(value: unknown, max: number = MAX_DISPLAY_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  if (collapsed === '') return null;
  return Array.from(collapsed).slice(0, max).join('').trim() || null;
}
