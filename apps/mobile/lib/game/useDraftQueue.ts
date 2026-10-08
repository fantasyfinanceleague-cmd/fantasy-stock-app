/**
 * useDraftQueue (3c-2): my draft queue, for the pre-draft lobby. Seamed like
 * useDraftRoom's own queue read (fixture rows under the dev seam). See
 * draftQueueRead.ts for why a failed read is never an empty queue.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { seamTable } from './seamCalls';
import { nextQueueRead, type QueueRead } from './draftQueueRead';

export function useDraftQueue(leagueId: string | null): QueueRead & { version: number; refresh: () => void } {
  const [read, setRead] = useState<QueueRead>({ status: 'loading' });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await seamTable<{ symbol: string; position: number }>('draft_queue', () =>
          supabase.from('draft_queue').select('symbol, position').eq('league_id', leagueId).order('position'),
        );
        if (!cancelled) setRead((prev) => nextQueueRead(prev, res));
      } catch (err) {
        if (cancelled) return;
        console.warn('[game:draft-queue] failed', (err as Error)?.message);
        setRead((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, version]);

  return { ...read, version, refresh };
}
