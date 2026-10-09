/**
 * Pure league-state gate for record-trade. No DB, no Deno runtime APIs, so it is
 * tested hermetically in gate.test.ts.
 *
 * Trading opens once the draft is done (draft_not_completed). A COMPLETED season
 * closes the market (season_completed): a finished league stays in the league
 * sheet next to its successor under Run it back, and a stray trade there would
 * change a season that is already scored and frozen (get_league_history).
 */

export type TradeRefusal = 'draft_not_completed' | 'season_completed';

export function tradeRefusalReason(
  league: { draft_status: string | null; season_status: string | null },
): TradeRefusal | null {
  if (league.draft_status !== 'completed') return 'draft_not_completed';
  if (league.season_status === 'completed') return 'season_completed';
  return null;
}
