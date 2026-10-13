/**
 * useMatchup (3c): the data half of the Matchup screen. It reuses Home's
 * single fetch (useHomeLeague: get_home_league, quote, historical-bars), so
 * Matchup adds NO requests and its live score is Home's by construction. It
 * turns that into the Matchup view (matchupPhase), the live numbers
 * (buildMatchupLive), and the final gains once the server posts them.
 */
import { useMemo } from 'react';
import { useAuth } from '../useAuth';
import { useHomeLeague } from '../home/useHomeLeague';
import { matchupView, type MatchupView } from './matchupPhase';
import { buildMatchupLive, finalGains, type MatchupLiveViewModel } from './buildMatchupViewModel';
import { etDateParts } from '../time/etParts';

/** Today's ET calendar date (YYYY-MM-DD): the trading day the chyron measures against. */
function todayEt(now: Date): string {
  const p = etDateParts(now);
  if (!p) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export interface MatchupDerived {
  view: MatchupView;
  live: MatchupLiveViewModel;
  /** The server's gains once both post; null until then ("Scoring…"). */
  final: { me: number; opp: number } | null;
  weekStart: string | null;
  weekEnd: string | null;
  week: number;
  /** Your standings record (league_standings_ranked), for the final band's "W · 5–1" (GS-2). */
  myRecord: { wins: number; losses: number; ties: number } | null;
}

export function useMatchup(leagueId: string | null) {
  const { user } = useAuth();
  const home = useHomeLeague(leagueId);

  const derived = useMemo<MatchupDerived | null>(() => {
    if (!home.viewModel || !home.raw || !user) return null;
    const raw = home.raw;
    const cw = raw.data.current_week;
    const row = raw.data.matchups.find((m) => m.week_number === cw.week_number) ?? null;
    const live = buildMatchupLive({
      data: raw.data,
      myUserId: user.id,
      quote: raw.quote,
      now: raw.now,
    });
    return {
      view: matchupView(home.viewModel.phase),
      live,
      final: finalGains(raw.data, user.id),
      weekStart: row?.week_start ?? null,
      weekEnd: row?.week_end ?? null,
      week: cw.week_number,
      myRecord: (() => {
        const st = raw.data.standings.find((r) => r.user_id === user.id);
        return st ? { wins: Number(st.wins), losses: Number(st.losses), ties: Number(st.ties) } : null;
      })(),
    };
  }, [home.viewModel, home.raw, user]);

  return {
    status: home.status,
    error: home.error,
    refresh: home.refresh,
    derived,
    phase: home.viewModel?.phase ?? null,
    quote: home.raw?.quote ?? (() => null),
    names: (home.raw?.data.standings ?? []).map((st) => ({ user_id: st.user_id, display_name: st.display_name, is_bot: st.is_bot })),
    bars: home.raw?.bars ?? {},
    todayIso: todayEt(new Date()),
    /** Home's raw inputs (ledgers, quotes, bars, calendar, the fetch's `now`): the W4 roster
     * orders and the player card reads from them. Null while loading. */
    raw: home.raw,
  };
}
