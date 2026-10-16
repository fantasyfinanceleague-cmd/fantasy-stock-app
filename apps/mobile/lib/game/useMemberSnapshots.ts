/**
 * useMemberSnapshots: one league member's `week_snapshots` rows for a week, for the leaguemate
 * team view's player card. One request, guarded by an exact count (a partial read must fail
 * visibly, never score a subset). `week_snapshots` SELECT is `is_member(league_id)`, so a
 * non-member reads nothing; the view is also gated by the ledger (current members only).
 * `week` null (no live week yet) is a settled empty read, not a pending one.
 */
import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../supabase';
import { seamTable } from './seamCalls';
import { checkRowsComplete } from './readGuard';
import { rowsOrThrow, type RowsResult } from '../readResult';
import type { MemberSnapshotRow } from './memberWeek';

export interface MemberSnapshotsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  rows: MemberSnapshotRow[];
  retry: () => void;
}

export function useMemberSnapshots(leagueId: string | null, userId: string | null, week: number | null): MemberSnapshotsState {
  const [state, setState] = useState<Omit<MemberSnapshotsState, 'retry'>>({ status: 'idle', rows: [] });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    if (!leagueId || !userId) return;
    if (week === null) {
      setState({ status: 'ready', rows: [] });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading', rows: [] });
    (async () => {
      try {
        const res = await seamTable('week_snapshots', () => supabase
          .from('week_snapshots')
          .select('user_id, symbol, quantity, week_start_price, entered_mid_week', { count: 'exact' })
          .eq('league_id', leagueId)
          .eq('week_number', week)
          .eq('user_id', userId));
        // A resolved error is a failed read, never "no rows" (lib/readResult.ts).
        const rows = rowsOrThrow(res as RowsResult<MemberSnapshotRow & { user_id: string }>, 'week_snapshots');
        if (!checkRowsComplete(rows.length, res.count ?? null).ok) throw new Error('week_snapshots read incomplete');
        if (cancelled) return;
        setState({ status: 'ready', rows: rows.filter((r) => String(r.user_id) === userId) });
      } catch (err) {
        if (cancelled) return;
        console.warn('[team-view] week_snapshots read failed', (err as Error).message);
        setState({ status: 'error', rows: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, userId, week, attempt]);

  return { ...state, retry };
}
