/**
 * League standings rows (3c, key screen 3). The ORDER is the server's
 * (league_standings_ranked); this only reads it. A ▲/▼ move compares the
 * server's current rank with its rank through last week, and is null (not
 * shown) when last week's order is unavailable: never a guessed "no move".
 * Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { buildStandingsRows, type StandingInput } from '../lib/game/standings.ts';

const s = (user_id: string, rank: number, wins: number, losses: number, points_for: number, display_name = user_id, is_bot = false): StandingInput =>
  ({ user_id, rank, wins, losses, ties: 0, points_for, display_name, is_bot });

const current = [s('roberto', 1, 5, 1, 481.76, 'Roberto B.'), s('paolo', 2, 5, 1, 464.1, 'Paolo M.'), s('atlas', 3, 4, 2, 10, 'Atlas', true)];

Deno.test('rows keep the server\'s order exactly, rank 1..N, and mark the caller', () => {
  const rows = buildStandingsRows(current, 'roberto', null);
  assertEquals(rows.map((r) => r.userId), ['roberto', 'paolo', 'atlas']);
  assertEquals(rows.map((r) => r.rank), [1, 2, 3]);
  assertEquals(rows[0].isYou, true);
  assertEquals(rows[1].isYou, false);
});

Deno.test('a bot is marked by is_bot', () => {
  assertEquals(buildStandingsRows(current, 'roberto', null)[2].isBot, true);
});

Deno.test('movement: up when the rank improved, down when it fell, none when it held', () => {
  const prev = new Map([['roberto', 2], ['paolo', 1], ['atlas', 3]]);
  const rows = buildStandingsRows(current, 'roberto', prev);
  assertEquals(rows.map((r) => r.move), [1, -1, 0]); // ▲1, ▼1, held
});

Deno.test('no last-week order means no movement at all (null), never a guessed zero', () => {
  const rows = buildStandingsRows(current, 'roberto', null);
  assertEquals(rows.map((r) => r.move), [null, null, null]);
});

Deno.test('a manager who was not ranked last week has no movement (null)', () => {
  const prev = new Map([['roberto', 1]]);
  const rows = buildStandingsRows(current, 'roberto', prev);
  assertEquals(rows[1].move, null);
});

Deno.test('the record reads W–L, with –T only when there are ties', () => {
  const rows = buildStandingsRows([{ ...current[0], ties: 1 }, current[1]], 'roberto', null);
  assertEquals(rows[0].record, '5–1–1');
  assertEquals(rows[1].record, '5–1');
});
