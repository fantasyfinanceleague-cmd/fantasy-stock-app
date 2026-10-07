/**
 * useLeaveLeague (3c-2, item 13): the leave-league calls and what the leave and
 * transfer sheets need (the names, the current members). The edge function and
 * its RPCs decide everything; each call's outcome goes through leaveOutcome, so
 * a 2xx refusal and a non-2xx body (read from error.context) both reach their
 * line, and nothing is shown as done that the server didn't report.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { readFunctionRefusal } from '../functionRefusal';
import { seamInvoke, seamRpc, seamTable } from './seamCalls';
import { leaveOutcome, leaveRecheck, type LeaveOutcome } from './leaveLeague';

export interface LeagueName {
  user_id: string;
  display_name: string | null;
  is_bot?: boolean | null;
}

export function useLeaveLeague(leagueId: string | null, enabled: boolean, me: string, leagueName: string) {
  const [names, setNames] = useState<LeagueName[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled || !leagueId) return;
    let cancelled = false;
    void Promise.all([
      seamRpc('get_league_display_names', { p_league_id: leagueId }),
      seamTable<{ user_id: string }>('league_members', () => supabase.from('league_members').select('user_id').eq('league_id', leagueId)),
    ]).then(([n, m]) => {
      if (cancelled) return;
      // A failed read leaves the lists empty (no picker rows), never a guessed roster.
      setNames(n.error ? [] : ((n.data ?? []) as LeagueName[]));
      setMemberIds(m.error ? [] : (m.data ?? []).map((r) => String(r.user_id)));
    });
    return () => {
      cancelled = true;
    };
  }, [leagueId, enabled]);

  const call = useCallback(async (body: Record<string, unknown>): Promise<LeaveOutcome> => {
    setBusy(true);
    const { data, error } = await seamInvoke('leave-league', { body });
    const outcome = leaveOutcome(await readFunctionRefusal(data, error));
    setBusy(false);
    return outcome;
  }, []);

  // Leave is destructive: an UNKNOWN outcome re-reads your own membership row
  // before saying anything (Design Lead, ruled). Busy covers the re-read too.
  const leave = useCallback(async (): Promise<LeaveOutcome> => {
    const first = await call({ league_id: leagueId, action: 'leave' });
    if (first.kind !== 'unknown' || !leagueId) return first;
    setBusy(true);
    const read = await seamTable<{ hidden_at: string | null }>('league_members_me', () =>
      supabase.from('league_members').select('hidden_at').eq('league_id', leagueId).eq('user_id', me),
    );
    setBusy(false);
    return leaveRecheck({ error: read.error, data: read.data }, leagueName);
  }, [call, leagueId, me, leagueName]);
  const transfer = useCallback(
    (newCommissionerId: string) => call({ league_id: leagueId, action: 'transfer', new_commissioner_id: newCommissionerId }),
    [call, leagueId],
  );

  return { names, memberIds, busy, leave, transfer };
}
