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
import { standardWeekSessions, type MarketCalendarSession } from './marketWeek';
import {
  HOME_FIXTURE,
  ROBERTO_HOLDINGS,
  GIANLUIGI_HOLDINGS,
  ROBERTO_WEEKS,
  FIXTURE_LEAGUE,
  FIXTURE_WEEK6_START,
  FIXTURE_WEEK6_END,
  fixtureQty,
  isDraftingFixture,
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
 * Supabase or from the board's sample numbers.
 *
 * Varies per `EXPO_PUBLIC_HOME_FIXTURE` state (code review, 2026-09-29:
 * this used to render `live_open` for all 14 declared fixture values,
 * silently — Task 11's per-state captures need each state reachable). */
function cents(v: number): number {
  return Math.round(v * 100) / 100;
}

function fixtureHomeLeague(fixture: import('./devFixture').HomeFixture | null): {
  data: GetHomeLeagueResult; meta: HomeLeagueMeta; market: MarketInfo; now: Date;
  quote: (s: string) => number | null; bars: BarsBySymbol; marketCalendar: MarketCalendarSession[];
} {
  const myDrafts = ROBERTO_HOLDINGS.map((h) => ({ symbol: h.symbol, entry_price: h.draft, quantity: fixtureQty(h), created_at: '2026-08-01T00:00:00Z' }));
  const mySnapshots = ROBERTO_HOLDINGS.map((h) => ({ symbol: h.symbol, quantity: fixtureQty(h), week_start_price: h.mon, entered_mid_week: false, created_at: FIXTURE_WEEK6_START }));
  const oppSnapshots = GIANLUIGI_HOLDINGS.map((h) => ({ symbol: h.symbol, quantity: fixtureQty(h), week_start_price: h.mon, entered_mid_week: false, created_at: FIXTURE_WEEK6_START }));

  const isPreSeason = fixture === 'pre_season';
  const isBye = fixture === 'bye';
  const isPlayoffLive = fixture === 'playoff_live';
  const isPlayoffBye = fixture === 'playoff_bye';
  const isEliminated = fixture === 'eliminated';
  const isMissedPlayoffs = fixture === 'missed_playoffs';
  const isPlayoffState = isPlayoffLive || isPlayoffBye || isEliminated || isMissedPlayoffs;
  // B7 bullet 3 (Orchestrator, 2026-09-30): the regular season a playoff
  // fixture builds on must match `numWeeks`, or the season chart shows a
  // flat plateau for every week between the real history and numWeeks
  // (found in the capture pass: numWeeks stayed 14 while only 6 weeks of
  // history existed). Derived from the fixture's OWN history length
  // (regularSeasonWeeks + week6), never hard-coded, so it can't drift from
  // the data again. Also covers 'complete'/'complete_runner_up': a
  // finished season is, by definition, the same 6-week history.
  const regularSeasonComplete = isPlayoffState || fixture === 'complete' || fixture === 'complete_runner_up';
  // ROBERTO_WEEKS (1..5) + week6 -- derived, never hard-coded (see doc above).
  const playoffNumWeeks = ROBERTO_WEEKS.length + 1;
  // Every playoff-family (and complete-family) fixture happens
  // chronologically AFTER the regular season concluded, so week 6 (and
  // every earlier week) is necessarily already scored by then -- never
  // the live/unscored shape.
  const isScored = fixture === 'scored' || regularSeasonComplete;
  const week6Gains = isScored
    ? { team1_gain: cents(ROBERTO_HOLDINGS.reduce((s, h) => s + fixtureQty(h) * (h.fri - h.mon), 0)), team2_gain: cents(GIANLUIGI_HOLDINGS.reduce((s, h) => s + fixtureQty(h) * (h.fri - h.mon), 0)) }
    : { team1_gain: null, team2_gain: null };

  const week6 = {
    week_number: 6, week_start: FIXTURE_WEEK6_START, week_end: FIXTURE_WEEK6_END,
    is_playoff: false,
    team1_user_id: 'roberto',
    team2_user_id: isBye ? null : 'gianluigi',
    ...(isBye ? { team1_gain: null, team2_gain: null } : week6Gains),
  };

  // S2 (Design Lead, 2026-09-30): a real week 7 row -- the whole season's
  // schedule is generated at draft completion (B3), so week 7 is already
  // known (just ungained) the moment week 6 closes. Only 'scored' and
  // 'bye' read this (via nextWeekStart, see homePhase.ts's own doc) --
  // every other regular-season fixture hasn't reached week 6's close yet.
  const week7 = {
    week_number: 7, week_start: '2026-09-28T09:30:00.000-04:00', week_end: '2026-10-02T16:00:00.000-04:00',
    is_playoff: false, team1_user_id: 'roberto', team2_user_id: 'gianluigi',
    team1_gain: null, team2_gain: null,
  };

  // Playoff week numbers derived the way the backend does (Orchestrator,
  // 2026-09-30, B7 bullet 3): week = numWeeks + round -- never typed in.
  // Round 1 is the Wild Card round for a 6-team bracket (playoffPlan(6)),
  // round 2 is the Semifinals; see tests-deno/playoffs.test.ts's proof
  // that this gives IDENTICAL round labels regardless of numWeeks.
  const round1Week = playoffNumWeeks + 1;
  const round2Week = playoffNumWeeks + 2;

  // Wild-card week: a real, live game with a decided opponent. Populated
  // with real playoff-week snapshots when isPlayoffLive (Design Lead
  // ruling, 2026-09-30: "a $0 vs $0 playoff isn't a useful capture"), so
  // the tug and scores show real numbers.
  const wildCardWeek = {
    week_number: round1Week, week_start: '2026-12-14T13:30:00.000Z', week_end: '2026-12-18T20:00:00.000Z',
    is_playoff: true, team1_user_id: 'roberto', team2_user_id: 'gianluigi',
    team1_gain: null, team2_gain: null,
  };

  // Eliminated: the lost round is the ONLY playoff row that exists at
  // all -- no row at the (later) current week, matching a team with no
  // later playoff row and no current one either (Design Lead ruling,
  // 2026-09-30, case c). Lost in round 1 (Wild Card), same as wildCardWeek.
  const lostSemifinalWeek = {
    week_number: round1Week, week_start: '2026-12-14T13:30:00.000Z', week_end: '2026-12-18T20:00:00.000Z',
    is_playoff: true, team1_user_id: 'roberto', team2_user_id: 'gianluigi',
    team1_gain: -10, team2_gain: 40,
  };

  // A first-round bye seed (Design Lead ruling, 2026-09-30): the real
  // bracket shape has NO row for me at the wild-card week at all -- the
  // bye is written straight into its round-2 row instead, opponent NULL
  // until round 1 is scored.
  const round2ByeWeek = {
    week_number: round2Week, week_start: '2026-12-21T13:30:00.000Z', week_end: '2026-12-25T20:00:00.000Z',
    is_playoff: true, team1_user_id: 'roberto', team2_user_id: null,
    team1_gain: null, team2_gain: null,
  };

  const regularSeasonWeeks = ROBERTO_WEEKS.map((w, i) => {
    const monday = new Date(Date.UTC(2026, 6, 6 + i * 7, 13, 30));
    const friday = new Date(monday.getTime() + 4 * 24 * 3600 * 1000 + 6.5 * 3600 * 1000);
    return {
      week_number: w.week, week_start: monday.toISOString(), week_end: friday.toISOString(),
      is_playoff: false, team1_user_id: 'roberto', team2_user_id: 'gianluigi',
      team1_gain: w.gain, team2_gain: -w.gain,
    };
  });

  // B3 (Design Lead, 2026-09-30): the whole schedule is generated at draft
  // completion (finalize_league_draft), before the season itself starts --
  // week 1's matchup row (opponent, dates) is already real and knowable
  // pre-season, just ungained. An empty matchups array was a fixture
  // fiction that made the opponent unresolvable and forced the board's
  // scoreboard-preview card back to a generic "Opponent" placeholder.
  const preSeasonWeek1 = {
    week_number: 1, week_start: '2026-08-03T13:30:00.000Z', week_end: '2026-08-07T20:00:00.000Z',
    is_playoff: false, team1_user_id: 'roberto', team2_user_id: 'gianluigi',
    team1_gain: null, team2_gain: null,
  };

  const matchups = isPreSeason
    ? [preSeasonWeek1]
    // Every OTHER state below reached the playoffs at all, which requires
    // a real, fully-scored regular season to have happened first -- the
    // Standings' real win/loss record and the Season chart's history are
    // never optional just because the CURRENT week is a playoff week
    // (found in the capture pass, 2026-09-30: the chart was flat/empty
    // for playoff_bye/eliminated/playoff_live despite "4-1" showing right
    // above it -- the same partial-state family as the pre_season/
    // missed_playoffs fixes above).
    : isMissedPlayoffs
      ? [...regularSeasonWeeks, week6] // the (nonexistent) playoff week is the only thing missing
      : isPlayoffBye
        ? [...regularSeasonWeeks, week6, round2ByeWeek] // no row at all for the current (wild-card) week
        : isEliminated
          ? [...regularSeasonWeeks, week6, lostSemifinalWeek] // no row at all for the current (round-2) week
          : isPlayoffLive
            ? [...regularSeasonWeeks, week6, wildCardWeek]
            // S2 (Design Lead, 2026-09-30): 'scored' and 'bye' both read
            // week 7's real start via nextWeekStart (homePhase.ts) --
            // every other fixture here (live_open/live_closed/scoring/
            // leader_flip/complete/complete_runner_up) never reaches a
            // code path that looks past week 6, so adding it for them too
            // would be inert but untested; scoped to just the two states
            // that need it.
            : fixture === 'scored' || isBye
              ? [...regularSeasonWeeks, week6, week7]
              : [...regularSeasonWeeks, week6];

  // currentWeek differs per playoff sub-state (Design Lead ruling,
  // 2026-09-30): a bye/live game is IN the wild-card week; eliminated is
  // read the week AFTER the lost round, since there is by definition no
  // row at all for me at the current week once I'm out.
  const playoffCurrentWeek = isEliminated ? round2Week : round1Week;

  const data: GetHomeLeagueResult = {
    my_ledger: { drafts: myDrafts, trades: [] },
    current_week: {
      week_number: isPlayoffState ? playoffCurrentWeek : isPreSeason ? 1 : 6,
      my_snapshots: isBye || isPreSeason || isEliminated || isMissedPlayoffs || isPlayoffBye ? [] : mySnapshots,
      my_trades: [],
      opponent_snapshots: isBye || isPreSeason || isEliminated || isMissedPlayoffs || isPlayoffBye ? [] : oppSnapshots,
      opponent_trades: [],
    },
    matchups,
    standings: isPreSeason
      ? [
          { user_id: 'roberto', rank: 1, wins: 0, losses: 0, ties: 0, points_for: 0, display_name: 'Roberto B.', is_bot: false },
          { user_id: 'paolo', rank: 2, wins: 0, losses: 0, ties: 0, points_for: 0, display_name: 'Paolo M.', is_bot: false },
          { user_id: 'gianluigi', rank: 3, wins: 0, losses: 0, ties: 0, points_for: 0, display_name: 'Gianluigi B.', is_bot: false },
        ]
      : // B2 (Design Lead, 2026-09-30): a realistic 6-manager league (the
        // board's, matching FIXTURE_LEAGUE.playoffTeams=6), IN RANK ORDER —
        // StandingsCard deliberately never re-sorts on the client (it
        // trusts SQL's league_standings_ranked), so an out-of-order fixture
        // array is exactly what rendered as "2, 1, 6" instead of "1, 2, 3".
        [
          { user_id: 'paolo', rank: 1, wins: 5, losses: 0, ties: 0, points_for: 512.4, display_name: 'Paolo M.', is_bot: false },
          // B7 bullet 3 (Orchestrator, 2026-09-30): a finished 6-week
          // regular season (regularSeasonComplete) has a 6-game record,
          // not 5 -- "4-1" stood for weeks 1-5 only, but week 6 is ALSO
          // scored (and won: team1_gain=$213.60 > team2_gain=$90.45) for
          // every one of these fixtures, so the real record is 5-1 and
          // points_for includes week 6's gain too.
          {
            user_id: 'roberto', rank: 2,
            wins: regularSeasonComplete ? 5 : 4, losses: 1, ties: 0,
            points_for: regularSeasonComplete ? cents(129.99 + (week6Gains.team1_gain ?? 0)) : 129.99,
            display_name: 'Roberto B.', is_bot: false,
          },
          { user_id: 'luca', rank: 3, wins: 3, losses: 2, ties: 0, points_for: 88.2, display_name: 'Luca V.', is_bot: false },
          { user_id: 'chiara', rank: 4, wins: 2, losses: 3, ties: 0, points_for: -34.1, display_name: 'Chiara R.', is_bot: false },
          { user_id: 'marco', rank: 5, wins: 2, losses: 3, ties: 0, points_for: -61.5, display_name: 'Marco T.', is_bot: false },
          { user_id: 'gianluigi', rank: 6, wins: 1, losses: 4, ties: 0, points_for: -142.35, display_name: 'Gianluigi B.', is_bot: false },
        ],
  };

  const draftStatus = fixture === 'pre_draft' || fixture === 'pre_draft_waiting' ? 'not_started'
    : isDraftingFixture(fixture) ? 'in_progress' : 'completed';
  const seasonStatus = fixture === 'complete' || fixture === 'complete_runner_up' ? 'completed' : isPlayoffState ? 'playoffs' : 'active';
  const currentWeek = isPlayoffState ? playoffCurrentWeek : isPreSeason ? 1 : draftStatus === 'completed' ? 6 : 1;
  // The real Monday 9:30 AM ET open (matches preSeasonWeek1.week_start
  // above) -- never a far-future placeholder, so preSeasonStartsLabel
  // reads a real, near date like the board's, not "2099".
  const leagueStartDate = fixture === 'pre_season' ? '2026-08-03T13:30:00.000Z' : '2026-08-01T00:00:00Z';

  const meta: HomeLeagueMeta = {
    myUserId: 'roberto', draftStatus, leagueStartDate,
    seasonStatus, currentWeek, numWeeks: regularSeasonComplete ? playoffNumWeeks : FIXTURE_LEAGUE.numWeeks,
    playoffTeams: FIXTURE_LEAGUE.playoffTeams, stakeMode: FIXTURE_LEAGUE.stakeMode,
    notionalPerSlot: FIXTURE_LEAGUE.notionalPerSlot, numRounds: FIXTURE_LEAGUE.numRounds,
    draftOrderWaiting: fixture === 'pre_draft_waiting',
  };

  // S1 (Design Lead, 2026-09-30): "today" must never show a fabricated
  // number. States with no live game happening right now -- results
  // already posted, no matchup this week, or the bracket still deciding
  // my next opponent -- get a non-trading reason so isTradingDay hides
  // the hero's "today" segment entirely, instead of showing "$0.00" or
  // the whole week's gain mislabeled as one day (found in the capture
  // pass: 'bye', with no matchup at all, showed "+$213.60 today"). Only
  // live_open/live_closed (and leader_flip, which shares their Thursday
  // `now`) keep a real trading day -- see the `bars` fix below for why
  // that's when todayChange has an actual previous close to diff against.
  // playoff_live is deliberately left alone: its `now` (a December
  // wild-card week) has no corresponding December price bar, and
  // changing `market.status` here would also flip its phase.kind
  // (homePhase.ts's live_open/live_closed branch reads market.status
  // directly) -- out of scope for this fix.
  const noLiveGameToday = fixture === 'scoring' || fixture === 'scored' || isBye
    || isPlayoffBye || isEliminated || isMissedPlayoffs;
  const market: MarketInfo = fixture === 'live_closed'
    ? { status: 'closed', reason: 'after_hours', nextOpenAt: '2026-09-24T13:30:00.000Z' }
    : noLiveGameToday
      ? { status: 'closed', reason: 'weekend', nextOpenAt: null }
      : { status: 'open', reason: 'regular_session', nextOpenAt: null };

  const now = fixture === 'scoring' || fixture === 'scored'
    ? new Date('2026-09-25T20:30:00.000Z') // Friday, after week_end
    : isEliminated
      ? new Date('2026-12-22T18:00:00.000Z') // into round 2's week, after the wild-card loss
      : isPlayoffState
        ? new Date('2026-12-15T18:00:00.000Z')
        : isPreSeason
          ? new Date('2026-07-30T14:00:00.000Z') // Thursday, a few days before leagueStartDate
          : new Date('2026-09-24T17:37:00.000Z'); // Thursday 1:37 PM ET, the board's live moment

  // leader_flip: a call-counter alternates whose price is higher, to
  // exercise H3's leader-change wash under the live poll.
  let flipCall = 0;
  const quote = (sym: string) => {
    if (fixture === 'leader_flip') {
      flipCall += 1;
      const flipped = flipCall % 2 === 0;
      const rows = flipped ? GIANLUIGI_HOLDINGS : ROBERTO_HOLDINGS;
      const mine = ROBERTO_HOLDINGS.find((h) => h.symbol === sym);
      const theirs = GIANLUIGI_HOLDINGS.find((h) => h.symbol === sym);
      if (mine) return flipped ? mine.mon : mine.thu; // my side goes flat when "flipped" (opponent leads)
      if (theirs) return flipped ? theirs.thu * 1.5 : theirs.mon; // opponent surges when "flipped"
      return null;
    }
    return ROBERTO_HOLDINGS.find((h) => h.symbol === sym)?.thu ?? GIANLUIGI_HOLDINGS.find((h) => h.symbol === sym)?.thu ?? null;
  };

  const bars: BarsBySymbol = {};
  for (const h of ROBERTO_HOLDINGS) {
    // S1 (Design Lead, 2026-09-30): must be in ascending date order --
    // prevCloseFor takes the LAST entry strictly before "today", so an
    // out-of-order array (this used to list a stray '09-18' bar, a full
    // week earlier, ahead of Monday's) silently skips straight to
    // Monday's open as "yesterday". Monday -> Wednesday (h.prev) ->
    // Thursday (h.thu, "now" for every live fixture) gives todayChange a
    // real Wednesday-to-Thursday close to diff, instead of reporting the
    // whole week's move as "today" (found in the capture pass:
    // live_open's today equalled its own season gain, $213.60).
    bars[h.symbol] = [{ date: '2026-09-21', close: h.mon }, { date: '2026-09-23', close: h.prev }, { date: '2026-09-24', close: h.thu }];
  }
  for (const h of GIANLUIGI_HOLDINGS) {
    // Same ascending-date fix as ROBERTO_HOLDINGS above, for consistency
    // (not currently read by todayChange, which only sees my own symbols).
    bars[h.symbol] = bars[h.symbol] ?? [{ date: '2026-09-21', close: h.mon }, { date: '2026-09-23', close: h.prev }, { date: '2026-09-24', close: h.thu }];
  }

  // B1 (Design Lead, 2026-09-30): a standard no-holiday Mon-Fri week for
  // every distinct week this fixture's matchups touch, so captures also
  // exercise the real resolveWeekWindow path rather than falling back to
  // the (known-wrong) nominal timestamps for lack of any calendar rows.
  const marketCalendar: MarketCalendarSession[] = matchups.flatMap((m) => standardWeekSessions(m.week_end));

  return { data, meta, market, now, quote, bars, marketCalendar };
}

export function useHomeLeague(leagueId: string | null): UseHomeLeagueResult {
  const { user } = useAuth();
  const { leagues, homeSummaryByLeague, market, marketCalendar } = useLeagueContext();
  const [status, setStatus] = useState<HomeLeagueStatus>('loading');
  const [viewModel, setViewModel] = useState<HomeViewModel | null>(null);
  const [summary, setSummary] = useState<HomeSummaryRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One cache entry per league, so switching leagues (H5) can crossfade
  // onto already-fetched data instead of a blank loading flash.
  const cacheRef = useRef<Map<string, HomeViewModel>>(new Map());
  // Staleness guard (code review, 2026-09-29): switching leagues quickly
  // had no cancellation, so a slow response for league A could land
  // AFTER a newer request for league B started, silently overwriting B's
  // view with A's data. Every setter below checks this before writing.
  const requestedLeagueRef = useRef<string | null>(null);

  const fetchLive = useCallback(async () => {
    requestedLeagueRef.current = leagueId;
    const isStale = () => requestedLeagueRef.current !== leagueId;

    if (!leagueId || !user?.id) {
      if (!isStale()) setStatus('no-league');
      return;
    }

    if (HOME_FIXTURE) {
      const { data, meta, market: fixtureMarket, now: fixtureNow, quote, bars, marketCalendar: fixtureMarketCalendar } = fixtureHomeLeague(HOME_FIXTURE);
      const vm = buildHomeViewModel({
        now: fixtureNow, meta, market: fixtureMarket,
        data, quote, bars, playoffRoundLabelForWeek, marketCalendar: fixtureMarketCalendar,
      });
      if (!isStale()) {
        setViewModel(vm);
        setStatus('ready');
      }
      return;
    }

    const league = leagues.find((l) => l.id === leagueId);
    const summary = homeSummaryByLeague.get(leagueId);
    if (!league || !summary) {
      if (!isStale()) setStatus('no-league');
      return;
    }

    if (!isStale()) setStatus((prev) => (cacheRef.current.has(leagueId) ? prev : 'loading'));

    let requestCount = 0;
    const { data: homeLeagueData, error: homeLeagueError } = await supabase.rpc('get_home_league', { p_league_id: leagueId });
    requestCount += 1;
    if (homeLeagueError || !homeLeagueData) {
      console.warn('[home] get_home_league failed', homeLeagueError?.message);
      if (!isStale()) {
        setError(homeLeagueError?.message ?? 'Could not load this league.');
        setStatus('error');
      }
      return;
    }
    const data = homeLeagueData as GetHomeLeagueResult;

    // Every symbol either side could hold or have traded THIS WEEK — a
    // mid-week buy of a symbol with no Monday snapshot row was missing
    // from this list (code review, 2026-09-29), so `quote` never priced
    // it and liveWeekScore silently dropped that position's gain.
    const symbols = Array.from(new Set([
      ...data.my_ledger.drafts.map((d) => d.symbol),
      ...data.my_ledger.trades.map((t) => t.symbol),
      ...data.current_week.my_snapshots.map((s) => s.symbol),
      ...data.current_week.my_trades.map((t) => t.symbol),
      ...data.current_week.opponent_snapshots.map((s) => s.symbol),
      ...data.current_week.opponent_trades.map((t) => t.symbol),
    ].filter((s) => s?.toUpperCase() !== 'SKIP')));

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
      // 6 calendar days before Monday's open, not Monday's own date — so
      // there's always at least one earlier bar to serve as Monday's own
      // `prevClose` (code review, 2026-09-29: starting exactly AT
      // week_start left "today" on Monday with no prior bar in range,
      // showing +$0.00 every Monday regardless of the real move).
      const anchor = weekStart ? new Date(weekStart) : new Date();
      anchor.setUTCDate(anchor.getUTCDate() - 6);
      const startDate = anchor.toISOString().slice(0, 10);
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
      // Draft-order-waiting is a per-state extra (fetched by the pre_draft
      // card itself). The two playoff flags are NOT extras — they're
      // derived inside buildHomeViewModel from `data.matchups` (code
      // review, 2026-09-29: hardcoding them false here meant every bye/
      // eliminated/missed-playoffs team read as "before the season").
      draftOrderWaiting: false,
    };

    const vm = buildHomeViewModel({
      now: new Date(), meta, market: toMarketInfo(market), data,
      quote: (sym: string) => quotePrices[sym] ?? null,
      bars, playoffRoundLabelForWeek, marketCalendar,
    });

    cacheRef.current.set(leagueId, vm);
    if (isStale()) return; // a newer league switch has already superseded this response
    setViewModel(vm);
    setSummary(summary);
    setStatus('ready');
    setError(null);
  }, [leagueId, user?.id, leagues, homeSummaryByLeague, market, marketCalendar]);

  useEffect(() => {
    // Serve the cached view instantly on a league switch (H5), then
    // refetch in the background.
    if (leagueId && cacheRef.current.has(leagueId)) {
      setViewModel(cacheRef.current.get(leagueId)!);
      setStatus('ready');
    }
    fetchLive();
  }, [fetchLive, leagueId]);

  // Live poll (code review, 2026-09-29: there was none — Home never
  // refreshed on its own, so H1/H3's rolls and the live->scoring->scored
  // transition never played without a manual pull-to-refresh). Only
  // while the market is actually open for this league's current week —
  // no point polling a closed market or an already-scored week.
  const isLiveOpen = viewModel?.phase.kind === 'live_open';
  useEffect(() => {
    if (!isLiveOpen) return;
    const id = setInterval(() => {
      fetchLive();
    }, 30_000);
    return () => clearInterval(id);
  }, [isLiveOpen, fetchLive]);

  return { status, viewModel, summary, error, refresh: fetchLive };
}
