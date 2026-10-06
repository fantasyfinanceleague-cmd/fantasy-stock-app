/**
 * The snake board (3c, key screen 4): which manager holds each pick number,
 * and each cell's state. Checked against the board's own draft: Paolo, Roberto,
 * Alessandro, Francesco, Gianluigi, Andrea seats; Roberto picks 2, 11, 14, 23,
 * 26, 35. Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { managerAtPick, boardRows } from '../lib/game/draftBoard.ts';

const ORDER = ['paolo', 'roberto', 'alessandro', 'francesco', 'gianluigi', 'andrea'];

Deno.test('the snake: round 1 runs forward, round 2 reverses', () => {
  assertEquals(managerAtPick(1, ORDER), 'paolo');
  assertEquals(managerAtPick(6, ORDER), 'andrea');
  assertEquals(managerAtPick(7, ORDER), 'andrea');
  assertEquals(managerAtPick(12, ORDER), 'paolo');
});

Deno.test('Roberto picks 2, 11, 14, 23, 26, 35 (the board)', () => {
  const mine = [];
  for (let p = 1; p <= 36; p++) if (managerAtPick(p, ORDER) === 'roberto') mine.push(p);
  assertEquals(mine, [2, 11, 14, 23, 26, 35]);
});

Deno.test('the board rows: one row per round, each cell its pick number and manager', () => {
  const rows = boardRows(ORDER, 3, new Map([[1, { symbol: "MSFT", source: "manual" }]]), 11);
  assertEquals(rows.length, 3);
  assertEquals(rows[0][0], { pick: 1, round: 1, manager: 'paolo', symbol: 'MSFT', source: 'manual', onClock: false });
  assertEquals(rows[1][4], { pick: 11, round: 2, manager: 'roberto', symbol: null, source: null, onClock: true });
});

import { indexPicks } from '../lib/game/draftBoard.ts';

Deno.test('indexPicks keys picks by overall number; a legacy SKIP row keeps its slot', () => {
  const m = indexPicks([
    { pick_number: 1, symbol: 'MSFT', pick_source: 'manual' },
    { pick_number: 2, symbol: 'SKIP', pick_source: 'skip' },
  ]);
  assertEquals(m.get(1), { symbol: 'MSFT', source: 'manual', price: null });
  assertEquals(m.get(2), { symbol: 'SKIP', source: 'skip', price: null });
  assertEquals(m.get(3), undefined);
});
