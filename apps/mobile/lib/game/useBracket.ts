/**
 * useBracket (3c, the playoff bracket). One league-wide read of the playoff
 * rows, with an exact-count guard so a partial read fails visibly rather than
 * drawing a partial bracket. Names and seeds come from the standings the
 * League screen already has (no request). Runs only while `enabled`.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { seamTable } from './seamCalls';
import { buildBracket, type Bracket, type BracketRow, type BracketStanding } from './bracket';
import { checkRowsComplete } from './readGuard';

export interface BracketState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  bracket: Bracket | null;
}

export function useBracket(leagueId: string | null, teams: number | null, standings: BracketStanding[], enabled: boolean): BracketState {
  const [state, setState] = useState<BracketState>({ status: 'idle', bracket: null });
  const standingsKey = standings.map((s) => `${s.user_id}:${s.rank}:${s.display_name}`).join('|');

  useEffect(() => {
    if (!enabled || !leagueId || teams === null) return;
    let cancelled = false;
    setState({ status: 'loading', bracket: null });
    (async () => {
      try {
        const res = await seamTable('matchups_playoff', () => supabase
          .from('matchups')
          .select('playoff_round_number, bracket_position, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id', { count: 'exact' })
          .eq('league_id', leagueId)
          .eq('is_playoff', true));
        if (res.error) throw res.error;
        const rows = (res.data ?? []) as BracketRow[];
        // Read-cap guard: a partial bracket must not be drawn.
        if (!checkRowsComplete(rows.length, res.count ?? null).ok) throw new Error('playoff rows read incomplete');
        if (__DEV__) console.log('[game:bracket] 1 request (matchups, is_playoff)');
        if (cancelled) return;
        setState({ status: 'ready', bracket: buildBracket({ rows, teams, standings }) });
      } catch (err) {
        if (cancelled) return;
        console.warn('[game:bracket] failed', (err as Error).message);
        setState({ status: 'error', bracket: null });
      }
    })();
    return () => {
      cancelled = true;
    };
    // standings are keyed by standingsKey so an equal new array does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, teams, enabled, standingsKey]);

  return state;
}
