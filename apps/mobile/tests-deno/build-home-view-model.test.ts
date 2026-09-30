/**
 * End-to-end tests for lib/home/buildHomeViewModel.ts on the design
 * board's fixture data (Stock Scudetto, Roberto vs Gianluigi B., week 6 of
 * 14, Thursday 1:37 PM ET live). This is the honesty check ITSELF, run as
 * a test rather than eyeballed against real data: the chart endpoint
 * equals the hero's gain, the 1W endpoint equals the this-week score, and
 * completed weeks' Friday points are pinned to their `matchups` gains.
 *
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';
import { buildHomeViewModel, type GetHomeLeagueResult, type HomeLeagueMeta } from '../lib/home/buildHomeViewModel.ts';
import { windowSeries } from '../lib/home/seasonGainSeries.ts';
import { playoffRoundLabelForWeek } from '../lib/playoffs.ts';
import { ROBERTO_WEEKS, FIXTURE_WEEK6_START, FIXTURE_WEEK6_END } from '../lib/home/homeFixtureData.ts';

const ROBERTO = [
  { symbol: 'NVDA', draft: 290.1, mon: 300.2, prev: 306.68, thu: 318.37 },
  { symbol: 'AAPL', draft: 198.6, mon: 205.1, prev: 208.83, thu: 211.42 },
  { symbol: 'CRM', draft: 262.4, mon: 268.0, prev: 269.96, thu: 271.35 },
  { symbol: 'TSLA', draft: 262.8, mon: 251.9, prev: 249.66, thu: 248.36 },
  { symbol: 'COST', draft: 905.2, mon: 912.4, prev: 915.22, thu: 918.1 },
  { symbol: 'V', draft: 281.5, mon: 284.2, prev: 285.04, thu: 286.1 },
];
const GIANLUIGI = [
  { symbol: 'AMZN', draft: 221.3, mon: 238.1, thu: 236.4 },
  { symbol: 'JPM', draft: 204.9, mon: 214.2, thu: 215.45 },
  { symbol: 'DIS', draft: 104.2, mon: 101.3, thu: 102.9 },
  { symbol: 'NKE', draft: 82.4, mon: 79.6, thu: 81.3 },
  { symbol: 'KO', draft: 68.1, mon: 69.4, thu: 69.9 },
  { symbol: 'BA', draft: 172.6, mon: 176.3, thu: 176.9 },
];
const qty = (draft: number) => Math.round((2000 / draft) * 1e4) / 1e4;

const MY_ID = 'roberto';
const OPP_ID = 'gianluigi';

function buildFixtureInput() {
  const myDrafts = ROBERTO.map((h) => ({ symbol: h.symbol, entry_price: h.draft, quantity: qty(h.draft), created_at: '2026-08-01T00:00:00Z' }));
  const mySnapshots = ROBERTO.map((h) => ({ symbol: h.symbol, quantity: qty(h.draft), week_start_price: h.mon, entered_mid_week: false, created_at: FIXTURE_WEEK6_START }));
  const oppSnapshots = GIANLUIGI.map((h) => ({ symbol: h.symbol, quantity: qty(h.draft), week_start_price: h.mon, entered_mid_week: false, created_at: FIXTURE_WEEK6_START }));

  const matchups = [
    // Each week gets its OWN Mon-Fri range (not a shared literal): a
    // malformed short offset ('-04' instead of '-04:00') silently parses
    // to Invalid Date under JS's Date constructor, which weekdayDates()
    // then turns into a silently-empty day list — caught by this test's
    // own next assertion (weeks 1-5 must each have points) failing until
    // fixed to real, distinct, correctly-offset week ranges.
    ...ROBERTO_WEEKS.map((w, i) => {
      const monday = new Date(Date.UTC(2026, 6, 6 + i * 7, 13, 30)); // Mondays 09:30 ET
      const friday = new Date(monday.getTime() + 4 * 24 * 3600 * 1000 + 6.5 * 3600 * 1000); // Friday 16:00 ET
      return {
        week_number: w.week, week_start: monday.toISOString(), week_end: friday.toISOString(),
        is_playoff: false, team1_user_id: MY_ID, team2_user_id: OPP_ID,
        team1_gain: w.gain, team2_gain: -w.gain,
      };
    }),
    {
      week_number: 6, week_start: FIXTURE_WEEK6_START, week_end: FIXTURE_WEEK6_END,
      is_playoff: false, team1_user_id: MY_ID, team2_user_id: OPP_ID,
      team1_gain: null, team2_gain: null,
    },
  ];

  const data: GetHomeLeagueResult = {
    my_ledger: { drafts: myDrafts, trades: [] },
    current_week: {
      week_number: 6,
      my_snapshots: mySnapshots,
      my_trades: [],
      opponent_snapshots: oppSnapshots,
      opponent_trades: [],
    },
    matchups,
    standings: [
      { user_id: MY_ID, rank: 2, wins: 4, losses: 1, ties: 0, points_for: 129.99, display_name: 'Roberto B.', is_bot: false },
      { user_id: OPP_ID, rank: 6, wins: 1, losses: 4, ties: 0, points_for: -142.35, display_name: 'Gianluigi B.', is_bot: false },
    ],
  };

  const meta: HomeLeagueMeta = {
    myUserId: MY_ID,
    draftStatus: 'completed', leagueStartDate: '2026-08-01T00:00:00Z',
    seasonStatus: 'active', currentWeek: 6, numWeeks: 14, playoffTeams: 6,
    stakeMode: 'fixed_notional', notionalPerSlot: 2000, numRounds: 6,
    draftOrderWaiting: false, hasLaterPlayoffRow: false, lastPlayoffLoss: false,
  };

  const quote = (sym: string) => ROBERTO.find((h) => h.symbol === sym)?.thu ?? GIANLUIGI.find((h) => h.symbol === sym)?.thu ?? null;

  // Bars: just enough for the current week's granularity (Monday + today).
  const bars: Record<string, { date: string; close: number }[]> = {};
  for (const h of ROBERTO) {
    bars[h.symbol] = [
      { date: '2026-09-18', close: h.prev }, // last Friday (irrelevant, before this week)
      { date: '2026-09-21', close: h.mon },
      { date: '2026-09-24', close: h.thu }, // "today" in this fixture
    ];
  }

  return { data, meta, quote, bars };
}

Deno.test('honesty check: the chart endpoint equals the hero season-gain number', () => {
  const { data, meta, quote, bars } = buildFixtureInput();
  const now = new Date('2026-09-24T17:37:00-04:00'); // Thursday, after market close for bars purposes
  const vm = buildHomeViewModel({
    now, meta, market: { status: 'closed', reason: 'after_hours', nextOpenAt: null },
    data, quote, bars, playoffRoundLabelForWeek,
  });
  const endpoint = vm.season!.points[vm.season!.points.length - 1].gain;
  assertEquals(endpoint, vm.hero!.seasonGainDollars);
});

Deno.test('honesty check: the 1W endpoint equals the this-week live score', () => {
  const { data, meta, quote, bars } = buildFixtureInput();
  const now = new Date('2026-09-24T17:37:00-04:00');
  const vm = buildHomeViewModel({
    now, meta, market: { status: 'closed', reason: 'after_hours', nextOpenAt: null },
    data, quote, bars, playoffRoundLabelForWeek,
  });
  const win = windowSeries(vm.season!, '1W', 5); // week index 5 = week 6
  const endpoint = win[win.length - 1].gain;
  assertAlmostEquals(endpoint, vm.thisWeek!.you.gain, 0.01); // both round to the cent independently
});

Deno.test('honesty check: every completed week (1-5) is pinned to its matchups gain, with no mismatches', () => {
  const { data, meta, quote, bars } = buildFixtureInput();
  const now = new Date('2026-09-24T17:37:00-04:00');
  const vm = buildHomeViewModel({
    now, meta, market: { status: 'closed', reason: 'after_hours', nextOpenAt: null },
    data, quote, bars, playoffRoundLabelForWeek,
  });
  // Weeks 1-5 are hasData:false (cosmetic ramp), so they push nothing to
  // `pinned` -- but they must still each land exactly on their scored
  // total in the running series.
  for (const w of ROBERTO_WEEKS) {
    const weekPoints = vm.season!.points.filter((p) => p.week === w.week);
    const last = weekPoints[weekPoints.length - 1];
    const expectedBase = ROBERTO_WEEKS.filter((x) => x.week <= w.week).reduce((s, x) => s + x.gain, 0);
    assertAlmostEquals(last.gain, Math.round(expectedBase * 100) / 100, 0.01);
  }
  assertEquals(vm.season!.mismatches, 0);
});

Deno.test('phase is live_open (Thursday, market open) and the this-week card has both sides', () => {
  const { data, meta, quote, bars } = buildFixtureInput();
  const now = new Date('2026-09-24T13:37:00-04:00'); // Thu 1:37 PM ET
  const vm = buildHomeViewModel({
    now, meta, market: { status: 'open', reason: 'regular_session', nextOpenAt: null },
    data, quote, bars, playoffRoundLabelForWeek,
  });
  assertEquals(vm.phase.kind, 'live_open');
  assertEquals(vm.thisWeek !== null, true);
});

Deno.test('season gain through week 5 matches ROBERTO_WEEKS = 129.99, before this week live is added', () => {
  const { data, meta, quote, bars } = buildFixtureInput();
  const now = new Date('2026-09-24T17:37:00-04:00');
  const vm = buildHomeViewModel({
    now, meta, market: { status: 'closed', reason: 'after_hours', nextOpenAt: null },
    data, quote, bars, playoffRoundLabelForWeek,
  });
  const throughW5 = vm.season!.weekBase[5]; // cumulative just before week 6 starts
  assertAlmostEquals(throughW5, 129.99, 1e-9);
});
