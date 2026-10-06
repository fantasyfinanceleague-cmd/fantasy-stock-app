/**
 * Who sees the "League settings" row on the pre-draft League tab (3c-2; board
 * RibHistory). The commissioner only: the same check League settings itself
 * makes, so the row never leads to its "Only the commissioner can edit
 * settings" screen. A missing user or commissioner id never matches (unlike a
 * bare `a === b`, where undefined === undefined).
 */
export function showsLeagueSettingsRow(commissionerId: string | null | undefined, userId: string | null | undefined): boolean {
  return !!commissionerId && !!userId && commissionerId === userId;
}

/** League settings' lock note (Design Lead ruling): ONE sentence for both
 * locked states (draft in progress, draft completed), shown as a neutral note
 * with the lock icon. Deliberately distinct from the Leave row's line ("Teams
 * are locked in from an hour before the draft until the season ends."). */
export const SETTINGS_LOCKED = 'Settings are locked once the draft starts.';
