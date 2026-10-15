/**
 * Fitting text that must stay whole (onboarding W4, Design Lead gate on cd9a7b71). Pure, so tests-deno
 * pins the maths; the screens measure (a hidden probe Text's first line width via onTextLayout) and
 * pass the numbers in.
 *
 * A league's name on the arrival and on "You're in": ONE line down to NAME_MIN_SCALE (0.75x), and past
 * that a wrap at spaces on 2 lines (3 only when 2 cannot hold it at 0.75x), never mid-word and never
 * below 0.75x. A suggested gamertag in its field: the system size, shrunk only as far as the tag needs
 * to stay on one line, never under a floor.
 */

export const NAME_MIN_SCALE = 0.75;
/** Real text wraps at spaces, so two lines hold a little less than twice the width. */
const WRAP_EFFICIENCY = 0.9;

/** How many lines the league name takes: `natural` is its one-line width at the current size, `available` the row. */
export function nameLines(natural: number, available: number): 1 | 2 | 3 {
  if (!(natural > 0) || !(available > 0)) return 1;
  const shrunk = natural * NAME_MIN_SCALE;
  if (shrunk <= available) return 1;
  return shrunk <= 2 * available * WRAP_EFFICIENCY ? 2 : 3;
}

/** The floor for a suggested gamertag: the 19-character worst case fits one line at 22pt on a 375pt phone. */
export const GAMERTAG_FLOOR_PT = 22;

/** The field text's size: the system size, or smaller by exactly what the tag needs, never under `floor`. */
export function fittedFontSize(systemSize: number, natural: number, available: number, floor = GAMERTAG_FLOOR_PT): number {
  const room = available - 4; // the caret
  if (!(natural > 0) || !(room > 0) || natural <= room) return systemSize;
  return Math.min(systemSize, Math.max(floor, (systemSize * room) / natural));
}
