/**
 * useHomeLeague: the data half of Phase 3b-2 Home. Fetches summary
 * (already in LeagueContext — no new request) + get_home_league + quote
 * + historical-bars (or substitutes the dev fixture), then hands
 * everything to the pure buildHomeViewModel for the actual decisions.
 *
 * Request budget (spec: "at most 5 requests on load"): get_home_summary
 * is LeagueContext's own fetch, shared across the whole app, not counted
 * again here. This hook itself issues at most 3: get_home_league, quote,
 * historical-bars — 4 total with the summary, inside the ≤5 budget.
 * `__DEV__` request logging (`[home] N requests`) is how the worker's
 * DONE report states the count.
 *
 * Per-state extras NOT fetched here (get_draft_order, get_draft_clock,
 * playoff bracket rows): the pre_draft/drafting/playoff phase cards fetch
 * those themselves, only when that phase is actually shown — this hook's
 * job is the money views (hero, this-week, season, standings), which
 * don't render in those phases (buildHomeViewModel's `inSeason` guard).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../useAuth';
import { useLeagueContext, type HomeSummaryRow } from '../LeagueContext';
import { playoffRoundLabelForWeek } from '../playoffs';
import {
  buildHomeViewModel,
  type BarsBySymbol,
  type GetHomeLeagueResult,
  type HomeLeagueMeta,
  type HomeViewModel,
} from './buildHomeViewModel';
import type { MarketInfo } from './homePhase';
import {
  HOME_FIXTURE,
  ROBERTO_HOLDINGS,
  GIANLUIGI_HOLDINGS,
  ROBERTO_WEEKS,
  FIXTURE_LEAGUE,
  FIXTURE_WEEK6_START,
  FIXTURE_WEEK6_END,
  fixtureQty,
} from './devFixture';

export type HomeLeagueStatus = 'loading' | 'ready' | 'error' | 'no-league';

export interface UseHomeLeagueResult {
  status: HomeLeagueStatus;
  viewModel: HomeViewModel | null;
  /** get_home_summary's own row for this league — the source for display
   * strings buildHomeViewModel doesn't own (the caller's record, the
   * opponent's display name/bot flag): those are UI presentation, not a
   * decision, so they're threaded straight from LeagueContext rather than
   * duplicated into the pure view model. Null under the dev fixture. */
  summary: HomeSummaryRow | null;
  error: string | null;
  refresh: () => Promise<void>;
}

function toMarketInfo(row: { status: string; reason: string; next_open_at: string | null } | null): MarketInfo {
  if (!row) return { status: 'unknown', reason: 'no_coverage', nextOpenAt: null };
  return { status: row.status as MarketInfo['status'], reason: row.reason, nextOpenAt: row.next_open_at };
}

/** The dev fixture's data, in get_home_league's own shape, so the same
 * buildHomeViewModel call path is exercised whether the data came from
 * Supabase or from the board's sample numbers. */
