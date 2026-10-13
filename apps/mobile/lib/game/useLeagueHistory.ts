/**
 * useLeagueHistory (3c, R10): get_league_history for any league in the lineage.
 * A failed read is an error state, never an empty history passed off as true.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { seamRpc } from './seamCalls';
import { LEAGUE_FIXTURE_VARIANT } from './devSeam';
import type { HistoryRow } from './history';

export interface LeagueHistoryState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  rows: HistoryRow[];
}

/** `reloadKey`: bump it to read again (History's Try again). */
export function useLeagueHistory(leagueId: string | null, enabled: boolean, reloadKey = 0): LeagueHistoryState {
  const [state, setState] = useState<LeagueHistoryState>({ status: 'idle', rows: [] });
  useEffect(() => {
    if (!enabled || !leagueId) return;
    let cancelled = false;
    setState({ status: 'loading', rows: [] });
    (async () => {
      const { data, error } = LEAGUE_FIXTURE_VARIANT === 'history_error'
        ? { data: null, error: { message: 'fixture: history read failed' } }
        : await seamRpc('get_league_history', { p_league_id: leagueId });
      if (cancelled) return;
      if (error || !data) {
        console.warn('[game:history] get_league_history failed', error?.message);
        setState({ status: 'error', rows: [] });
        return;
      }
      setState({ status: 'ready', rows: data as HistoryRow[] });
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, enabled, reloadKey]);
  return state;
}
