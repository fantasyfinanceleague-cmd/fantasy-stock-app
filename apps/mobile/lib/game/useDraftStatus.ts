/**
 * useDraftStatus (3c, Start the draft): one draft-control `status` read. It says
 * whether the draft can start, the blockers (as codes, mapped to copy by
 * draftLobby / draftRefusals), and whether the caller is the commissioner. A
 * failed read is never "can start": the confirm stays disabled.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

export interface DraftStatus {
  status: 'idle' | 'loading' | 'ready' | 'error';
  canStart: boolean;
  isCommissioner: boolean;
  memberCount: number;
  minMembers: number;
  blockers: { code: string; have?: number; need?: number; playoffTeams?: number; members?: number }[];
}

const EMPTY: DraftStatus = { status: 'idle', canStart: false, isCommissioner: false, memberCount: 0, minMembers: 4, blockers: [] };

export function useDraftStatus(leagueId: string | null, enabled: boolean, refreshKey: number): DraftStatus {
  const [state, setState] = useState<DraftStatus>(EMPTY);
  useEffect(() => {
    if (!enabled || !leagueId) return;
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    (async () => {
      const { data, error } = await supabase.functions.invoke('draft-control', { body: { league_id: leagueId, action: 'status' } });
      if (cancelled) return;
      if (error || !data || data.ok === false) {
        console.warn('[game:draft-status] failed', error?.message);
        setState({ ...EMPTY, status: 'error' });
        return;
      }
      setState({
        status: 'ready',
        canStart: data.can_start === true && (data.blockers ?? []).length === 0,
        isCommissioner: data.is_commissioner === true,
        memberCount: Number(data.member_count ?? 0),
        minMembers: Number(data.min_members ?? 4),
        blockers: (data.blockers ?? []) as DraftStatus['blockers'],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, enabled, refreshKey]);
  return state;
}
