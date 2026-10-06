/**
 * useDraftStatus (3c; auto-start 3c-2): one draft-control `status` read. It
 * carries the draft's auto-start state (start_state, starts_at, postponed,
 * judged on the server's clock), the blockers (codes, mapped to copy by
 * autoStart / draftLobby), and whether the caller is the commissioner.
 *
 * The server's clock: status carries server_now (the DB clock, the same
 * instant that judged start_state), and the countdown runs on the offset from
 * it. From an older draft-control without that field, a get_draft_clock read
 * (the draft room's clock) is the fallback; if that fails too the offset is 0
 * (the phone's clock) and the phase still comes from start_state. A failed
 * status read is never "can start".
 */
import { useEffect, useState } from 'react';
import { seamInvoke, seamRpc } from './seamCalls';
import { functionOk, readFunctionRefusal } from '../functionRefusal';
import { clockFromStatus, parseStartStatus, serverOffsetMs, type Blocker, type Postponed, type StartState } from './autoStart';

export interface DraftStatus {
  status: 'idle' | 'loading' | 'ready' | 'error';
  canStart: boolean;
  isCommissioner: boolean;
  memberCount: number;
  minMembers: number;
  blockers: Blocker[];
  /** Auto-start: null from an older draft-control (derived from the time alone). */
  startState: StartState | null;
  startsAt: string | null;
  postponed: Postponed | null;
  /** The server's clock minus the phone's (ms); 0 when unknown. */
  serverOffsetMs: number;
}

const EMPTY: DraftStatus = {
  status: 'idle', canStart: false, isCommissioner: false, memberCount: 0, minMembers: 4, blockers: [],
  startState: null, startsAt: null, postponed: null, serverOffsetMs: 0,
};

export function useDraftStatus(leagueId: string | null, enabled: boolean, refreshKey: number): DraftStatus {
  const [state, setState] = useState<DraftStatus>(EMPTY);
  useEffect(() => {
    if (!enabled || !leagueId) return;
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    (async () => {
      const res = await seamInvoke('draft-control', { body: { league_id: leagueId, action: 'status' } });
      const receivedAt = Date.now();
      // readFunctionRefusal: a non-2xx body (rate_limited, not_a_member …) is read, not lost.
      const read = await readFunctionRefusal(res.data, res.error);
      if (cancelled) return;
      if (!functionOk(read)) {
        console.warn('[game:draft-status] failed', read.transport ? 'transport' : read.reason);
        setState({ ...EMPTY, status: 'error' });
        return;
      }
      const data = read.body as Record<string, any>;
      const clock = clockFromStatus(data as Record<string, unknown>);
      let offset = 0;
      if (clock.source === 'status') {
        offset = serverOffsetMs(clock.serverNow, receivedAt);
      } else {
        // An older deploy: the draft room's clock, read once.
        const fb = await seamRpc('get_draft_clock', { p_league_id: leagueId }).then(
          (r) => ({ res: r, at: Date.now() }),
          () => ({ res: { data: null, error: { message: 'transport' } }, at: Date.now() }),
        );
        if (cancelled) return;
        const row = !fb.res.error ? ((fb.res.data as { server_now?: string }[] | null) ?? [])[0] : undefined;
        offset = serverOffsetMs(row?.server_now ?? null, fb.at);
      }
      const start = parseStartStatus(data as Record<string, unknown>);
      setState({
        status: 'ready',
        canStart: data.can_start === true && (data.blockers ?? []).length === 0,
        isCommissioner: data.is_commissioner === true,
        memberCount: Number(data.member_count ?? 0),
        minMembers: Number(data.min_members ?? 4),
        blockers: (data.blockers ?? []) as Blocker[],
        ...start,
        serverOffsetMs: offset,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, enabled, refreshKey]);
  return state;
}
