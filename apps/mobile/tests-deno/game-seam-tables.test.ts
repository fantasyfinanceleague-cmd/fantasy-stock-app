/**
 * The capture seam's table fixtures (3c): inert unless the seam is on, shaped as the
 * queries return, and a count that the exact-count guard can check. Run: `deno test .`
 */
import { assertEquals, assert } from 'jsr:@std/assert';
import { SEAM_LEAGUE, SEAM_ME, seamLivePrices, seamTableRows, type SeamTableName } from '../lib/game/seamTables.ts';
import { ROBERTO_HOLDINGS, fixtureQty } from '../lib/home/homeFixtureData.ts';
import { checkRowsComplete } from '../lib/game/readGuard.ts';

const TABLES: SeamTableName[] = ['drafts', 'draft_queue', 'matchups_week', 'matchups_playoff', 'week_snapshots', 'trades'];

Deno.test('every table fixture is inert when the seam is off: the real query stands', () => {
  for (const t of TABLES) assertEquals(seamTableRows(false, t), null, t);
});

Deno.test('every table fixture returns rows when the seam is on', () => {
  for (const t of TABLES) assert(Array.isArray(seamTableRows(true, t)), t);
});

Deno.test('a fixture count equals its rows, so the exact-count guard passes on the fixture', () => {
  for (const t of TABLES) {
    const rows = seamTableRows(true, t)!;
    assertEquals(checkRowsComplete(rows.length, rows.length).ok, true, t);
  }
});

Deno.test('the draft fixture has a legacy SKIP row that the room must render as a dash, and the queue has three stocks', () => {
  const picks = seamTableRows(true, 'drafts') as { symbol: string }[];
  assert(picks.some((p) => p.symbol === 'SKIP'));
  assertEquals((seamTableRows(true, 'draft_queue') as unknown[]).length, 3);
});

Deno.test('the week-6 matchups are three games on the league\'s one roster; the bracket is a valid, finished 6-team bracket', () => {
  const roster = new Set<string>(Object.values(SEAM_LEAGUE));
  const week = seamTableRows(true, 'matchups_week') as { team1_user_id: string; team2_user_id: string }[];
  assertEquals(week.length, 3);
  // Every manager plays exactly once, and every name is on the roster (no blank names in All matchups).
  const players = week.flatMap((m) => [m.team1_user_id, m.team2_user_id]);
  assertEquals(new Set(players).size, 6);
  assert(players.every((u) => roster.has(u)), players.join());
  const po = seamTableRows(true, 'matchups_playoff') as { playoff_round_number: number; team1_user_id: string; team2_user_id: string; team1_gain: number | null; team2_gain: number | null; winner_user_id: string | null }[];
  assert(po.every((r) => roster.has(r.team1_user_id) && roster.has(r.team2_user_id)));
  // playoff_teams 6: Wild card (2 games), Semifinals (2), Final (1), every game scored with its winner.
  assertEquals([1, 2, 3].map((r) => po.filter((x) => x.playoff_round_number === r).length), [2, 2, 1]);
  assert(po.every((r) => r.team1_gain !== null && r.team2_gain !== null && r.winner_user_id === (r.team1_gain! > r.team2_gain! ? r.team1_user_id : r.team2_user_id)));
  // Seeds 1-2 (Paolo, you) bye the Wild card; every later-round team won its previous game or had the bye.
  const byes = [SEAM_LEAGUE.paolo, SEAM_LEAGUE.me];
  assert(po.filter((r) => r.playoff_round_number === 1).every((r) => !byes.includes(r.team1_user_id as never) && !byes.includes(r.team2_user_id as never)));
  for (const r of po.filter((x) => x.playoff_round_number > 1)) {
    for (const u of [r.team1_user_id, r.team2_user_id]) {
      const advanced = po.some((p) => p.playoff_round_number === r.playoff_round_number - 1 && p.winner_user_id === u) || (r.playoff_round_number === 2 && byes.includes(u as never));
      assert(advanced, `${u} in round ${r.playoff_round_number} did not advance`);
    }
  }
  assertEquals(po.find((r) => r.playoff_round_number === 3)!.winner_user_id, SEAM_ME); // as in Home's 'complete'
});

Deno.test('your and Gianluigi\'s week-6 holdings are the Home fixture\'s, priced live at its Thursday prices', () => {
  const snaps = seamTableRows(true, 'week_snapshots') as { user_id: string; symbol: string; quantity: number; week_start_price: number }[];
  const mine = snaps.filter((s) => s.user_id === SEAM_ME);
  assertEquals(mine.map((s) => s.symbol), ROBERTO_HOLDINGS.map((h) => h.symbol));
  assertEquals(mine.map((s) => s.week_start_price), ROBERTO_HOLDINGS.map((h) => h.mon));
  assertEquals(mine.map((s) => s.quantity), ROBERTO_HOLDINGS.map(fixtureQty));
  const live = seamLivePrices();
  assert(ROBERTO_HOLDINGS.every((h) => live[h.symbol] === h.thu));
  // Every held symbol has a live price (no unpriced row in All matchups).
  assert(snaps.every((s) => typeof live[s.symbol] === 'number'), 'unpriced holding');
});
