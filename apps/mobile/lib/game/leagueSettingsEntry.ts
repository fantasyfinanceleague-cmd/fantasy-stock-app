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
