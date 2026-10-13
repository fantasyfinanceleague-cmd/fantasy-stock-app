/**
 * useSeasonPlayoffs (GS-8): every season's playoff games in a league's lineage
 * (get_season_matchups), so League › History can order each finished season by its
 * playoff result, as League › Standings does. A failed read leaves no rows, and History
 * then shows that season with no medals (never a guessed podium).
 */
import { useEffect, useState } from 'react';
import { seamRpc } from './seamCalls';
import type { PodiumGameRow } from './finalStandings';

interface SeasonMatchupRow extends PodiumGameRow {
  league_id: string;
  is_playoff: boolean;
}

export interface SeasonPlayoffsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Playoff rows per season (league id). */
  byLeague: Map<string, PodiumGameRow[]>;
}

/** `reloadKey`: bump it to read again (History's Try again re-reads both). */
export function useSeasonPlayoffs(leagueId: string | null, enabled: boolean, reloadKey = 0): SeasonPlayoffsState {
  const [state, setState] = useState<SeasonPlayoffsState>({ status: 'idle', byLeague: new Map() });
  useEffect(() => {
    if (!enabled || !leagueId) return;
    let cancelled = false;
    setState({ status: 'loading', byLeague: new Map() });
    (async () => {
      const { data, error } = await seamRpc('get_season_matchups', { p_league_id: leagueId });
      if (cancelled) return;
      if (error || !Array.isArray(data)) {
        console.warn('[game:history] get_season_matchups failed', error?.message);
        setState({ status: 'error', byLeague: new Map() });
        return;
      }
      const byLeague = new Map<string, PodiumGameRow[]>();
      for (const r of data as SeasonMatchupRow[]) {
        if (!r.is_playoff) continue;
        const list = byLeague.get(r.league_id) ?? [];
        list.push({ playoff_round_number: r.playoff_round_number, team1_user_id: r.team1_user_id, team2_user_id: r.team2_user_id, winner_user_id: r.winner_user_id });
        byLeague.set(r.league_id, list);
      }
      setState({ status: 'ready', byLeague });
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, enabled, reloadKey]);
  return state;
}
