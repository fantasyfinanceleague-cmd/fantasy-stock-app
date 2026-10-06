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
import { resolveWeekWindow } from '../time/marketWeek';
import { matchupView, type MatchupView } from './matchupPhase';
import { buildMatchupLive, finalGains, type MatchupLiveViewModel } from './buildMatchupViewModel';
import { matchupDays, type MatchupDay } from './matchupWindow';
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
  /** The matchup week's real trading days (for the race and the "Ends" line). */
  days: MatchupDay[];
  weekStart: string | null;
  weekEnd: string | null;
  week: number;
}

export function useMatchup(leagueId: string | null) {
  const { user } = useAuth();
  const home = useHomeLeague(leagueId);

  const derived = useMemo<MatchupDerived | null>(() => {
    if (!home.viewModel || !home.raw || !user) return null;
    const raw = home.raw;
    const cw = raw.data.current_week;
    const row = raw.data.matchups.find((m) => m.week_number === cw.week_number) ?? null;
    const window = row ? resolveWeekWindow(row.week_end, raw.marketCalendar) : null;
    const days = window ? matchupDays(raw.marketCalendar, window) : [];
    const live = buildMatchupLive({
      data: raw.data,
      myUserId: user.id,
      quote: raw.quote,
      bars: raw.bars,
      days,
      now: raw.now,
    });
    return {
      view: matchupView(home.viewModel.phase),
      live,
      final: finalGains(raw.data, user.id),
      days,
      weekStart: row?.week_start ?? null,
      weekEnd: row?.week_end ?? null,
      week: cw.week_number,
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
  };
}
