/**
 * memberWeek: the player card's week inputs for ANY league member (the leaguemate team view).
 * Matchup and Portfolio read the caller's (and the opponent's) week from get_home_league; a
 * leaguemate's week comes from their own `week_snapshots` rows (member-gated by RLS,
 * `is_member(league_id)`) and their trades inside the week's window, taken from the league
 * ledger the view already holds. Pure, so Deno tests it.
 */
import type { LiveSnapshot, LiveTrade } from '../home/liveWeekScore';
import type { LedgerActivityRow } from '../money/portfolioLedger';

export interface MemberSnapshotRow {
  symbol: string;
  quantity: number;
  week_start_price: number;
  entered_mid_week: boolean | null;
}

export function memberSnapshots(rows: readonly MemberSnapshotRow[]): LiveSnapshot[] {
  return rows.map((r) => ({ symbol: r.symbol, quantity: Number(r.quantity), weekStartPrice: Number(r.week_start_price), enteredMidWeek: !!r.entered_mid_week }));
}

/** The member's trades inside [weekStart, weekEnd] (inclusive, the server's scoring window). */
export function memberTrades(activity: readonly LedgerActivityRow[], userId: string, weekStart: string, weekEnd: string): LiveTrade[] {
  const from = Date.parse(weekStart);
  const to = Date.parse(weekEnd);
  return activity
    .filter((a) => a.kind === 'trade' && a.user_id === userId && a.price != null && (a.action === 'buy' || a.action === 'sell'))
    .filter((a) => {
      const t = Date.parse(a.occurred_at);
      return t >= from && t <= to;
    })
    .map((a) => ({ symbol: a.symbol, action: a.action as 'buy' | 'sell', quantity: a.quantity, price: a.price!, createdAt: new Date(a.occurred_at) }));
}
