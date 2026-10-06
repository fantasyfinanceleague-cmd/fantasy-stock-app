/**
 * useLeagueStandings (3c, League standings). Two requests on load:
 * get_home_league (the server's ranked standings, the matchups and the week
 * number) and league_standings_ranked through LAST week (the movement). The
 * order is the server's; the movement is null until the through-week ranking
 * is deployed (its migration is not applied yet), so no arrow is ever guessed.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../useAuth';
import type { GetHomeLeagueResult } from '../home/buildHomeViewModel';
import type { StandingInput } from './standings';

export interface LeagueStandingsState {
  status: 'loading' | 'ready' | 'error';
  standings: StandingInput[];
  week: number | null;
  /** user_id -> rank through last week, or null when unavailable. */
  previousRanks: Map<string, number> | null;
  data: GetHomeLeagueResult | null;
}

export function useLeagueStandings(leagueId: string | null): LeagueStandingsState {
  const { user } = useAuth();
  const [state, setState] = useState<LeagueStandingsState>({ status: 'loading', standings: [], week: null, previousRanks: null, data: null });

  useEffect(() => {
    if (!leagueId || !user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_home_league', { p_league_id: leagueId });
      if (cancelled) return;
      if (error || !data) {
        console.warn('[game:standings] get_home_league failed', error?.message);
        setState((s) => ({ ...s, status: 'error' }));
        return;
      }
      const home = data as GetHomeLeagueResult;
      const week = home.current_week.week_number;
      let previousRanks: Map<string, number> | null = null;
      if (week > 1) {
        // Movement needs last week's order. Until the through-week ranking is
        // deployed this call errors, and the arrows stay hidden.
        const { data: prev, error: prevError } = await supabase.rpc('league_standings_ranked', { p_league_id: leagueId, p_through_week: week - 1 });
        if (!prevError && Array.isArray(prev)) {
          previousRanks = new Map(prev.map((r: { user_id: string; rank: number }) => [String(r.user_id), Number(r.rank)]));
        }
      }
      if (__DEV__) console.log('[game:standings] 1-2 requests (get_home_league, league_standings_ranked through last week)');
      if (cancelled) return;
      setState({ status: 'ready', standings: home.standings, week, previousRanks, data: home });
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, user?.id]);

  return state;
}
