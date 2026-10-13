/**
 * Who sees the "League settings" row on the League tab (3c-2; board
 * RibHistory). The commissioner; and, with the leave flow on (item 13), every
 * member, because League settings is where Leave league lives (board
 * #call-leave draws a member's League settings). Always the same check League
 * settings itself makes, so the row never leads to its "Only the commissioner
 * can edit settings" screen. A missing user or commissioner id never matches
 * (unlike a bare `a === b`, where undefined === undefined).
 */
import type { LeaveWindow } from './leaveLeague';

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
 * condition lives. Giorgio, 2026-10-13 (B, board #call-share-locked): HIDDEN while teams are
 * locked, from an hour before the draft until the season ends (the leave rule's locked
 * windows); shown before the draft (a renewed Season 2 too) and after the season. The code
 * itself always stays visible. */
export function inviteShareShown(window: LeaveWindow): boolean {
  return window !== 'locked_order_set' && window !== 'locked_season';
}

/** What Share sends (unchanged from the member's row). */
export function inviteShareMessage(code: string): string {
  return `Join my league with code ${code}`;
}
