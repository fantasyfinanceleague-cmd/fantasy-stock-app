/**
 * After Create league (3c-2; Design Lead rulings): the done screen that
 * replaces the old "League Created!" Alert (the pattern of Join's "You're in"
 * plus the pre-draft Home invite-code card), and the two Alerts that remain,
 * reworded. A raw error message is never shown; it is only logged.
 */

/** "{Name} is ready" */
export function createdTitle(name: string): string {
  return `${name.trim()} is ready`;
}

export const CREATED_LINE = 'Share the invite code to bring your league in.';

/** Added when the league has no draft date yet. */
export const CREATED_NO_DATE = 'Set a draft time before the draft can start.';

export const GO_TO_LEAGUE = 'Go to the league';

/** True when the league was created without a draft date: TBD, or a date
 * never picked (the insert then writes no draft_date). */
export function createdWithoutDate(draftDateTBD: boolean, draftDate: Date | null): boolean {
  return draftDateTBD || draftDate === null;
}

/** The league row landed but the roster slots didn't. */
export const SLOTS_NOT_SAVED = {
  title: "Roster slots didn't save",
  message: "Your league was created, but its roster slots didn't save. Add them again in League settings.",
} as const;

/** The create itself failed. Never the raw error message. */
export const CREATE_FAILED = {
  title: "The league wasn't created",
  message: 'Check your connection, then try again.',
} as const;

/** The share sheet's text: the League tab lobby's wording. */
export function inviteShareMessage(code: string): string {
  return `Join my league with code ${code}`;
}
