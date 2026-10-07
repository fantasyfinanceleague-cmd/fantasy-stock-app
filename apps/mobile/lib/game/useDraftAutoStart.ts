/**
 * useDraftAutoStart (3c-2): everything stateful about a league's draft
 * auto-start, shared by the League tab's lobby and Home's pre-draft card so
 * the two never disagree. The rules are lib/game/autoStart.ts (pure, tested);
 * this hook only wires them to the server:
 * - the draft-control status (start_state, starts_at, postponed, blockers),
 *   carried forward on the server's clock, ticking every second under two
 *   hours (else every 15 s), re-read at T−1h and T;
 * - at 0:00, when `kick` is on (the lobby only: both tabs stay mounted and one
 *   request per phone is enough), ONE start request per draft time; and, for
 *   both, a 3 s poll of the status and the league until it has started (the
 *   screens switch to the room) or been postponed;
 * - the commissioner's fixes: the playoff-teams stepper (lock first), the
 *   roster reconfirm, the invite share, and a draft time (a postponed draft's
 *   new one; Home's no-time card): the sheet holds it and "Set draft time"
 *   saves it here (the row checked, refusals mapped).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';
import { useLeagueContext } from '../LeagueContext';
import { useDraftStatus } from './useDraftStatus';
import { seamInvoke, seamUpdateLeague } from './seamCalls';
import { playoffTeamsSaveOutcome } from './playoffTeamsSave';
import { draftDateForSave, updatedOneRow } from './draftDateSave';
import { readFunctionRefusal } from '../functionRefusal';
import {
  DRAFT_TIME_NOT_SAVED,
  NEW_TIME_NOT_SAVED,
  confirmRosterRefusal,
  draftTimeRefusal,
  etTimeLabel,
  fixableBlockers,
  lobbyPhase,
  lobbyView,
  nextBoundaryMs,
  postponedAtMs,
  roomOpensAtMs,
  startKickOutcome,
} from './autoStart';

const TWO_HOURS = 2 * 60 * 60 * 1000;

export function useDraftAutoStart(leagueId: string, opts: { kick: boolean }) {
  const { activeLeague, refresh } = useLeagueContext();
  const [statusKey, setStatusKey] = useState(0);
  const ds = useDraftStatus(leagueId, true, statusKey);
  const reread = useCallback(() => setStatusKey((k) => k + 1), []);

  // The phase: the server's start_state on the server's clock. A re-read keeps
  // the last known phase while it loads, so cards never blink out.
  const [phoneNow, setPhoneNow] = useState(() => Date.now());
  const serverNow = phoneNow + ds.serverOffsetMs;
  const known = ds.status === 'ready' || (ds.status === 'loading' && ds.startState !== null);
  const phase = known ? lobbyPhase(ds, serverNow) : null;
  const fixable = fixableBlockers(ds.blockers);
  const view = phase ? lobbyView(phase, ds.isCommissioner, fixable.length) : null;

  const msLeft = ds.startsAt ? new Date(ds.startsAt).getTime() - serverNow : Number.POSITIVE_INFINITY;
  const fast = phase === 'starting' || msLeft < TWO_HOURS;
  useEffect(() => {
    const id = setInterval(() => setPhoneNow(Date.now()), fast ? 1000 : 15000);
    return () => clearInterval(id);
  }, [fast]);
  useEffect(() => {
    const boundary = nextBoundaryMs(ds.startsAt, Date.now() + ds.serverOffsetMs);
    if (boundary === null) return;
    const t = setTimeout(reread, Math.max(0, boundary - (Date.now() + ds.serverOffsetMs)) + 500);
    return () => clearTimeout(t);
  }, [ds.startsAt, ds.serverOffsetMs, reread]);

  // 0:00: one start request per draft time (the lobby), then poll (both).
  const kickedFor = useRef<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!opts.kick || !view?.kick || !ds.startsAt || kickedFor.current === ds.startsAt) return;
    kickedFor.current = ds.startsAt;
    void (async () => {
      const { data: res, error } = await seamInvoke('draft-control', { body: { league_id: leagueId, action: 'start' } });
      const r = await readFunctionRefusal(res, error);
      const outcome = r.transport ? 'reread' : startKickOutcome(r.reason === null ? { ok: true } : { ok: false, reason: r.reason });
      setRetrying(outcome === 'retrying');
      reread();
      await refresh();
    })();
  }, [opts.kick, view?.kick, ds.startsAt, leagueId, refresh, reread]);
  useEffect(() => {
    if (phase !== 'starting' && phase !== 'started') return;
    const id = setInterval(() => {
      reread();
      void refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [phase, refresh, reread]);

  // The commissioner's fixes.
  const [fixError, setFixError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setPlayoffTeams = async (teams: number) => {
    setBusy(true);
    const res = await seamUpdateLeague(leagueId, { playoff_teams: teams });
    setBusy(false);
    const outcome = playoffTeamsSaveOutcome(res);
    if (outcome.kind !== 'saved') {
      setFixError(outcome.line);
      if (outcome.kind === 'locked') {
        reread();
        await refresh();
      }
      return;
    }
    setFixError(null);
    reread();
    await refresh();
  };

  const reconfirm = async (choice: 'move_forward' | 'invite') => {
    setBusy(true);
    const { data: res, error } = await seamInvoke('draft-control', { body: { league_id: leagueId, action: 'confirm_roster', choice } });
    setBusy(false);
    // U-24: each refusal its own line (the audit's Rule 8 table); null when it saved.
    setFixError(confirmRosterRefusal(await readFunctionRefusal(res, error)));
    reread();
    await refresh();
  };

  const shareInvite = () => {
    const code = activeLeague?.invite_code;
    if (code) void Share.share({ message: `Join my league with code ${code}` });
  };

  // A draft time (a postponed draft's new one, the blockers card's sheet; or
  // Home's no-time card, its own sheet): the sheet holds it, "Set draft time" saves it.
  const [pickingTime, setPickingTime] = useState(false);
  const openPicker = () => {
    setFixError(null);
    setPickingTime(true);
  };
  const closePicker = () => setPickingTime(false);
  // `firstTime`: Home's no-time card (its failure line has no "new"); otherwise a postponed draft's new time.
  const saveDraftTime = async (date: Date, opts: { firstTime?: boolean } = {}) => {
    setPickingTime(false);
    const value = draftDateForSave(false, date);
    if (!value.ok) {
      setFixError(value.error);
      return;
    }
    setBusy(true);
    const res = await seamUpdateLeague(leagueId, { draft_date: value.value });
    setBusy(false);
    if (res.error || !updatedOneRow(res)) {
      setFixError(draftTimeRefusal(res.error) ?? (opts.firstTime ? DRAFT_TIME_NOT_SAVED : NEW_TIME_NOT_SAVED));
      return;
    }
    setFixError(null);
    reread();
    await refresh();
  };

  const postponedAt = postponedAtMs(ds.postponed);
  return {
    ds,
    phase,
    view,
    serverNow,
    retrying,
    reread,
    fixable,
    roomLabel: ds.startsAt ? etTimeLabel(roomOpensAtMs(ds.startsAt)) : null,
    postponedLabel: postponedAt !== null ? etTimeLabel(postponedAt) : null,
    fixes: {
      busy, fixError, setPlayoffTeams, reconfirm, shareInvite,
      pickingTime, openPicker, closePicker, saveDraftTime,
    },
  };
}
