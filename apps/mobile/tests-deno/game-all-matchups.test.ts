/**
 * All matchups (3c): every game of the week, scored the same way as Matchup.
 * A live row uses liveWeekScore on that manager's own ledger; a posted row
 * uses the server's gains. A bye is one side. Yours is marked. Run: `deno test .`
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';
import { buildAllMatchups, type AllMatchupsInput } from '../lib/game/allMatchups.ts';

const row = (symbol: string, quantity: number, week_start_price: number, user: string) =>
  ({ user_id: user, symbol, quantity, week_start_price, entered_mid_week: false, created_at: '2026-09-28T14:35:00Z' });

const names = [
  { user_id: 'roberto', display_name: 'Roberto B.', is_bot: false },
  { user_id: 'paolo', display_name: 'Paolo M.', is_bot: false },
  { user_id: 'atlas', display_name: 'Atlas', is_bot: true },
];

function input(overrides: Partial<AllMatchupsInput> = {}): AllMatchupsInput {
  return {
    myUserId: 'roberto',
    week: 6,
    matchups: [
      { team1_user_id: 'roberto', team2_user_id: 'paolo', team1_gain: null, team2_gain: null, winner_user_id: null, is_tie: false, is_playoff: false },
      { team1_user_id: 'atlas', team2_user_id: null, team1_gain: null, team2_gain: null, winner_user_id: null, is_tie: false, is_playoff: false },
    ],
    snapshots: [row('NVDA', 10, 100, 'roberto'), row('AMZN', 4, 50, 'paolo'), row('KO', 2, 70, 'atlas')],
    trades: [],
    quote: (s) => ({ NVDA: 110, AMZN: 60, KO: 80 })[s] ?? null,
    names,
    ...overrides,
  };
}

Deno.test('a live matchup scores each manager on their own ledger, with the same live score as Matchup', () => {
  const rows = buildAllMatchups(input());
  const mine = rows.find((r) => r.a.userId === 'roberto')!;
  assertAlmostEquals(mine.a.gain, 100, 1e-9); // 10 * (110 - 100)
  assertAlmostEquals(mine.b!.gain, 40, 1e-9); // 4 * (60 - 50)
  assertEquals(mine.a.name, 'Roberto B.');
});

Deno.test('a bye is one side with no opponent, and yours is marked', () => {
  const rows = buildAllMatchups(input());
  const bye = rows.find((r) => r.a.userId === 'atlas')!;
  assertEquals(bye.b, null);
  assertEquals(bye.mine, false);
  assertEquals(rows.find((r) => r.a.userId === 'roberto')!.mine, true);
});

Deno.test('a bot is marked by is_bot, never by its id', () => {
  const rows = buildAllMatchups(input());
  assertEquals(rows.find((r) => r.a.userId === 'atlas')!.a.isBot, true);
});

Deno.test('a posted matchup uses the server\'s gains and is final', () => {
  const rows = buildAllMatchups(input({
    matchups: [{ team1_user_id: 'roberto', team2_user_id: 'paolo', team1_gain: 351.77, team2_gain: -38.88, winner_user_id: 'roberto', is_tie: false, is_playoff: false }],
  }));
  assertEquals(rows[0].final, true);
  assertEquals(rows[0].a.gain, 351.77);
  assertEquals(rows[0].b!.gain, -38.88);
});

Deno.test('a manager with no name in the standings shows no invented name', () => {
  const rows = buildAllMatchups(input({ names: [] }));
  assertEquals(rows[0].a.name, '');
});
