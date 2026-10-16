/**
 * keepDots (W4 gate, "Wrapping at XL"): a "·" line wraps only BETWEEN its segments. Each " · "
 * keeps its dot with the segment before it (a non-breaking space before the dot), so no line
 * ever starts with "·"; and a short segment keeps its own words together ("Round 2 of 6",
 * "Pick 11", "7:00 PM ET"), as Home's heroMetaLine does for "Week 6 of 14". A long segment
 * still wraps inside itself rather than run off the screen. Display only: the copy is unchanged
 * (VoiceOver reads the same words). Pure, so tests-deno pins it.
 */
export const NBSP = '\u00a0';
/** A segment this short never breaks inside (the longest the room draws whole is
 * "Auto-picked AAPL for you", 24). */
export const KEEP_WHOLE = 24;

/** U+2060 WORD JOINER: zero-width, no glyph of its own (so no font fallback), forbids a break. */
export const WORD_JOINER = '\u2060';

/** A hyphenated word never splits at its hyphen ("first-" / "round byes", W4 Onboarding gate P3):
 * a word joiner after each hyphen between letters. Display only (VoiceOver reads the same
 * words; the copy, shared with the web, is unchanged). */
export function keepHyphens(line: string): string {
  return line.replace(/(\p{L})-(?=\p{L})/gu, `$1-${WORD_JOINER}`);
}

export function keepDots(line: string, keepWhole = KEEP_WHOLE): string {
  if (!line.includes(' · ')) return line;
  return line
    .split(' · ')
    .map((s) => (s.length <= keepWhole ? s.replace(/ /g, NBSP) : s))
    .join(`${NBSP}· `);
}

/**
 * keepDots for ONE phrase inside a longer sentence ("The draft is {when}. The draft order is set an hour
 * before."): only the phrase gets the no-break spaces, so the sentence's own words wrap freely around it.
 * keepDots on the whole sentence would glue its 24-character first segment ("The draft is Sat, Oct 10")
 * into one unbreakable run and leave "7:00 PM ET" free to split. (Onboarding W8, the one dot rule: a "·"
 * may END a line, never start one.)
 */
export function keepDotsIn(sentence: string, phrase: string): string {
  return phrase && sentence.includes(phrase) ? sentence.replace(phrase, () => keepDots(phrase)) : sentence;
}
