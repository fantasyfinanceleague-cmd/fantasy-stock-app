// Account deletion (W4) — every word the flow shows, in ONE place. Giorgio's approved strings, verbatim
// (docs/PRODUCT_RULES.md "Account deletion" › "Giorgio's board picks", 2026-10-21; board account-deletion.jsx
// "Decided"). Pure, so tests-deno pins them. The seat's label is NOT here: it is the server's
// (lib/account/deletedSeat.ts), and these lines take it as a parameter.

export const DELETE_ROW = 'Delete account'; // Profile's last row
export const DELETE_TITLE = 'Delete your account?';
export const DELETE_LEAD = 'This deletes your account right away.';
export const PROOF_PASSWORD = 'Enter your password to continue'; // the plan's
export const PROOF_SOCIAL = "Confirm it's you to continue"; // NEW, "Use as written" (note: ASCII apostrophe, as drawn)
export const CONFIRMED_WITH_APPLE = 'Confirmed with Apple'; // NEW
export const CONFIRMED_WITH_GOOGLE = 'Confirmed with Google'; // NEW
export const DELETE_BUTTON = 'Delete my account';
export const CONTINUE_WITH_APPLE = 'Continue with Apple';
export const CONTINUE_WITH_GOOGLE = 'Continue with Google';

export const ALERT_TITLE = 'Are you sure?';
export const ALERT_BODY = "This can't be undone. Your account and sign-in are deleted for good.";
export const ALERT_KEEP = 'Keep my account'; // the default (cancel style)
export const ALERT_DELETE = 'Delete'; // destructive

/** NEW (Design Lead ruling, 2026-10-21; bad_proof, under the password field in the field's error style). */
export const PASSWORD_WRONG = "That password isn't right. Try again.";
/** NEW (same ruling; an Apple / Google bad_proof, under the provider button). */
export const PROOF_UNCONFIRMED = "Couldn't confirm it's you. Try again.";
/** NEW (same ruling; the proof rate limit, and a takeover code lockout: never understate an hour's lockout). */
export const TRY_LATER = 'Too many tries. Try again later.';

export const DELETE_FAILED = "Couldn't delete your account. Try again.";
export const ACCOUNT_DELETED = 'Your account is deleted.'; // Sign in, once

export const FIND_NEW_MANAGER = 'Find a new manager';
export const TAKE_THE_TEAM = 'Take the team';
export const NOT_NOW = 'Not now';
export const TAKEN_LINE = 'Someone already took this team.';
export const GO_TO_HOME = 'Go to Home';
export const FIND_LEAGUE = 'Find league'; // shipped (Join's lookup button); the tap that previews a scheme-origin takeover link
export const OPEN_THE_LEAGUE = 'Open the league'; // shipped (Join's already-a-member button)

/** The line under the lead on a league the person plays in or runs (the board's B lines, verbatim). */
export function stayLine(label: string): string {
  return `Your team stays as “${label}”.`;
}
export function successorLine(label: string, successorName: string): string {
  return `${stayLine(label)} ${successorName} becomes the commissioner.`;
}
export function handOverLine(label: string): string {
  return `${stayLine(label)} The commissioner can hand it to a new manager.`;
}
export const NOT_DRAFTED_LINE = 'It hasn’t drafted yet, so you leave it.';
export const NO_OTHERS_LINE = 'No other managers, so it’s deleted with your account.';
export function pastSeasonsLine(label: string): string {
  return `Past seasons keep your results under “${label}”.`;
}

/** The tap view's heading: the approved share text with the league cut off (the league can't be shown before the tap; UX rule 8: say what the screen is). */
export const TAKEOVER_TAP_TITLE = 'Take over a team';

/** The share text (NEW, "Use as written"). */
export function takeoverShareSentence(leagueName: string): string {
  return `Take over a team in ${leagueName}`;
}
/** The landing's question: "Take over Former manager's team in Stock Scudetto?" */
export function takeoverQuestion(label: string, leagueName: string): string {
  return `Take over ${label}'s team in ${leagueName}?`;
}
