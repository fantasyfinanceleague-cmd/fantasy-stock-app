/**
 * useAllMatchups (3c): every game of the week, fetched on first open of the
 * League segment. Four requests: matchups, week_snapshots, trades (in the
 * week's SCORING window, the stored week_start..week_end the server scores
 * with), and one batch quote. Names come from Home's standings (no request).
 * It runs only while `enabled`, so the Mine view never pays for it.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../useAuth';
import { buildAllMatchups, type AllMatchupRow } from './allMatchups';
import type { HomeLedgerRow } from '../home/buildHomeViewModel';
import { checkRowsComplete } from './readGuard';

export interface AllMatchupsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  rows: AllMatchupRow[];
}

export function useAllMatchups(
  leagueId: string | null,
  week: number | null,
  names: { user_id: string; display_name: string; is_bot: boolean }[],
  enabled: boolean,
): AllMatchupsState {
  const { user } = useAuth();
  const [state, setState] = useState<AllMatchupsState>({ status: 'idle', rows: [] });
  const namesKey = names.map((n) => `${n.user_id}:${n.display_name}:${n.is_bot}`).join('|');

  useEffect(() => {
    if (!enabled || !leagueId || week === null || !user?.id) return;
    let cancelled = false;
    setState((s) => ({ status: 'loading', rows: s.rows }));
    (async () => {
      let requests = 0;
      try {
        const matchupsRes = await supabase
          .from('matchups')
          .select('team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id, is_tie, is_playoff, week_start, week_end', { count: 'exact' })
          .eq('league_id', leagueId)
          .eq('week_number', week);
        requests += 1;
        if (matchupsRes.error) throw matchupsRes.error;
        const matchups = matchupsRes.data ?? [];
        // Read-cap guard: a partial read must fail visibly, never render partial games.
        if (!checkRowsComplete(matchups.length, matchupsRes.count ?? null).ok) throw new Error('matchups read incomplete');
        const windowStart = matchups.map((m) => m.week_start).filter(Boolean).sort()[0];
        const windowEnd = matchups.map((m) => m.week_end).filter(Boolean).sort().reverse()[0];

        const snapRes = await supabase
          .from('week_snapshots')
          .select('user_id, symbol, quantity, week_start_price, entered_mid_week, created_at', { count: 'exact' })
          .eq('league_id', leagueId)
          .eq('week_number', week);
        requests += 1;
        if (snapRes.error) throw snapRes.error;
        if (!checkRowsComplete((snapRes.data ?? []).length, snapRes.count ?? null).ok) throw new Error('week_snapshots read incomplete');

        const tradesRes = windowStart && windowEnd
          ? await supabase
              .from('trades')
              .select('user_id, symbol, action, quantity, price, created_at', { count: 'exact' })
              .eq('league_id', leagueId)
              .gte('created_at', windowStart)
              .lte('created_at', windowEnd)
          : { data: [], error: null, count: 0 };
        requests += 1;
        if (tradesRes.error) throw tradesRes.error;
        if (!checkRowsComplete((tradesRes.data ?? []).length, tradesRes.count ?? null).ok) throw new Error('trades read incomplete');

        const snapshots = (snapRes.data ?? []).map((r) => ({ ...r, user_id: String(r.user_id) })) as (HomeLedgerRow & { user_id: string })[];
        const trades = (tradesRes.data ?? []).map((r) => ({ ...r, user_id: String(r.user_id) })) as (HomeLedgerRow & { user_id: string })[];
        const symbols = Array.from(new Set([...snapshots.map((s) => s.symbol), ...trades.map((t) => t.symbol)]));
        let prices: Record<string, number> = {};
        if (symbols.length > 0) {
          const { data, error } = await supabase.functions.invoke('quote', { body: { symbols } });
          requests += 1;
          if (error) throw error;
          prices = (data?.prices ?? {}) as Record<string, number>;
        }

        if (__DEV__) console.log(`[game:all-matchups] ${requests} requests (matchups, week_snapshots, trades, quote)`);
        if (cancelled) return;
        const rows = buildAllMatchups({
          myUserId: user.id,
          week,
          matchups: matchups as Parameters<typeof buildAllMatchups>[0]['matchups'],
          snapshots,
          trades,
          quote: (s) => prices[s] ?? null,
          names,
        });
        setState({ status: 'ready', rows });
      } catch (err) {
        if (cancelled) return;
        console.warn('[game:all-matchups] failed', (err as Error).message);
        setState({ status: 'error', rows: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `names` is keyed by namesKey so a new array of the same names doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, leagueId, week, user?.id, namesKey]);

  return state;
}
