/**
 * useFinalLineups (3c, the final lineup). For a POSTED week: one league-wide
 * read of the scored week's snapshot rows for both sides, with week_end_price
 * (set after the Friday close), guarded by an exact count. Each side's rows
 * are shown only when they sum to the recorded gain to the cent (finalLineup).
 * A mismatch is logged and the lineup withheld, never shown. Runs only while
 * `enabled` (the posted state), so it costs nothing on a live week.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { finalLineup, type FinalLineupResult, type FinalSnapshot } from './finalLineup';
import { checkRowsComplete } from './readGuard';

export interface FinalLineupsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  mine: FinalLineupResult | null;
  theirs: FinalLineupResult | null;
}

export function useFinalLineups(
  leagueId: string | null,
  week: number | null,
  sides: { mine: string; theirs: string; myGain: number; theirGain: number } | null,
  enabled: boolean,
): FinalLineupsState {
  const [state, setState] = useState<FinalLineupsState>({ status: 'idle', mine: null, theirs: null });
  const key = sides ? `${sides.mine}|${sides.theirs}|${sides.myGain}|${sides.theirGain}` : '';

  useEffect(() => {
    if (!enabled || !leagueId || week === null || !sides) return;
    let cancelled = false;
    setState({ status: 'loading', mine: null, theirs: null });
    (async () => {
      try {
        const res = await supabase
          .from('week_snapshots')
          .select('user_id, symbol, quantity, week_start_price, week_end_price, entered_mid_week', { count: 'exact' })
          .eq('league_id', leagueId)
          .eq('week_number', week)
          .in('user_id', [sides.mine, sides.theirs]);
        if (res.error) throw res.error;
        const rows = res.data ?? [];
        if (!checkRowsComplete(rows.length, res.count ?? null).ok) throw new Error('week_snapshots read incomplete');
        if (__DEV__) console.log('[game:final-lineup] 1 request (week_snapshots, scored week, both sides)');
        const snapsFor = (uid: string): FinalSnapshot[] =>
          rows.filter((r) => String(r.user_id) === uid).map((r) => ({
            symbol: r.symbol, quantity: Number(r.quantity), week_start_price: Number(r.week_start_price),
            week_end_price: r.week_end_price === null ? null : Number(r.week_end_price), entered_mid_week: !!r.entered_mid_week,
          }));
        // Trades are not read here (the approved read is snapshots only): a week
        // with mid-week buys or sells cannot reconcile, and is withheld by the gate.
        const mine = finalLineup({ snapshots: snapsFor(sides.mine), trades: [], teamGain: sides.myGain });
        const theirs = finalLineup({ snapshots: snapsFor(sides.theirs), trades: [], teamGain: sides.theirGain });
        if (!mine.ok || !theirs.ok) console.warn('[game:final-lineup] withheld: rows do not sum to the recorded gain', { mine: mine.ok, theirs: theirs.ok });
        if (cancelled) return;
        setState({ status: 'ready', mine, theirs });
      } catch (err) {
        if (cancelled) return;
        console.warn('[game:final-lineup] failed', (err as Error).message);
        setState({ status: 'error', mine: null, theirs: null });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, leagueId, week, key]);

  return state;
}
