/**
 * useLeagueHistory (3c, R10): get_league_history for any league in the lineage.
 * A failed read is an error state, never an empty history passed off as true.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import type { HistoryRow } from './history';

export interface LeagueHistoryState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  rows: HistoryRow[];
}

export function useLeagueHistory(leagueId: string | null, enabled: boolean): LeagueHistoryState {
  const [state, setState] = useState<LeagueHistoryState>({ status: 'idle', rows: [] });
  useEffect(() => {
    if (!enabled || !leagueId) return;
    let cancelled = false;
    setState({ status: 'loading', rows: [] });
    (async () => {
      const { data, error } = await supabase.rpc('get_league_history', { p_league_id: leagueId });
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
  }, [leagueId, enabled]);
  return state;
}
