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
import { fixtureHomeLeague } from '../home/useHomeLeague';
import { LEAGUE_FIXTURE_VARIANT, SEAM_ON } from './devSeam';
import { HOME_FIXTURE } from '../home/devFixture';
import { leagueFixturePreviousRanks, leagueFixtureStandings } from './leagueFixture';
import { seamRpc } from './seamCalls';
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

/** `reloadKey`: bump it to read again (League's pull to refresh and its Try again). */
export function useLeagueStandings(leagueId: string | null, reloadKey = 0): LeagueStandingsState {
  const { user } = useAuth();
  const [state, setState] = useState<LeagueStandingsState>({ status: 'loading', standings: [], week: null, previousRanks: null, data: null });

  useEffect(() => {
    if (!leagueId || !user?.id) return;
    // A re-read starts from loading, so a Try again after an error shows the skeleton first.
    if (reloadKey > 0) setState((s) => (s.status === 'error' ? { ...s, status: 'loading' } : s));
    let cancelled = false;
    (async () => {
      // Under the capture seam the Home fixture Home itself reads stands in (so Home's card and
      // League agree), the board's scored league when none is set; the League fixture can
      // resize it, or make the read hang or fail. The through-week call goes through the seam
      // like any other (its fixture is last week's order).
      if (SEAM_ON && LEAGUE_FIXTURE_VARIANT === 'loading') return;
      const seamHome = SEAM_ON ? fixtureHomeLeague(HOME_FIXTURE ?? 'scored').data : null;
      const sized = leagueFixtureStandings(LEAGUE_FIXTURE_VARIANT);
      const seamData = seamHome ? (sized ? { ...seamHome, standings: sized } : seamHome) as unknown : null;
      const { data, error } = SEAM_ON
        ? LEAGUE_FIXTURE_VARIANT === 'error' ? { data: null, error: { message: 'fixture: standings read failed' } } : { data: seamData, error: null }
        : await seamRpc('get_home_league', { p_league_id: leagueId });
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
        const { data: prev, error: prevError } = sized
          ? { data: leagueFixturePreviousRanks(sized), error: null }
          : await seamRpc('league_standings_ranked', { p_league_id: leagueId, p_through_week: week - 1 });
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
  }, [leagueId, user?.id, reloadKey]);

  return state;
}
