/**
 * League › History (3c, R10): the seasons in a lineage, from get_league_history.
 * Each season is its own frozen record. Nothing here invents a champion or a
 * rank: a season that is not finished has none. The Season 1 order (the frozen
 * final-standings rank of the first season) also orders the renewal roster.
 */

export interface FinalStanding {
  user_id: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  display_name: string;
}

export interface HistoryRow {
  league_id: string;
  season_number: number;
  is_current: boolean;
  draft_status: string;
  completed_at: string | null;
  champion_user_id: string | null;
  champion_display_name: string | null;
  my_rank: number | null;
  my_wins: number | null;
  my_losses: number | null;
  final_standings: FinalStanding[] | null;
}

export interface HistorySeason {
  leagueId: string;
  seasonNumber: number;
  champion: string | null;
  myRecord: string | null;
  standings: FinalStanding[];
}

/** Newest season first. The champion and the record are the server's, or null. */
export function historySeasons(rows: HistoryRow[]): HistorySeason[] {
  return rows
    .slice()
    .sort((a, b) => b.season_number - a.season_number)
    .map((r) => ({
      leagueId: r.league_id,
      seasonNumber: r.season_number,
      champion: r.champion_display_name ?? null,
      myRecord: r.my_wins !== null && r.my_losses !== null ? `${r.my_wins}–${r.my_losses}` : null,
      standings: (r.final_standings ?? []).slice().sort((a, b) => a.rank - b.rank),
    }));
}

/** The Season 1 order: the first finished season's frozen rank (its final standings). Empty when none is finished. */
export function season1Order(rows: HistoryRow[]): string[] {
  const first = rows
    .filter((r) => r.final_standings && r.final_standings.length > 0)
    .sort((a, b) => a.season_number - b.season_number)[0];
  if (!first || !first.final_standings) return [];
  return first.final_standings.slice().sort((a, b) => a.rank - b.rank).map((s) => s.user_id);
}

/** R9: the champion banner for the season before this one, until its draft: the
 * last finished season's champion and that champion's frozen record. Null when no
 * season has finished, or when the champion is not in the frozen standings. */
export function championBanner(rows: HistoryRow[]): { tag: string; line: string } | null {
  const last = rows
    .filter((r) => r.final_standings && r.final_standings.length > 0 && r.champion_user_id)
    .sort((a, b) => b.season_number - a.season_number)[0];
  if (!last || !last.final_standings) return null;
  const champ = last.final_standings.find((s) => s.user_id === last.champion_user_id);
  if (!champ) return null;
  return { tag: `Season ${last.season_number} champion`, line: `${champ.display_name} · ${champ.wins}–${champ.losses}` };
}
