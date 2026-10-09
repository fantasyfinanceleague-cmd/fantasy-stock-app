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

// ── UX rule 7: your row pinned while it's below the fold; the move read right ──

import { moveA11y, shouldPinYourRow } from '../lib/game/standings.ts';

Deno.test('VoiceOver reads a down move as "down N" (it said "up N")', () => {
  assertEquals(moveA11y(2), 'up 2');
  assertEquals(moveA11y(-3), 'down 3');
  assertEquals(moveA11y(0), '');
  assertEquals(moveA11y(null), '');
});

const view = { viewTop: 100, viewBottom: 700 };

Deno.test('pin: the card is on screen and your row is below the fold', () => {
  assertEquals(shouldPinYourRow({ ...view, cardTop: 300, cardBottom: 1400, rowTop: 1100, rowBottom: 1140 }), true);
});

Deno.test('no pin: your row is visible, even at the very bottom', () => {
  assertEquals(shouldPinYourRow({ ...view, cardTop: 300, cardBottom: 1400, rowTop: 500, rowBottom: 540 }), false);
  assertEquals(shouldPinYourRow({ ...view, cardTop: 300, cardBottom: 1400, rowTop: 660, rowBottom: 700 }), false);
});

Deno.test('pin: your row only partly visible at the fold counts as below it', () => {
  assertEquals(shouldPinYourRow({ ...view, cardTop: 300, cardBottom: 1400, rowTop: 680, rowBottom: 720 }), true);
});

Deno.test('no pin: the card is off screen (scrolled past, or not reached yet)', () => {
  assertEquals(shouldPinYourRow({ ...view, cardTop: 800, cardBottom: 1400, rowTop: 1100, rowBottom: 1140 }), false);
  assertEquals(shouldPinYourRow({ ...view, cardTop: -900, cardBottom: 90, rowTop: -100, rowBottom: -60 }), false);
});

Deno.test('no pin: your row is above the view (scrolled past it): it is not "below the fold"', () => {
  assertEquals(shouldPinYourRow({ ...view, cardTop: -200, cardBottom: 900, rowTop: 0, rowBottom: 40 }), false);
});

import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('the pinned copy is the SAME row component, and the table reads the move with moveA11y (source guards)', () => {
  const table = SOURCES['components/game/StandingsTable.tsx'];
  assertEquals(table.includes('<StandingsRowView r={r} seasonComplete={seasonComplete} />'), true);
  assertEquals(table.includes('const move = moveA11y(r.move);'), true);
  assertEquals(table.includes('`, up ${Math.abs(r.move)}`'), false); // the old "up" for a down move
  assertEquals(table.includes('shouldPinYourRow({'), true);
  const screen = SOURCES['app/(tabs)/league.tsx'];
  assertEquals(screen.includes('<StandingsRowView r={pinnedRow} seasonComplete={phase === \'completed\'} />'), true);
  assertEquals(screen.includes('onPinChange={setPinnedRow}'), true);
});

Deno.test('BarsRefresh tells its children where the fold is, on iOS and Android (source guard)', () => {
  const bars = SOURCES['components/shell/BarsRefresh.tsx'];
  assertEquals((bars.match(/<ScrollFoldContext\.Provider value=\{fold\.value\}>/g) ?? []).length, 2);
  assertEquals(bars.includes('runOnJS(onScrolled)();'), true);
  assertEquals(bars.includes('onScroll={fold.emit}'), true);
});
