/**
 * standings rows (3c, League standings). The order is the server's
 * league_standings_ranked order, read as is: nothing re-sorts it on the
 * client. Movement (▲/▼) is the server's current rank against its rank
 * through last week; it is null, and not shown, when last week's order is
 * not available. A "no move" is only ever a real comparison that held.
 * Once the season is complete, finalStandingsRows lifts the playoff podium
 * to the top (GS-4, lib/game/finalStandings.ts).
 */
import { finalStandingsOrder, playoffPodium, type Podium, type PodiumGameRow, type PodiumTag } from './finalStandings';

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
  /** Final standings only: "Champion" / "Runner-up" under the name (GS-4). */
  tag?: PodiumTag | null;
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

/** A finished season's final standings (GS-4): the podium first, then everyone else
 * in the server's regular-season order. The rank becomes the final place (the medal
 * follows it); records and season gains stay the regular season's. No movement: a
 * week-over-week arrow means nothing against the playoff order. Null when the podium's
 * managers aren't all in the rows. */
export function finalStandingsRows(rows: StandingsRow[], podium: Podium): StandingsRow[] | null {
  const order = finalStandingsOrder(rows, (r) => r.userId, podium);
  if (!order) return null;
  return order.map(({ row, place, tag }) => ({ ...row, rank: place, move: null, tag }));
}

export type StandingsView =
  | { kind: 'regular'; rows: StandingsRow[]; medals: boolean }
  | { kind: 'final'; rows: StandingsRow[] }
  | { kind: 'loading' };

/** What League › Standings shows (GS-4). In season: the server's order, no medals. A
 * season complete with no playoffs: the same order with medals (the regular season
 * decided it). A season complete WITH playoffs: the final standings once the bracket
 * proves the podium; while it loads, nothing (never the regular-season medals first);
 * if it can't be read or proven, the regular order with NO medals, so a gold never sits
 * next to a manager the playoffs didn't crown. */
export function standingsView(input: {
  rows: StandingsRow[];
  completed: boolean;
  playoffTeams: number | null;
  bracketStatus: 'idle' | 'loading' | 'ready' | 'error';
  playoffRows: readonly PodiumGameRow[];
}): StandingsView {
  const { rows, completed, playoffTeams } = input;
  if (!completed) return { kind: 'regular', rows, medals: false };
  if (!playoffTeams || playoffTeams < 2) return { kind: 'regular', rows, medals: true };
  if (input.bracketStatus === 'idle' || input.bracketStatus === 'loading') return { kind: 'loading' };
  if (input.bracketStatus === 'error') return { kind: 'regular', rows, medals: false };
  const seed = new Map(rows.map((r) => [r.userId, r.rank]));
  const podium = playoffPodium(input.playoffRows, (id) => seed.get(id) ?? null, { teams: playoffTeams });
  const final = podium ? finalStandingsRows(rows, podium) : null;
  return final ? { kind: 'final', rows: final } : { kind: 'regular', rows, medals: false };
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

/** UX rule 7: while the standings card is on screen and YOUR row is entirely below
 * the fold, a copy of it is pinned at the bottom. As soon as ANY of your row is
 * visible, the copy goes, so the two never show at once (W4 DL gate: at XL your real
 * row showed under its pinned copy). The card leaving the screen also unpins. */
export function shouldPinYourRow(g: PinGeometry): boolean {
  const cardOnScreen = g.cardTop < g.viewBottom && g.cardBottom > g.viewTop;
  const rowBelowFold = g.rowTop >= g.viewBottom;
  return cardOnScreen && rowBelowFold;
}
