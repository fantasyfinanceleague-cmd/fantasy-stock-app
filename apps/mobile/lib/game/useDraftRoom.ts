/**
 * useDraftRoom (3c, key screen 4): the draft room's data. Reads the server's
 * clock (get_draft_clock), the snake order (get_draft_order), every pick
 * (drafts), the display names (get_league_display_names) and my own queue
 * (draft_queue, own rows). Re-reads when a pick is inserted (the drafts
 * channel). A failed read is never a guessed state: the room says so.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { seamRpc, seamTable } from './seamCalls';
import { indexPicks, type DraftPickRow } from './draftBoard';
import type { ClockState } from './draftRoom';
import { clockState } from './draftRoom';
import { nextQueueRead, type QueueRead } from './draftQueueRead';

export interface RoomState {
  status: 'loading' | 'ready' | 'error';
  order: string[];
  picks: Map<number, { symbol: string; source: string; price: number | null }>;
  pickCount: number;
  clock: ClockState;
  pickSeconds: number;
  names: Record<string, { name: string; isBot: boolean }>;
  /** My queue, read on its own: a failed queue read never fails the room, and
   * never becomes an empty list for QueueEditor to save over the real one. */
  queue: QueueRead;
  draftStatus: string | null;
  refresh: () => void;
}

export function useDraftRoom(leagueId: string | null): RoomState {
  const [state, setState] = useState<Omit<RoomState, 'refresh'>>({
    status: 'loading', order: [], picks: new Map(), pickCount: 0,
    clock: { kind: 'idle', secondsLeft: null }, pickSeconds: 60, names: {}, queue: { status: 'loading' }, draftStatus: null,
  });
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;
    (async () => {
      try {
        const [clockRes, orderRes, picksRes, namesRes, queueRes] = await Promise.all([
          seamRpc('get_draft_clock', { p_league_id: leagueId }),
          seamRpc('get_draft_order', { p_league_id: leagueId }),
          seamTable('drafts', () => supabase.from('drafts').select('pick_number, symbol, pick_source, entry_price').eq('league_id', leagueId)),
          seamRpc('get_league_display_names', { p_league_id: leagueId }),
          seamTable<{ symbol: string; position: number }>('draft_queue', () => supabase.from('draft_queue').select('symbol, position').eq('league_id', leagueId).order('position')),
        ]);
        if (cancelled) return;
        if (clockRes.error || orderRes.error || picksRes.error) throw clockRes.error ?? orderRes.error ?? picksRes.error;

        const clockRow = (clockRes.data ?? [])[0] ?? null;
        const order = ((orderRes.data as { order?: { position: number; user_id: string }[] } | null)?.order ?? [])
          .slice().sort((a, b) => a.position - b.position).map((o) => String(o.user_id));
        const picks = indexPicks((picksRes.data ?? []) as DraftPickRow[]);
        const names: Record<string, { name: string; isBot: boolean }> = {};
        for (const n of (namesRes.data ?? []) as { user_id: string; display_name: string; is_bot: boolean }[]) {
          names[String(n.user_id)] = { name: n.display_name, isBot: n.is_bot };
        }
        const pickSeconds = clockRow ? Number(clockRow.pick_seconds) : 60;
        const clock = clockRow
          ? clockState({ running: clockRow.clock_running === true, deadlineAt: clockRow.deadline_at ?? null, serverNow: clockRow.server_now })
          : { kind: 'idle' as const, secondsLeft: null };
        setState((s) => ({
          status: 'ready', order, picks, pickCount: picks.size, clock, pickSeconds, names,
          // A resolved query error is NOT an empty queue (set_draft_queue replaces the whole list).
          queue: nextQueueRead(s.queue, queueRes),
          draftStatus: clockRow ? String(clockRow.draft_status) : null,
        }));
      } catch (err) {
        if (cancelled) return;
        console.warn('[game:draft-room] failed', (err as Error)?.message);
        setState((s) => ({ ...s, status: 'error' }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, tick]);

  // A new pick (or a skip-turned auto pick) arrives as a drafts insert: re-read.
  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(`draft-room:${leagueId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'drafts', filter: `league_id=eq.${leagueId}` }, () => refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [leagueId, refresh]);

  return { ...state, refresh };
}
