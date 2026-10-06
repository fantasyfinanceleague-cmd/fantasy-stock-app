/**
 * useRenewalRoster (3c, Run it back): get_renewal_roster for a renewed league.
 * The dev fixture (EXPO_PUBLIC_RENEWAL_FIXTURE) stands in for the backend until
 * PR #94 is live; it is shaped exactly like the RPC returns (renewalFixture.ts).
 * A failed read is `null`, never a guessed roster.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { fixtureRoster } from './renewalFixture';

export const RENEWAL_FIXTURE: string | undefined = process.env.EXPO_PUBLIC_RENEWAL_FIXTURE;

export type RosterResult =
  | { status: 'not_visible' }
  | { status: 'ok'; full_list: false; caller_status: 'pending' | 'out'; caller_decided_by?: string | null }
  | {
      status: 'ok';
      full_list: true;
      is_commissioner: boolean;
      caller_status: string;
      replies_pending: boolean;
      counts: { in: number; new: number; out: number; pending: number; team_count: number; max_teams: number };
      people: {
        user_id: string; display_name: string; group: 'in' | 'new' | 'out' | 'pending'; is_commissioner: boolean;
        decided_by: string | null; responded_at: string | null; nudge_count: number; last_nudged_at: string | null;
        can_nudge: boolean; can_remove: boolean;
      }[];
    };

export function useRenewalRoster(successorLeagueId: string | null, fixtureCaller: 'commissioner' | 'in' | 'pending' | 'out' | 'new' | 'stranger' | null, refreshKey: number) {
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; roster: RosterResult | null }>({ status: 'idle', roster: null });
  useEffect(() => {
    if (!successorLeagueId && !fixtureCaller) return;
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    (async () => {
      if (RENEWAL_FIXTURE && fixtureCaller) {
        if (!cancelled) setState({ status: 'ready', roster: fixtureRoster(fixtureCaller, new Date()) as RosterResult });
        return;
      }
      const { data, error } = await supabase.rpc('get_renewal_roster', { p_league_id: successorLeagueId });
      if (cancelled) return;
      if (error || !data) {
        console.warn('[game:renewal] get_renewal_roster failed', error?.message);
        setState({ status: 'error', roster: null });
        return;
      }
      setState({ status: 'ready', roster: data as RosterResult });
    })();
    return () => {
      cancelled = true;
    };
  }, [successorLeagueId, fixtureCaller, refreshKey]);
  return state;
}