function fixtureHomeLeague(): { data: GetHomeLeagueResult; meta: HomeLeagueMeta; quote: (s: string) => number | null; bars: BarsBySymbol } {
  const myDrafts = ROBERTO_HOLDINGS.map((h) => ({ symbol: h.symbol, entry_price: h.draft, quantity: fixtureQty(h), created_at: '2026-08-01T00:00:00Z' }));
  const mySnapshots = ROBERTO_HOLDINGS.map((h) => ({ symbol: h.symbol, quantity: fixtureQty(h), week_start_price: h.mon, entered_mid_week: false, created_at: FIXTURE_WEEK6_START }));
  const oppSnapshots = GIANLUIGI_HOLDINGS.map((h) => ({ symbol: h.symbol, quantity: fixtureQty(h), week_start_price: h.mon, entered_mid_week: false, created_at: FIXTURE_WEEK6_START }));

  const matchups = [
    ...ROBERTO_WEEKS.map((w, i) => {
      const monday = new Date(Date.UTC(2026, 6, 6 + i * 7, 13, 30));
      const friday = new Date(monday.getTime() + 4 * 24 * 3600 * 1000 + 6.5 * 3600 * 1000);
      return {
        week_number: w.week, week_start: monday.toISOString(), week_end: friday.toISOString(),
        is_playoff: false, team1_user_id: 'roberto', team2_user_id: 'gianluigi',
        team1_gain: w.gain, team2_gain: -w.gain,
      };
    }),
    {
      week_number: 6, week_start: FIXTURE_WEEK6_START, week_end: FIXTURE_WEEK6_END,
      is_playoff: false, team1_user_id: 'roberto', team2_user_id: 'gianluigi',
      team1_gain: null, team2_gain: null,
    },
  ];

  const data: GetHomeLeagueResult = {
    my_ledger: { drafts: myDrafts, trades: [] },
    current_week: { week_number: 6, my_snapshots: mySnapshots, my_trades: [], opponent_snapshots: oppSnapshots, opponent_trades: [] },
    matchups,
    standings: [
      { user_id: 'roberto', rank: 2, wins: 4, losses: 1, ties: 0, points_for: 129.99, display_name: 'Roberto B.', is_bot: false },
      { user_id: 'paolo', rank: 1, wins: 5, losses: 0, ties: 0, points_for: 512.4, display_name: 'Paolo M.', is_bot: false },
      { user_id: 'gianluigi', rank: 6, wins: 1, losses: 4, ties: 0, points_for: -142.35, display_name: 'Gianluigi B.', is_bot: false },
    ],
  };

  const meta: HomeLeagueMeta = {
    myUserId: 'roberto', draftStatus: 'completed', leagueStartDate: '2026-08-01T00:00:00Z',
    seasonStatus: 'active', currentWeek: FIXTURE_LEAGUE.currentWeek, numWeeks: FIXTURE_LEAGUE.numWeeks,
    playoffTeams: FIXTURE_LEAGUE.playoffTeams, stakeMode: FIXTURE_LEAGUE.stakeMode,
    notionalPerSlot: FIXTURE_LEAGUE.notionalPerSlot, numRounds: FIXTURE_LEAGUE.numRounds,
    draftOrderWaiting: false, hasLaterPlayoffRow: false, lastPlayoffLoss: false,
  };

  const quote = (sym: string) =>
    ROBERTO_HOLDINGS.find((h) => h.symbol === sym)?.thu ?? GIANLUIGI_HOLDINGS.find((h) => h.symbol === sym)?.thu ?? null;

  const bars: BarsBySymbol = {};
  for (const h of ROBERTO_HOLDINGS) {
    bars[h.symbol] = [{ date: '2026-09-21', close: h.mon }, { date: '2026-09-24', close: h.thu }];
  }

  return { data, meta, quote, bars };
}

