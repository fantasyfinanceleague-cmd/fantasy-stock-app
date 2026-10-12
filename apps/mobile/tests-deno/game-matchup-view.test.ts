/**
 * 3c Matchup view model: the honesty checks. Matchup's live score must be
 * EXACTLY Home's this-week live number (both call liveWeekScore on the same
 * ledger), the lineup rows must sum to the score, byes have no opponent, and
 * the chyron only ever uses real data. Run: `deno test .`
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';
import { buildMatchupLive, type MatchupInput } from '../lib/game/buildMatchupViewModel.ts';
import { liveWeekScore } from '../lib/home/liveWeekScore.ts';
import { toLiveSnapshots, toLiveTrades, type GetHomeLeagueResult, type HomeLedgerRow } from '../lib/home/buildHomeViewModel.ts';

const row = (symbol: string, quantity: number, week_start_price: number, extra: Partial<HomeLedgerRow> = {}): HomeLedgerRow =>
  ({ symbol, quantity, week_start_price, entered_mid_week: false, created_at: '2026-09-28T14:35:00Z', ...extra });

function fixture(overrides: Partial<GetHomeLeagueResult['current_week']> = {}, team2: string | null = 'gianluigi'): GetHomeLeagueResult {
  return {
    my_ledger: { drafts: [], trades: [] },
    current_week: {
      week_number: 6,
      my_snapshots: [row('NVDA', 10, 100), row('AAPL', 5, 200)],
      my_trades: [],
      opponent_snapshots: [row('AMZN', 4, 50)],
      opponent_trades: [],
      ...overrides,
    },
    matchups: [{ week_number: 6, week_start: '2026-09-28T13:30:00Z', week_end: '2026-10-02T20:00:00Z', is_playoff: false, team1_user_id: 'roberto', team2_user_id: team2, team1_gain: null, team2_gain: null }],
    standings: [
      { user_id: 'roberto', rank: 1, wins: 4, losses: 1, ties: 0, points_for: 0, display_name: 'Roberto B.', is_bot: false },
      { user_id: 'gianluigi', rank: 5, wins: 1, losses: 4, ties: 0, points_for: 0, display_name: 'Gianluigi B.', is_bot: false },
    ],
  };
}

const prices: Record<string, number> = { NVDA: 112.5, AAPL: 198, AMZN: 60 };
const quote = (s: string) => prices[s] ?? null;

function input(overrides: Partial<MatchupInput> = {}): MatchupInput {
  return { data: fixture(), myUserId: 'roberto', quote, now: new Date('2026-09-29T17:00:00Z'), ...overrides };
}

Deno.test('honesty: Matchup live gain equals Home\'s this-week live gain (same liveWeekScore inputs)', () => {
  const vm = buildMatchupLive(input());
  const home = liveWeekScore(toLiveSnapshots(fixture().current_week.my_snapshots), toLiveTrades(fixture().current_week.my_trades), quote);
  assertEquals(vm.me.gain, home.gain);
  assertEquals(vm.me.pct, home.pct);
});

Deno.test('lineups: each side\'s rows sum to its score, to the cent', () => {
  const vm = buildMatchupLive(input());
  const sumMe = vm.me.lineup.reduce((s, r) => s + r.cents, 0);
  assertEquals(sumMe, Math.round(vm.me.gain * 100));
  assertEquals(vm.opp!.lineup.reduce((s, r) => s + r.cents, 0), Math.round(vm.opp!.gain * 100));
});

Deno.test('the opponent is the other team, with its own name and gain', () => {
  const vm = buildMatchupLive(input());
  assertEquals(vm.opp!.userId, 'gianluigi');
  assertEquals(vm.opp!.name, 'Gianluigi B.');
  assertAlmostEquals(vm.opp!.gain, 4 * (60 - 50), 1e-9);
});

Deno.test('a bye (no team 2) has no opponent and no scoreboard numbers for one', () => {
  const vm = buildMatchupLive(input({ data: fixture({}, null) }));
  assertEquals(vm.hasOpponent, false);
  assertEquals(vm.opp, null);
});

Deno.test('unpriced holdings are passed through for the at-cost caption', () => {
  const vm = buildMatchupLive(input({ quote: (s) => (s === 'AAPL' ? null : quote(s)) }));
  assertEquals(vm.me.unpriced, ['AAPL']);
});

Deno.test('leader and lead: the side ahead, by the dollar gap', () => {
  const vm = buildMatchupLive(input());
  assertEquals(vm.leader, vm.me.gain > vm.opp!.gain ? 'me' : 'opp');
  assertAlmostEquals(vm.leadDollars!, Math.abs(vm.me.gain - vm.opp!.gain), 1e-9);
});

// ---------------------------------------------------------------------------
// finalGains: the scored matchup row is the truth once it posts
// ---------------------------------------------------------------------------
import { finalGains } from '../lib/game/buildMatchupViewModel.ts';

Deno.test('finalGains: null until both gains post (nothing reads final before it is)', () => {
  const data = fixture();
  assertEquals(finalGains(data, 'roberto'), null);
});

Deno.test('finalGains: uses the server\'s gains for my side, whichever team I am', () => {
  const data = fixture();
  data.matchups[0].team1_gain = 351.77;
  data.matchups[0].team2_gain = -38.88;
  assertEquals(finalGains(data, 'roberto'), { me: 351.77, opp: -38.88 });
  assertEquals(finalGains(data, 'gianluigi'), { me: -38.88, opp: 351.77 });
});
