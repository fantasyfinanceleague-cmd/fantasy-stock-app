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

Deno.test('the room draws the header and marks your picks; the on-clock outline is live (G-11; source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assertEquals(room.includes('{boardHeader(room.order, room.names, myUserId).map((h) => ('), true);
  assertEquals(room.includes('color={h.you ? colors.youText : colors.text2}'), true);
  assertEquals(room.includes('mine ? { borderColor: colors.you, backgroundColor: colors.youTint } : null,'), true);
  // Order matters: the on-clock outline is applied after yours, so it wins the border.
  assertEquals(room.indexOf('mine ? { borderColor: colors.you') < room.indexOf('cell.onClock ? { borderColor: colors.live'), true);
  // G-11 (ruled): live at 2 pt in both themes (accent === you in Light vanished in your column).
  assertEquals(room.includes('cell.onClock ? { borderColor: colors.live, borderWidth: 2 } : null,'), true);
  assertEquals(room.includes('cell.onClock ? { borderColor: colors.accent'), false);
  // Your pick numbers in youText (key screen 4's .ks-cell--you .ks-cell__n).
  assertEquals(room.includes("color={mine ? colors.youText : undefined}>{cell.pick}</Text>"), true);
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

Deno.test('why live: in Light accent is you; live differs from you in both themes (G-11)', () => {
  assertEquals(light.accent, light.you); // the reason an accent outline vanished in your column
  assertEquals(light.live !== light.you, true);
  assertEquals(dark.live !== dark.you, true);
});
