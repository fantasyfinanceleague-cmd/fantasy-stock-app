// Account deletion (W4) — a name that never splits across lines in a sentence (Design Lead gate, 2026-10-21): the seat's
// label ("Former manager"), a league's name, a successor's name. Display only (VoiceOver reads the same words; the copy is
// unchanged and shared with the tests as plain text).
//
//   hyphens: a hyphenated word keeps its hyphen's word whole (keepHyphens, the arrival's keepName).
//   spaces:  a name of `keepWhole` characters or fewer gets no-break spaces, so "Former manager" and "Stock Scudetto" stay
//            on one line. A LONGER name keeps its spaces breakable: a 39-character league name glued into one run would be
//            wider than the screen and wrap mid-word, which is worse than a break between its words.

import { keepHyphens } from '../game/keepDots';

export const NAME_KEEP_WHOLE = 20;
const NBSP = '\u00a0';

export function keepName(name: string, keepWhole: number = NAME_KEEP_WHOLE): string {
  const hyphenated = keepHyphens(name);
  return name.length <= keepWhole ? hyphenated.replace(/ /g, NBSP) : hyphenated;
}
