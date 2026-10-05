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
import { standardWeekSessions, type MarketCalendarSession } from '../time/marketWeek';
import {
  HOME_FIXTURE,
  ROBERTO_HOLDINGS,
  GIANLUIGI_HOLDINGS,
  ROBERTO_WEEKS,
  XL_LEAGUE,
  XL_ROBERTO_HOLDINGS,
  XL_GIANLUIGI_HOLDINGS,
  XL_ROBERTO_WEEKS,
  FIXTURE_LEAGUE,
  FIXTURE_WEEK6_START,
  FIXTURE_WEEK6_END,
  fixtureQty,
  isDraftingFixture,
} from './devFixture';

export type HomeLeagueStatus = 'loading' | 'ready' | 'error' | 'no-league';

/** The raw inputs the view model was built from (3c Matchup reads the same
 * ledgers, quotes and bars, so its live score is Home's by construction). */
export interface HomeRawInputs {
  data: GetHomeLeagueResult;
  quote: (symbol: string) => number | null;
  bars: BarsBySymbol;
  marketCalendar: MarketCalendarSession[];
  now: Date;
}

export interface UseHomeLeagueResult {
  status: HomeLeagueStatus;
  viewModel: HomeViewModel | null;
  /** The inputs behind `viewModel`, or null while loading (3c). */
  raw: HomeRawInputs | null;
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

// leader_flip's call-counter -- module-scoped, not local to
// fixtureHomeLeague (see that function's own doc on `quote`'s
// 'leader_flip' branch for why: a function-local counter reset every
// poll, so the two fixture states were never actually reachable from a
// live refresh).
let leaderFlipCall = 0;

/** XL league standings (see homeFixtureData.ts): Roberto leads on his
 * scored +$15,235.76, so the standard fixture's ranks (Paolo first) would
 * contradict the hero. Ordered by points, as league_standings_ranked
 * returns them. Gianluigi's points are his mirrored scored weeks. */
const XL_STANDINGS: GetHomeLeagueResult['standings'] = [
  { user_id: 'roberto', rank: 1, wins: 4, losses: 1, ties: 0, points_for: 15235.76, display_name: 'Roberto B.', is_bot: false },
  { user_id: 'paolo', rank: 2, wins: 3, losses: 2, ties: 0, points_for: 9120.44, display_name: 'Paolo M.', is_bot: false },
  { user_id: 'luca', rank: 3, wins: 3, losses: 2, ties: 0, points_for: 4280.1, display_name: 'Luca V.', is_bot: false },
  { user_id: 'marco', rank: 4, wins: 2, losses: 3, ties: 0, points_for: -980.25, display_name: 'Marco T.', is_bot: false },
  { user_id: 'chiara', rank: 5, wins: 2, losses: 3, ties: 0, points_for: -2215.3, display_name: 'Chiara R.', is_bot: false },
  { user_id: 'gianluigi', rank: 6, wins: 1, losses: 4, ties: 0, points_for: -15235.76, display_name: 'Gianluigi B.', is_bot: false },
];

function fixtureHomeLeague(fixture: import('./devFixture').HomeFixture | null): {
  data: GetHomeLeagueResult; meta: HomeLeagueMeta; market: MarketInfo; now: Date;
  quote: (s: string) => number | null; bars: BarsBySymbol; marketCalendar: MarketCalendarSession[];
} {
  // XL capture (2026-10-05): its own $100k roster, weeks and league; every
  // other fixture keeps the board sample exactly as before.
  const isXL = fixture === 'xl_large_numbers';
  const robRows = isXL ? XL_ROBERTO_HOLDINGS : ROBERTO_HOLDINGS;
  const giaRows = isXL ? XL_GIANLUIGI_HOLDINGS : GIANLUIGI_HOLDINGS;
  const robWeeks = isXL ? XL_ROBERTO_WEEKS : ROBERTO_WEEKS;
  const myDrafts = robRows.map((h) => ({ symbol: h.symbol, entry_price: h.draft, quantity: fixtureQty(h), created_at: '2026-08-01T00:00:00Z' }));
  const mySnapshots = robRows.map((h) => ({ symbol: h.symbol, quantity: fixtureQty(h), week_start_price: h.mon, entered_mid_week: false, created_at: FIXTURE_WEEK6_START }));
  const oppSnapshots = giaRows.map((h) => ({ symbol: h.symbol, quantity: fixtureQty(h), week_start_price: h.mon, entered_mid_week: false, created_at: FIXTURE_WEEK6_START }));

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
  // robWeeks (1..5) + week6 -- derived, never hard-coded (see doc above).
  const playoffNumWeeks = robWeeks.length + 1;
  // Every playoff-family (and complete-family) fixture happens
  // chronologically AFTER the regular season concluded, so week 6 (and
  // every earlier week) is necessarily already scored by then -- never
  // the live/unscored shape.
  const isScored = fixture === 'scored' || regularSeasonComplete;
  const week6Gains = isScored
    ? { team1_gain: cents(robRows.reduce((s, h) => s + fixtureQty(h) * (h.fri - h.mon), 0)), team2_gain: cents(giaRows.reduce((s, h) => s + fixtureQty(h) * (h.fri - h.mon), 0)) }
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

  const regularSeasonWeeks = robWeeks.map((w, i) => {
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
    standings: isXL ? XL_STANDINGS : isPreSeason
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
          // R4 (Design Lead, 2026-09-30): the SAME regularSeasonComplete
          // bump B7 bullet 3 already gave Roberto's record must apply to
          // EVERY manager -- "Paolo 5-0" (weeks 1-5 only) stayed frozen
          // through week 6 even once the fixture claims a finished 6-week
          // season. Gianluigi's week 6 is REAL (he's Roberto's own
          // opponent, so his result is the mirror of week6Gains); the
          // other three have no tracked week-6 matchup at all, so their
          // 6th game is a plausible extension of their existing pace --
          // never invented as PRECISELY as Roberto/Gianluigi's real gain.
          {
            user_id: 'paolo', rank: 1,
            wins: regularSeasonComplete ? 6 : 5, losses: 0, ties: 0,
            points_for: regularSeasonComplete ? cents(512.4 + 102.48) : 512.4,
            display_name: 'Paolo M.', is_bot: false,
          },
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
          {
            user_id: 'luca', rank: 3,
            wins: regularSeasonComplete ? 4 : 3, losses: regularSeasonComplete ? 2 : 2, ties: 0,
            points_for: regularSeasonComplete ? cents(88.2 + 44.1) : 88.2,
            display_name: 'Luca V.', is_bot: false,
          },
          {
            user_id: 'chiara', rank: 4,
            wins: 2, losses: regularSeasonComplete ? 4 : 3, ties: 0,
            points_for: regularSeasonComplete ? cents(-34.1 - 17.05) : -34.1,
            display_name: 'Chiara R.', is_bot: false,
          },
          {
            user_id: 'marco', rank: 5,
            wins: 2, losses: regularSeasonComplete ? 4 : 3, ties: 0,
            points_for: regularSeasonComplete ? cents(-61.5 - 30.75) : -61.5,
            display_name: 'Marco T.', is_bot: false,
          },
          {
            user_id: 'gianluigi', rank: 6,
            wins: 1, losses: regularSeasonComplete ? 5 : 4, ties: 0,
            points_for: regularSeasonComplete ? cents(-142.35 + (week6Gains.team2_gain ?? 0)) : -142.35,
            display_name: 'Gianluigi B.', is_bot: false,
          },
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
    notionalPerSlot: isXL ? XL_LEAGUE.notionalPerSlot : FIXTURE_LEAGUE.notionalPerSlot, numRounds: isXL ? XL_LEAGUE.numRounds : FIXTURE_LEAGUE.numRounds,
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
    // R2 (Design Lead, 2026-09-30): resumes FRIDAY 9:30 AM ET -- paired
    // with `now` below (Thursday 8 PM, after Thursday's own close).
    // Previously read Thursday 9:30 AM, which is BEFORE `now` and would
    // claim the market "resumes" at a time already in the past.
    ? { status: 'closed', reason: 'after_hours', nextOpenAt: '2026-09-25T13:30:00.000Z' }
    : noLiveGameToday
      ? { status: 'closed', reason: 'weekend', nextOpenAt: null }
      : { status: 'open', reason: 'regular_session', nextOpenAt: null };

  const now = fixture === 'scoring' || fixture === 'scored'
    ? new Date('2026-09-25T20:30:00.000Z') // Friday, after week_end
    // R2 (Design Lead, 2026-09-30): Thursday 8 PM ET -- AFTER Thursday's
    // own 4 PM close, so "…at Thursday's close" (lastSessionCloseBefore)
    // names the day that's actually just closed. Previously reused
    // live_open's Thursday 1:37 PM (mid-session, market hours 9:30-4) --
    // internally inconsistent with claiming the market was closed.
    : fixture === 'live_closed'
      ? new Date('2026-09-25T00:00:00.000Z')
      : isEliminated
        ? new Date('2026-12-22T18:00:00.000Z') // into round 2's week, after the wild-card loss
        : isPlayoffState
          ? new Date('2026-12-15T18:00:00.000Z')
          : isPreSeason
            ? new Date('2026-07-30T14:00:00.000Z') // Thursday, a few days before leagueStartDate
            : new Date('2026-09-24T17:37:00.000Z'); // Thursday 1:37 PM ET, the board's live moment

  // leader_flip: a call-counter alternates whose price is higher, to
  // exercise H3's leader-change wash under the live poll. Module-scoped
  // (B8 capture pass, 2026-09-30), not local to this function: `fetchLive`
  // calls `fixtureHomeLeague` fresh on every poll, so a function-local
  // counter reset to 0 every time and the two fixture states were never
  // actually reachable from a poll -- every fetch replayed the identical
  // call sequence, contradicting this comment's own "under the live poll"
  // (found while trying to actually record H3 for the capture pass).
  //
  // Incremented ONCE per fixtureHomeLeague call (i.e. once per poll), not
  // once per `quote()` call: `quote` runs several times per symbol per
  // fetch (today's change, the week's live gain, team value, ...), so a
  // per-call counter both (a) let different symbols land on different
  // sides of the flip WITHIN the same render -- never a clean, all-or-
  // nothing "who's ahead" -- and (b) if that per-fetch call count happens
  // to be even, cancels out over a full fetch, so successive polls could
  // replay the exact same parity forever despite the counter genuinely
  // advancing. One decision per fetch avoids both.
  leaderFlipCall += 1;
  const leaderFlipFlipped = leaderFlipCall % 2 === 0;
  const quote = (sym: string) => {
    // A holding with no live price (XL's PLTR) counts at cost, never a quote.
    if (robRows.find((h) => h.symbol === sym)?.unpriced) return null;
    if (fixture === 'leader_flip') {
      const flipped = leaderFlipFlipped;
      const mine = robRows.find((h) => h.symbol === sym);
      const theirs = giaRows.find((h) => h.symbol === sym);
      // S5 (Design Lead, 2026-09-30): "flipped" used to zero my side out
      // entirely (mon -- no gain at all) while surging theirs 50% off
      // Thursday's close, an aggregate move worth thousands of dollars in
      // a single week ("a $3,123 week reads as a bug"). Replaced with a
      // partial pullback on my side (I keep ~77% of my real week's move,
      // $163.40) and a real-but-larger move on theirs (~1.9x its real
      // week's move, $170.94) -- both ordinary-looking weekly swings,
      // landing within a few cents of the board's own example (+$163.40
      // vs +$171.02), that genuinely flip who's ahead.
      if (mine) return flipped ? mine.mon + 0.765 * (mine.thu - mine.mon) : mine.thu;
      if (theirs) return flipped ? theirs.mon + 1.89 * (theirs.thu - theirs.mon) : theirs.mon;
      return null;
    }
    // R4 (Design Lead, 2026-09-30): pre-season has to price at the DRAFT
    // itself -- nothing has happened yet, so "value" is cost basis, not a
    // future Thursday close that hasn't occurred. Priced at draft, the
    // hero is exactly $12,000.00 (qty = notional/draft, so qty*draft sums
    // to the flat notional for every holding); priced at `thu` like every
    // other fixture, it silently leaked a future price into a state that
    // shouldn't know it yet, showing $12,343.51 -- the same number every
    // OTHER (live) state shows.
    if (isPreSeason) {
      return robRows.find((h) => h.symbol === sym)?.draft ?? giaRows.find((h) => h.symbol === sym)?.draft ?? null;
    }
    return robRows.find((h) => h.symbol === sym)?.thu ?? giaRows.find((h) => h.symbol === sym)?.thu ?? null;
  };

  const bars: BarsBySymbol = {};
  for (const h of robRows) {
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
    // S10 (Design Lead, 2026-09-30): playoff_live's `now` (Tue Dec 15, the
    // wild-card week) is nowhere near these September dates, so
    // prevCloseFor fell through to Thursday's close as "yesterday" and
    // quote() (also Thursday's close, unchanged for a non-leader_flip
    // fixture) gave today = 0 -- a fabricated $0.00 on a genuinely live
    // playoff week. Appended (stays ascending: Dec > Sep) so prevCloseFor
    // finds the wild-card week's own Monday close as "yesterday" for a
    // Tuesday `now`, giving a real, nonzero today (the same total as the
    // week's live gain so far -- correct for the week's second day).
    if (isPlayoffLive) bars[h.symbol].push({ date: '2026-12-14', close: h.mon });
  }
  for (const h of giaRows) {
    // Same ascending-date fix as robRows above, for consistency
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
  const [raw, setRaw] = useState<HomeRawInputs | null>(null);
  const [summary, setSummary] = useState<HomeSummaryRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One cache entry per league, so switching leagues (H5) can crossfade
  // onto already-fetched data instead of a blank loading flash.
  const cacheRef = useRef<Map<string, HomeViewModel>>(new Map());
  const rawCacheRef = useRef<Map<string, HomeRawInputs>>(new Map());
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
        setRaw({ data, quote, bars, marketCalendar: fixtureMarketCalendar, now: fixtureNow });
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

    const rawInputs: HomeRawInputs = { data, quote: (sym: string) => quotePrices[sym] ?? null, bars, marketCalendar, now: new Date() };
    cacheRef.current.set(leagueId, vm);
    rawCacheRef.current.set(leagueId, rawInputs);
    if (isStale()) return; // a newer league switch has already superseded this response
    setViewModel(vm);
    setRaw(rawInputs);
    setSummary(summary);
    setStatus('ready');
    setError(null);
  }, [leagueId, user?.id, leagues, homeSummaryByLeague, market, marketCalendar]);

  useEffect(() => {
    // Serve the cached view instantly on a league switch (H5), then
    // refetch in the background.
    if (leagueId && cacheRef.current.has(leagueId)) {
      setViewModel(cacheRef.current.get(leagueId)!);
      setRaw(rawCacheRef.current.get(leagueId) ?? null);
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

  return { status, viewModel, raw, summary, error, refresh: fetchLive };
}
