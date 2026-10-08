/**
 * The capture seam's table fixtures (3c): inert unless the seam is on, shaped as the
 * queries return, and a count that the exact-count guard can check. Run: `deno test .`
 */
import { assertEquals, assert } from 'jsr:@std/assert';
import { seamTableRows, type SeamTableName } from '../lib/game/seamTables.ts';
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

Deno.test('the week-6 matchups are the board\'s three games; round 1 of the bracket is played, round 2 is not', () => {
  assertEquals((seamTableRows(true, 'matchups_week') as unknown[]).length, 3);
  const po = seamTableRows(true, 'matchups_playoff') as { playoff_round_number: number; team1_gain: number | null }[];
  assertEquals(po.filter((r) => r.playoff_round_number === 1).every((r) => r.team1_gain !== null), true);
  assertEquals(po.filter((r) => r.playoff_round_number === 2).every((r) => r.team1_gain === null), true);
});
