/**
 * standings rows (3c, League standings). The order is the server's
 * league_standings_ranked order, read as is: nothing re-sorts it on the
 * client. Movement (▲/▼) is the server's current rank against its rank
 * through last week; it is null, and not shown, when last week's order is
 * not available. A "no move" is only ever a real comparison that held.
 */

export interface StandingInput {
  user_id: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  display_name: string;
  is_bot: boolean;
}

export interface StandingsRow {
  userId: string;
  rank: number;
  name: string;
  isBot: boolean;
  isYou: boolean;
  /** Positive: moved up that many places. Negative: down. 0: held. Null: unknown. */
  move: number | null;
  /** "5–1" or "5–1–1" (the –T only with ties). An en dash, as on the board. */
  record: string;
  seasonGain: number;
}

export function buildStandingsRows(
  standings: StandingInput[],
  myUserId: string,
  previousRanks: Map<string, number> | null,
): StandingsRow[] {
  return standings.map((st) => {
    const before = previousRanks?.get(st.user_id);
    const move = before === undefined ? null : before - st.rank;
    const record = st.ties > 0 ? `${st.wins}–${st.losses}–${st.ties}` : `${st.wins}–${st.losses}`;
    return {
      userId: st.user_id,
      rank: st.rank,
      name: st.display_name,
      isBot: st.is_bot,
      isYou: st.user_id === myUserId,
      move,
      record,
      seasonGain: st.points_for,
    };
  });
}

/** The move, as VoiceOver reads it: "up 2" / "down 3"; nothing when unknown or
 * held. (Was "up N" for a down move too: Design Lead audit, UX rule 7.) */
export function moveA11y(move: number | null): string {
  if (!move) return '';
  return `${move > 0 ? 'up' : 'down'} ${Math.abs(move)}`;
}

/** Where your row and the card sit, in window coordinates, against the
 * scroll view's visible area. */
export interface PinGeometry {
  rowTop: number;
  rowBottom: number;
  cardTop: number;
  cardBottom: number;
  viewTop: number;
  viewBottom: number;
}

/** UX rule 7: while the standings card is on screen and YOUR row is below the
 * fold (not fully visible above the bottom of the scroll view), a copy of it is
 * pinned at the bottom. Once your row scrolls into view, or the card leaves
 * the screen, the copy goes. */
export function shouldPinYourRow(g: PinGeometry): boolean {
  const cardOnScreen = g.cardTop < g.viewBottom && g.cardBottom > g.viewTop;
  const rowBelowFold = g.rowBottom > g.viewBottom;
  return cardOnScreen && rowBelowFold;
}
