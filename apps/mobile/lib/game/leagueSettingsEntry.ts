/**
 * Who sees the "League settings" row on the League tab (3c-2; board
 * RibHistory). The commissioner; and, with the leave flow on (item 13), every
 * member, because League settings is where Leave league lives (board
 * #call-leave draws a member's League settings). Always the same check League
 * settings itself makes, so the row never leads to its "Only the commissioner
 * can edit settings" screen. A missing user or commissioner id never matches
 * (unlike a bare `a === b`, where undefined === undefined).
 */
import { leaveWindow, type LeaveLeagueFacts, type LeaveWindow } from './leaveLeague';

export function showsLeagueSettingsRow(
  commissionerId: string | null | undefined,
  userId: string | null | undefined,
  leaveFlowOn = false,
): boolean {
  if (!userId) return false;
  if (leaveFlowOn) return true;
  return !!commissionerId && commissionerId === userId;
}

/** League settings' lock note (Design Lead ruling): ONE sentence for both
 * locked states (draft in progress, draft completed), shown as a neutral note
 * with the lock icon. Deliberately distinct from the Leave row's line ("Teams
 * are locked in from an hour before the draft until the season ends."). */
export const SETTINGS_LOCKED = 'Settings are locked once the draft starts.';

/** The invite row's Share pill, for the commissioner and the member alike: the ONE place the
 * condition lives. Giorgio, 2026-10-13 (B, board #call-share-locked): Share "comes back at
 * renewal and before the draft, when a code can be used", so it shows ONLY before the draft (a
 * renewed season's too). Hidden while teams are locked (an hour before the draft until the
 * season ends) AND after the season: preview-league refuses a completed season
 * ('season_completed'), so a code shared then can't be used. The code itself always shows. */
export function inviteShareShown(window: LeaveWindow): boolean {
  return window === 'before_draft';
}

/** The same condition from a league's facts and the (server) clock, for every OTHER invite Share
 * (W4 Onboarding): Home's pre-draft invite row, which before showed Share through the hour before
 * the draft (room open) too. One rule, one function: `inviteShareShown(leaveWindow(…))`. */
export function inviteShareShownFor(facts: LeaveLeagueFacts, nowMs: number): boolean {
  return inviteShareShown(leaveWindow(facts, nowMs));
}

/**
 * The draft time the Share rule reads: the server's (draft-control status `starts_at`, which IS
 * leagues.draft_date) once the status has been read, the league row's until then. A POSTPONED
 * draft has none: postpone_league_draft clears leagues.draft_date (20261111000000; the old time
 * lives only in draft_postponements.postponed_from, which this never reads), so a postponed
 * league is `before_draft` and joinable, and Share shows (Design Lead ruling, W4 Onboarding gate,
 * 2026-10-14). Never pass the postponement's `from`: it would read as locked.
 */
export function inviteShareDraftTime(statusRead: boolean, serverStartsAt: string | null, leagueDraftDate: string | null | undefined): string | null {
  return statusRead ? serverStartsAt : (leagueDraftDate ?? null);
}

/** What Share sends: Giorgio's sentence, then the invite link (decision 2). One function for every Share. */
export { inviteShareMessage } from '../invite/inviteLink';
