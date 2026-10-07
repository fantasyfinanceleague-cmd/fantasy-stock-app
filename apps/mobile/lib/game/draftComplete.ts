/**
 * draftComplete (3c-2, U-10): the draft's designed ending (board #game "Draft
 * complete", drawn in 3edfaf6), shown in the room when the last pick lands,
 * before the League tab becomes the pre-season tab. Copy is the board's.
 *
 * - "Week 1 starts Mon 9:30 AM ET. You play {opponent}": Week 1's REAL open,
 *   resolved from schedule.ts's nominal Tuesday week_start through the market
 *   calendar (Home's B3 rule, the same resolveWeekWindow). With no calendar
 *   coverage the time is unknown, so the line says "starts soon", never the
 *   known-wrong nominal time.
 * - The roster at draft prices, "Round 1 · pick 2" per row.
 * - The finalize hand-off waits: the last pick's realtime insert reaches the
 *   room before the server's finalize (same request) flips draft_status, so an
 *   instant hand-off to the legacy heal route would skip this ending every time.
 */
import { nextWeekStartsLabel } from '../home/homeCopy';
import { dollars } from '../stakesLine';
import { resolveWeekWindow, type MarketCalendarSession } from '../time/marketWeek';
import { managerAtPick } from './draftBoard';

export const DRAFT_COMPLETE_TAG = 'Draft complete'; // board
export const YOUR_TEAM_IS_SET = 'Your team is set'; // board
export const SEE_WEEK_ONE_MATCHUP = 'See your Week 1 matchup'; // board
/** A Week 1 bye: there's no matchup of yours, so the button opens All matchups (Design Lead, ruled). */
export const SEE_WEEK_ONE_MATCHUPS = "See Week 1's matchups";

/** "Week 1 starts Mon 9:30 AM ET. You play Gianluigi B." (board). A bye:
 * "… You have a bye that week." (ruled). Not known yet (the schedule not read):
 * the sentence ends at the time (ruled). */
export function weekOneLine(realStartIso: string | null, opponent: string | null | undefined, bye = false): string {
  const label = nextWeekStartsLabel(1, realStartIso);
  if (bye) return `${label}. You have a bye that week.`;
  const opp = opponent?.trim();
  return opp ? `${label}. You play ${opp}` : `${label}.`;
}

/** A bye is a READ Week 1 row with no other side; no row (or not read yet) is unknown, not a bye. */
export function weekOneIsBye(game: { opponentId: string | null } | null): boolean {
  return game !== null && game.opponentId === null;
}

/** The Matchup tab's segment from the route (the ending's bye button opens All matchups). */
export function matchupSegmentFromParam(param: string | string[] | undefined): 'mine' | 'all' | null {
  const v = Array.isArray(param) ? param[0] : param;
  return v === 'all' ? 'all' : v === 'mine' ? 'mine' : null;
}

/** Week 1's real open: the nominal week_start resolved through the market
 * calendar; null when the calendar doesn't cover that week (never the nominal). */
export function weekOneRealStart(nominalWeekStart: string | null | undefined, sessions: MarketCalendarSession[]): string | null {
  if (!nominalWeekStart) return null;
  return resolveWeekWindow(nominalWeekStart, sessions)?.weekStart ?? null;
}

export interface WeekOneRow {
  team1_user_id: string | null;
  team2_user_id: string | null;
  week_start: string | null;
}

/** Your Week 1 game: the row you're in, and the other side (null on a bye). */
export function weekOneFor(rows: readonly WeekOneRow[], me: string): { opponentId: string | null; weekStart: string | null } | null {
  const row = rows.find((r) => String(r.team1_user_id) === me || String(r.team2_user_id) === me);
  if (!row) return null;
  const other = String(row.team1_user_id) === me ? row.team2_user_id : row.team1_user_id;
  return { opponentId: other ? String(other) : null, weekStart: row.week_start ?? null };
}

export interface RosterPick {
  symbol: string;
  round: number;
  pick: number;
  price: number | null;
}

/** Your picks, in pick order, with their round and draft price. A legacy SKIP
 * row is not a stock. */
export function myRosterPicks(
  picks: ReadonlyMap<number, { symbol: string; source: string; price?: number | null }>,
  order: readonly string[],
  userId: string,
): RosterPick[] {
  const m = order.length;
  if (m === 0) return [];
  return [...picks.entries()]
    .filter(([n, p]) => managerAtPick(n, order as string[]) === userId && p.source !== 'skip')
    .sort((a, b) => a[0] - b[0])
    .map(([n, p]) => ({ symbol: p.symbol.toUpperCase(), round: Math.floor((n - 1) / m) + 1, pick: n, price: p.price ?? null }));
}

/** "Round 1 · pick 2" (board). */
export function rosterPickCaption(r: Pick<RosterPick, 'round' | 'pick'>): string {
  return `Round ${r.round} · pick ${r.pick}`;
}

/** The draft price, or nothing when it is unknown (never "$0"). */
export function draftPriceLabel(price: number | null): string | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  return dollars(Math.round(price * 100) / 100);
}

/** How long every pick in and draft_status still 'in_progress' waits before the
 * room hands off to the legacy finalize heal (the server finalizes in the last
 * pick's own request; a re-read inside this window normally sees 'completed'). */
export const FINALIZE_GRACE_MS = 6000;

/** Hand off to the finalize heal only once the draft has sat full and not
 * completed for the whole grace window. */
export function shouldHandOffToFinalize(fullSinceMs: number | null, nowMs: number): boolean {
  return fullSinceMs !== null && nowMs - fullSinceMs >= FINALIZE_GRACE_MS;
}