export function useHomeLeague(leagueId: string | null): UseHomeLeagueResult {
  const { user } = useAuth();
  const { leagues, homeSummaryByLeague, market } = useLeagueContext();
  const [status, setStatus] = useState<HomeLeagueStatus>('loading');
  const [viewModel, setViewModel] = useState<HomeViewModel | null>(null);
  const [summary, setSummary] = useState<HomeSummaryRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One cache entry per league, so switching leagues (H5) can crossfade
  // onto already-fetched data instead of a blank loading flash.
  const cacheRef = useRef<Map<string, HomeViewModel>>(new Map());

  const fetchLive = useCallback(async () => {
    if (!leagueId || !user?.id) {
      setStatus('no-league');
      return;
    }

    if (HOME_FIXTURE) {
      const { data, meta, quote, bars } = fixtureHomeLeague();
      const vm = buildHomeViewModel({
        now: new Date(), meta, market: { status: 'open', reason: 'regular_session', nextOpenAt: null },
        data, quote, bars, playoffRoundLabelForWeek,
      });
      setViewModel(vm);
      setStatus('ready');
      return;
    }

    const league = leagues.find((l) => l.id === leagueId);
    const summary = homeSummaryByLeague.get(leagueId);
    if (!league || !summary) {
      setStatus('no-league');
      return;
    }

    setStatus((prev) => (cacheRef.current.has(leagueId) ? prev : 'loading'));

    let requestCount = 0;
    const { data: homeLeagueData, error: homeLeagueError } = await supabase.rpc('get_home_league', { p_league_id: leagueId });
    requestCount += 1;
    if (homeLeagueError || !homeLeagueData) {
      console.warn('[home] get_home_league failed', homeLeagueError?.message);
      setError(homeLeagueError?.message ?? 'Could not load this league.');
      setStatus('error');
      return;
    }
    const data = homeLeagueData as GetHomeLeagueResult;

    const symbols = Array.from(new Set([
      ...data.my_ledger.drafts.map((d) => d.symbol),
      ...data.current_week.my_snapshots.map((s) => s.symbol),
      ...data.current_week.opponent_snapshots.map((s) => s.symbol),
    ]));

    let quotePrices: Record<string, number> = {};
    if (symbols.length > 0) {
      const { data: quoteData, error: quoteError } = await supabase.functions.invoke('quote', { body: { symbols } });
      requestCount += 1;
      if (quoteError) console.warn('[home] quote failed', quoteError.message);
      else quotePrices = quoteData?.prices ?? {};
    }

    let bars: BarsBySymbol = {};
    if (symbols.length > 0) {
      const weekStart = data.matchups.find((m) => m.week_number === league.current_week)?.week_start;
      const startDate = weekStart ? weekStart.slice(0, 10) : new Date().toISOString().slice(0, 10);
      const { data: barsData, error: barsError } = await supabase.functions.invoke('historical-bars', {
        body: { symbols, start: startDate },
      });
      requestCount += 1;
      if (barsError) console.warn('[home] historical-bars failed', barsError.message);
      else {
        // historical-bars' response shape: { bars: { SYMBOL: [{t, c}, ...] } }
        const rawBars = (barsData?.bars ?? {}) as Record<string, { t: string; c: number }[]>;
        for (const [sym, series] of Object.entries(rawBars)) {
          bars[sym] = series.map((b) => ({ date: b.t.slice(0, 10), close: b.c }));
        }
      }
    }

    if (__DEV__) console.log(`[home] ${requestCount} requests (get_home_league, quote, historical-bars) + summary already fetched`);

    const meta: HomeLeagueMeta = {
      myUserId: user.id,
      draftStatus: league.draft_status, leagueStartDate: league.league_start_date,
      seasonStatus: league.season_status, currentWeek: league.current_week, numWeeks: league.num_weeks,
      playoffTeams: league.playoff_teams, stakeMode: league.stake_mode,
      notionalPerSlot: league.notional_per_slot, numRounds: league.num_rounds,
      // Per-state extras (draft order, playoff bracket) are fetched by the
      // specific phase card that needs them, not here — see module doc.
      draftOrderWaiting: false, hasLaterPlayoffRow: false, lastPlayoffLoss: false,
    };

    const vm = buildHomeViewModel({
      now: new Date(), meta, market: toMarketInfo(market), data,
      quote: (sym: string) => quotePrices[sym] ?? null,
      bars, playoffRoundLabelForWeek,
    });

    cacheRef.current.set(leagueId, vm);
    setViewModel(vm);
    setSummary(summary);
    setStatus('ready');
    setError(null);
  }, [leagueId, user?.id, leagues, homeSummaryByLeague, market]);

  useEffect(() => {
    // Serve the cached view instantly on a league switch (H5), then
    // refetch in the background.
    if (leagueId && cacheRef.current.has(leagueId)) {
      setViewModel(cacheRef.current.get(leagueId)!);
      setStatus('ready');
    }
    fetchLive();
  }, [fetchLive, leagueId]);

  return { status, viewModel, summary, error, refresh: fetchLive };
}
