/**
 * useFinalLineups (3c, the final lineup). For a POSTED week: one league-wide
 * read of the scored week's snapshot rows for both sides, with week_end_price
 * (set after the Friday close), plus the scored window's trades, both guarded
 * by an exact count (two requests). Each side's rows are shown only when they
 * sum to the recorded gain to the cent (finalLineup).
 * A mismatch is logged and the lineup withheld, never shown. Runs only while
 * `enabled` (the posted state), so it costs nothing on a live week.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { seamTable } from './seamCalls';
import { finalLineup, type FinalLineupResult, type FinalSnapshot } from './finalLineup';
import { checkRowsComplete } from './readGuard';
import type { LiveTrade } from '../home/liveWeekScore';

export interface FinalLineupsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  mine: FinalLineupResult | null;
  theirs: FinalLineupResult | null;
}

export function useFinalLineups(
  leagueId: string | null,
  week: number | null,
  sides: { mine: string; theirs: string; myGain: number; theirGain: number; windowStart: string; windowEnd: string } | null,
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
        const res = await seamTable('week_snapshots', () => supabase
          .from('week_snapshots')
          .select('user_id, symbol, quantity, week_start_price, week_end_price, entered_mid_week', { count: 'exact' })
          .eq('league_id', leagueId)
          .eq('week_number', week)
          .in('user_id', [sides.mine, sides.theirs]));
        if (res.error) throw res.error;
        const rows = res.data ?? [];
        if (!checkRowsComplete(rows.length, res.count ?? null).ok) throw new Error('week_snapshots read incomplete');
        // The scored window's trades, as the server scores them (snapshots + trades).
        const tr = await seamTable('trades', () => supabase
          .from('trades')
          .select('user_id, symbol, action, quantity, price, created_at', { count: 'exact' })
          .eq('league_id', leagueId)
          .in('user_id', [sides.mine, sides.theirs])
          .gte('created_at', sides.windowStart)
          .lte('created_at', sides.windowEnd));
        if (tr.error) throw tr.error;
        const tradeRows = tr.data ?? [];
        if (!checkRowsComplete(tradeRows.length, tr.count ?? null).ok) throw new Error('trades read incomplete');
        if (__DEV__) console.log('[game:final-lineup] 2 requests (week_snapshots, trades; scored week, both sides)');
        const tradesFor = (uid: string): LiveTrade[] =>
          tradeRows.filter((r) => String(r.user_id) === uid).map((r) => ({
            symbol: r.symbol, action: r.action, quantity: Number(r.quantity), price: Number(r.price), createdAt: new Date(r.created_at),
          }));
        const snapsFor = (uid: string): FinalSnapshot[] =>
          rows.filter((r) => String(r.user_id) === uid).map((r) => ({
            symbol: r.symbol, quantity: Number(r.quantity), week_start_price: Number(r.week_start_price),
            week_end_price: r.week_end_price === null ? null : Number(r.week_end_price), entered_mid_week: !!r.entered_mid_week,
          }));
        const mine = finalLineup({ snapshots: snapsFor(sides.mine), trades: tradesFor(sides.mine), teamGain: sides.myGain });
        const theirs = finalLineup({ snapshots: snapsFor(sides.theirs), trades: tradesFor(sides.theirs), teamGain: sides.theirGain });
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
