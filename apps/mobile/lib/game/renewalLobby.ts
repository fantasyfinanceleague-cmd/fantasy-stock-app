/**
 * When a renewed league (Run it back) moves from the renewal flow to the
 * normal pre-draft lobby on the League tab (3c-2; board "League tab, Season 2
 * before the draft" → "Go to the draft lobby"). Pure, so the rules tests see it.
 *
 * Ready = the renewal is reconciled AND the season is set: the roster is the
 * full list with nobody pending, and the league has a draft date.
 * start_renewed_season refuses without both (renewal_replies_pending,
 * no_draft_date), and renew_league creates the new season with
 * draft_date = null, so a date on a renewed league means the commissioner
 * scheduled it. (That holds because the renewal screen offers no other way to
 * set the date: its League settings row lives in the lobby, after scheduling.)
 *
 * Everyone else stays on the renewal flow: a pending invitee gets the ask, the
 * commissioner the review, members the roster.
 */
export function renewalReadyForLobby(input: {
  roster:
    | { status: 'not_visible' }
    | { status: 'ok'; full_list: false }
    | { status: 'ok'; full_list: true; replies_pending: boolean }
    | null;
  draftDate: string | null | undefined;
}): boolean {
  const r = input.roster;
  if (!r || r.status !== 'ok' || r.full_list !== true) return false;
  return r.replies_pending === false && !!input.draftDate;
}
