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

Deno.test('the board rows: one row per round, each COLUMN a manager (G-1)', () => {
  const rows = boardRows(ORDER, 3, new Map([[1, { symbol: "MSFT", source: "manual" }]]), 11);
  assertEquals(rows.length, 3);
  assertEquals(rows[0][0], { pick: 1, round: 1, manager: 'paolo', symbol: 'MSFT', source: 'manual', onClock: false });
  // Round 2 reverses: Roberto's column (seat 2) holds pick 11, the pick on the clock.
  assertEquals(rows[1][1], { pick: 11, round: 2, manager: 'roberto', symbol: null, source: null, onClock: true });
  assertEquals(rows[1].map((c) => c.pick), [12, 11, 10, 9, 8, 7]);
  assertEquals(rows[2].map((c) => c.pick), [13, 14, 15, 16, 17, 18]);
});

Deno.test('every cell sits under the manager who holds it, in every round', () => {
  const rows = boardRows(ORDER, 6, new Map(), 1);
  for (const row of rows) row.forEach((c, i) => {
    assertEquals(c.manager, ORDER[i]);
    assertEquals(managerAtPick(c.pick, ORDER), ORDER[i]);
  });
  // Roberto's column is exactly his six picks.
  assertEquals(rows.map((r) => r[1].pick), [2, 11, 14, 23, 26, 35]);
});

import { boardHeader, managerInitials } from '../lib/game/draftBoard.ts';

Deno.test('the header row: each manager\'s initials over their column, yours marked', () => {
  const names = { paolo: { name: 'Paolo M.' }, roberto: { name: 'Roberto B.' }, alessandro: { name: 'Alessandro D.' } };
  const head = boardHeader(['paolo', 'roberto', 'alessandro'], names, 'roberto');
  assertEquals(head, [
    { manager: 'paolo', initials: 'PM', you: false },
    { manager: 'roberto', initials: 'RB', you: true },
    { manager: 'alessandro', initials: 'AD', you: false },
  ]);
  assertEquals(managerInitials('Cher'), 'C');
  assertEquals(managerInitials('  '), '');
  assertEquals(managerInitials(undefined), '');
  assertEquals(boardHeader(['ghost'], {}, 'me'), [{ manager: 'ghost', initials: '', you: false }]);
});

import { SOURCES } from './sourceManifest.generated.ts';

// W4 Draft (Game Night): the board moved to components/game/DraftBoard.tsx, laid out by column.
// G-1's intent stands (you find your own column and picks) as shading B: your column on one
// youTint slab, your avatar ringed and your name in 800. G-11's stands as the navy on-the-clock
// cell, whose ring is clockCellLive (never `you`, so it can't vanish in your column).
Deno.test('the board draws each manager over their column, shades YOUR column, and the on-clock cell wins its tile (G-1, G-11; source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  const board = SOURCES['components/game/DraftBoard.tsx'];
  assertEquals(room.includes('<DraftBoard'), true);
  assertEquals(board.includes("const you = manager === myUserId;"), true);
  assertEquals(board.includes('you ? { backgroundColor: colors.youTint } : null'), true);
  assertEquals(board.includes("tone={you ? 'you' : 'opp'} ring={you}"), true);
  assertEquals(board.includes('you ? styles.yourName : null'), true);
  assertEquals(board.includes("yourName: { fontWeight: '800' },"), true);
  // The pick on the clock is the on-clock cell even in your column (it is tested first).
  assertEquals(board.includes("const state = cell.onClock ? 'onClock' : made ? 'picked' : 'empty';"), true);
  assertEquals(board.includes('yours={you}'), true);
  // Nothing else is shaded: the slab is the only youTint on the board.
  assertEquals((board.match(/colors\.youTint/g) ?? []).length, 1);
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

import { color } from '../constants/tokens/color.ts';
const { light, dark } = color;

Deno.test('why live: live differs from you in both themes (G-11)', () => {
  // §9A had Light accent === you (why an accent outline vanished in your column); §9C's
  // accent is the cyan/teal, so it differs too — the clock ring stays live either way.
  assertEquals(light.accent !== light.you && dark.accent !== dark.you, true);
  assertEquals(light.live !== light.you, true);
  assertEquals(dark.live !== dark.you, true);
});
