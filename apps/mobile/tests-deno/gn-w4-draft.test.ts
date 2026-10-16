/**
 * W4 Draft on Game Night (§9C; board #call-game-night, "Draft room, on the clock"): the board
 * by column with your column shaded (B), the clock ring that runs down, the tiles' category
 * lines from the app's real categories, and the room's "nothing tappable does nothing" fixes.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { BOARD_GAP, COLUMN_PAD, TILE_HEIGHT, TILE_MAX_SCALE, TILE_MIN, boardColumns, boardFirstName, boardLayout, scrollXForColumn, tileHeight } from '../lib/game/draftBoardLayout.ts';
import { CLOCK_RING_SIZE, CLOCK_RING_STROKE, clockCardKind, clockRingArc, clockRingTone } from '../lib/game/draftClockCard.ts';
import { isCategory, resolveSymbolCategories, seamSymbolCategories } from '../lib/game/symbolCategories.ts';
import { draftTileLabel } from '../components/sp/logic/gameNight.ts';
import { STRESS_SEATS, draftRoomClock, draftRoomClockRead, draftRoomPicks, parseDraftRoomVariant } from '../lib/game/seamRoom.ts';
import { managerAtPick } from '../lib/game/draftBoard.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const strip = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const ORDER = ['paolo', 'roberto', 'alessandro', 'francesco', 'gianluigi', 'andrea'];

// ── The board's layout ───────────────────────────────────────────────────────────

Deno.test('six columns fill a 17e\'s content width with no scroll; tiles 4pt apart', () => {
  // 390 − 2×20 gutter = 350, plus the outer pads that reach into the gutter.
  const l = boardLayout({ columns: 6, available: 350 + 2 * COLUMN_PAD, fontScale: 1 });
  assertEquals(l.scrolls, false);
  assertEquals(Math.round(l.contentWidth), 354);
  assertEquals(l.columnWidth - l.tileWidth, 2 * COLUMN_PAD);
  assertEquals(2 * COLUMN_PAD, BOARD_GAP);
  assert(l.tileWidth >= TILE_MIN, `${l.tileWidth}`);
});

Deno.test('12 managers keep the tile floor and scroll sideways (the stress fixture)', () => {
  const l = boardLayout({ columns: 12, available: 354, fontScale: 1 });
  assertEquals(l.scrolls, true);
  assertEquals(l.tileWidth, TILE_MIN);
  assertEquals(l.contentWidth, 12 * (TILE_MIN + 2 * COLUMN_PAD));
});

Deno.test('the floor grows with text to the tile\'s own cap, and no further', () => {
  assertEquals(boardLayout({ columns: 12, available: 354, fontScale: 1.1 }).tileWidth, TILE_MIN * 1.1);
  assertEquals(boardLayout({ columns: 12, available: 354, fontScale: 3 }).tileWidth, TILE_MIN * TILE_MAX_SCALE);
  // At XL six columns on a 17e no longer hold the floor: the board scrolls rather than clip GOOGL.
  assertEquals(boardLayout({ columns: 6, available: 354, fontScale: 1.35 }).scrolls, true);
  // The tile and the layout share the cap (DraftTile's TILE_MAX_SCALE).
  assert(SOURCES['components/sp/gn/DraftTile.tsx'].includes(`const TILE_MAX_SCALE = ${TILE_MAX_SCALE};`));
});

Deno.test('every tile is one height, so rounds line up across columns that lay out alone', () => {
  assertEquals(tileHeight(1), TILE_HEIGHT);
  assertEquals(tileHeight(0.8), TILE_HEIGHT);
  assertEquals(tileHeight(1.2), Math.ceil(2 * 16 * 1.2 + 11));
  assertEquals(tileHeight(3), tileHeight(1.2));
  assert(SOURCES['components/game/DraftBoard.tsx'].includes('height={height}'));
});

Deno.test('a scrolling board opens on the column on the clock, clamped at both ends', () => {
  const l = boardLayout({ columns: 12, available: 354, fontScale: 1 });
  assertEquals(scrollXForColumn(0, l, 354), 0);
  assertEquals(scrollXForColumn(11, l, 354), l.contentWidth - 354);
  const mid = scrollXForColumn(6, l, 354);
  assertEquals(mid, 6 * l.columnWidth + l.columnWidth / 2 - 177);
  // A board that fits never scrolls; no column on the clock (the ending) stays put.
  assertEquals(scrollXForColumn(5, boardLayout({ columns: 6, available: 354, fontScale: 1 }), 354), 0);
  assertEquals(scrollXForColumn(-1, l, 354), 0);
});

Deno.test('columns are the snake\'s seats: each holds every round of one manager', () => {
  const cols = boardColumns(ORDER, 6, new Map([[2, { symbol: 'NVDA', source: 'manual' }]]), 11);
  assertEquals(cols.length, 6);
  assertEquals(cols[1].map((c) => c.pick), [2, 11, 14, 23, 26, 35]);
  for (const col of cols) for (const c of col) assertEquals(managerAtPick(c.pick, ORDER), col[0].manager);
  assertEquals(cols[1][0].symbol, 'NVDA');
  assertEquals(cols[1][1].onClock, true);
});

Deno.test('the header shows the first name, as the board draws it', () => {
  assertEquals(boardFirstName('Paolo M.'), 'Paolo');
  assertEquals(boardFirstName('  Gianluigi  Buffonetti '), 'Gianluigi');
  assertEquals(boardFirstName(undefined), '');
});

// ── The clock card ───────────────────────────────────────────────────────────────

Deno.test('the clock card: yours, theirs, auto-picking, stalled (stalled wins)', () => {
  assertEquals(clockCardKind({ isMyTurn: true, stalled: false, clockKind: 'on_clock' }), 'yours');
  assertEquals(clockCardKind({ isMyTurn: true, stalled: false, clockKind: 'last10' }), 'yours');
  assertEquals(clockCardKind({ isMyTurn: false, stalled: false, clockKind: 'on_clock' }), 'theirs');
  assertEquals(clockCardKind({ isMyTurn: true, stalled: false, clockKind: 'auto_picking' }), 'auto_picking');
  assertEquals(clockCardKind({ isMyTurn: true, stalled: true, clockKind: 'auto_picking' }), 'stalled');
});

Deno.test('the ring runs down: full at the start, half at half, empty at 0:00, clamped past either end', () => {
  const r = (CLOCK_RING_SIZE - CLOCK_RING_STROKE) / 2;
  const full = clockRingArc(60, 60);
  assertEquals(full.radius, r);
  assertEquals(full.dashOffset, 0);
  assertEquals(Math.abs(clockRingArc(30, 60).dashOffset - full.circumference / 2) < 1e-9, true);
  assertEquals(clockRingArc(0, 60).dashOffset, full.circumference);
  assertEquals(clockRingArc(90, 60).dashOffset, 0); // never more than one turn
  assertEquals(clockRingArc(-3, 60).dashOffset, full.circumference);
  assertEquals(clockRingArc(null, 60).dashOffset, full.circumference);
  assertEquals(clockRingArc(10, 0).dashOffset, full.circumference);
});

Deno.test('the ring is live, and loss in the last 10 seconds (the number says it too)', () => {
  assertEquals(clockRingTone('on_clock'), 'live');
  assertEquals(clockRingTone('last10'), 'loss');
});

// ── The tiles ────────────────────────────────────────────────────────────────────

Deno.test('a tile\'s VoiceOver label: yours first, the stock, its category, auto-picked; a SKIP is "No pick"', () => {
  assertEquals(draftTileLabel({ pick: 11, state: 'picked', spoken: 'AAPL', category: 'tech', yours: true }), 'Yours, pick 11, AAPL, Tech');
  assertEquals(draftTileLabel({ pick: 10, state: 'picked', spoken: 'PLTR', category: 'tech', auto: true }), 'Pick 10, PLTR, Tech, auto-picked');
  assertEquals(draftTileLabel({ pick: 4, state: 'picked', spoken: 'No pick' }), 'Pick 4, No pick');
  assertEquals(draftTileLabel({ pick: 11, state: 'onClock', clock: '0:42', yours: true }), 'Yours, pick 11, on the clock, 0:42');
  assertEquals(draftTileLabel({ pick: 12, state: 'empty' }), 'Pick 12, open');
});

Deno.test('the board never fills a tile with its category, and a SKIP or an unknown category draws no line', () => {
  const board = strip(SOURCES['components/game/DraftBoard.tsx']);
  assert(board.includes('category={made?.countsAsPick ? categories[made.symbolCell.toUpperCase()] ?? null : null}'));
  assert(board.includes('spokenTicker={made?.symbolLabel}'));
  assert(!/backgroundColor:\s*colors\.cat/.test(board));
});

// ── Categories: the app's own, never a sample ────────────────────────────────────

const CATS = [
  { id: 'c-tech', slug: 'tech' }, { id: 'c-fin', slug: 'finance' }, { id: 'c-media', slug: 'media' },
  { id: 'c-misc', slug: 'misc', is_misc: true },
];

Deno.test('categories: an override wins (the first in display order), then the GICS rule, then Misc', () => {
  const got = resolveSymbolCategories({
    symbols: ['googl', 'JPM', 'XYZ', 'META'],
    categories: CATS,
    overrides: [{ symbol: 'GOOGL', category_id: 'c-media' }, { symbol: 'GOOGL', category_id: 'c-tech' }],
    industries: [{ symbol: 'JPM', gics_industry: 'Banks' }, { symbol: 'XYZ', gics_industry: null }, { symbol: 'META', gics_industry: 'Unruled' }],
    rules: [{ gics_industry: 'Banks', category_id: 'c-fin' }],
  });
  assertEquals(got, { GOOGL: 'tech', JPM: 'finance', XYZ: 'misc', META: 'misc' });
});

Deno.test('categories: an unknown slug is no category (no line), never a guess', () => {
  const got = resolveSymbolCategories({
    symbols: ['A'], categories: [{ id: 'c-x', slug: 'crypto' }], overrides: [{ symbol: 'A', category_id: 'c-x' }], industries: [], rules: [],
  });
  assertEquals(got, { A: null });
  assertEquals(isCategory('tech'), true);
  assertEquals(isCategory('toString'), false);
});

Deno.test('categories: a failed read is no category at all, never Misc (the hook)', () => {
  const hook = strip(SOURCES['lib/game/useSymbolCategories.ts']);
  assert(hook.includes('if (categories.length === 0 || overrides.error || industries.error) return null;'));
  assert(hook.includes('if (rules.error) return null;'));
  assert(hook.includes('if (cancelled || !got) return;'));
  // Three reads for the whole board, by symbol set: never one per stock.
  assert(hook.includes(".in('symbol', symbols)"));
  assert(hook.includes(".in('gics_industry', inds)"));
});

Deno.test('the seam\'s categories: the fixture stocks are real categories; the rest Misc', () => {
  assertEquals(seamSymbolCategories(['nvda', 'JPM', 'ZZZZ']), { NVDA: 'tech', JPM: 'finance', ZZZZ: 'misc' });
});

// ── The capture fixtures ─────────────────────────────────────────────────────────

Deno.test('the new seam variants parse and draw their states', () => {
  for (const v of ['theirs_first', 'last10', 'auto_picking', 'stress', 'loading', 'failed'] as const) assertEquals(parseDraftRoomVariant(v), v);
  // The room's two non-states: the clock read never answers (the skeleton) or fails (Try again).
  assertEquals(draftRoomClockRead('loading'), 'pending');
  assertEquals(draftRoomClockRead('failed'), 'error');
  assertEquals(draftRoomClockRead('on_clock'), 'ok');
  assert(SOURCES['lib/game/seamCalls.ts'].includes("if (name === 'get_draft_clock' && draftRoomClockRead(roomVariant) === 'pending') return new Promise<never>(() => {});"));
  assertEquals(draftRoomPicks('theirs_first').length, 0);
  assertEquals(draftRoomPicks('last10').length, 10);
  const last10 = draftRoomClock('last10', 0);
  assertEquals(new Date(String(last10.deadline_at)).getTime(), 8_000);
  assertEquals(draftRoomPicks('auto_picking').length, 2);
  assertEquals(new Date(String(draftRoomClock('auto_picking', 0).deadline_at)).getTime() < 0, true);
});

Deno.test('the stress draft: 16 seats (max_teams) of 20-character names, your turn at pick 31', () => {
  assertEquals(STRESS_SEATS.length, 16);
  for (const s of STRESS_SEATS) assertEquals(s.name.length, 20, s.name);
  const order = STRESS_SEATS.map((s) => s.id);
  assertEquals(draftRoomPicks('stress').length, 30);
  assertEquals(managerAtPick(31, order), '__me__');
  for (const t of ['GOOGL', 'CMCSA']) assert(draftRoomPicks('stress').some((p) => p.symbol === t), t);
  assert(SOURCES['lib/game/seamFixtures.ts'].includes("case 'get_draft_order': return { data: fixtureDraftRoom(roomVariant, draftStartFixture).order, error: null };"));
});

// ── Nothing tappable does nothing ────────────────────────────────────────────────

Deno.test('the queue draws no move that can\'t happen, and Save only with something to save', () => {
  const q = strip(SOURCES['components/game/QueueEditor.tsx']);
  assert(q.includes('{i > 0 ? ('));
  assert(q.includes('{i < queue.length - 1 ? ('));
  assert(!q.includes('disabled={i === 0}'));
  assert(!q.includes('disabled={i === queue.length - 1}'));
  assert(q.includes('{dirty ? ('));
  assert(q.includes('<Button label="Save queue" variant="secondary"'));
  assert(q.includes('Not saved yet.'));
});

Deno.test('Draft complete and the lobby divide rows by space, never by rules', () => {
  for (const p of ['components/game/DraftComplete.tsx', 'components/game/DraftLobby.tsx', 'components/game/DraftRoom.tsx', 'components/game/DraftBoard.tsx', 'components/game/QueueEditor.tsx']) {
    const src = strip(SOURCES[p]);
    assert(!/borderTopWidth|borderBottomWidth|hairlineWidth/.test(src), p);
  }
});

// ── §9C mechanical checks on the files this branch touches ───────────────────────

const TOUCHED = [
  'components/game/DraftBoard.tsx', 'components/game/DraftRoom.tsx', 'components/game/DraftLobby.tsx',
  'components/game/DraftComplete.tsx', 'components/game/QueueEditor.tsx', 'components/game/LoadingSkeletons.tsx',
  'components/sp/gn/ClockRing.tsx', 'components/sp/gn/DraftTile.tsx',
];

Deno.test('tokens only: no colour literal, no textTransform in the draft files', () => {
  for (const p of TOUCHED) {
    const src = strip(SOURCES[p]);
    assert(!/#[0-9A-Fa-f]{3,8}\b/.test(src), `${p}: colour literal`);
    assert(!/rgba?\(/.test(src), `${p}: rgba literal`);
    assert(!src.includes('textTransform'), `${p}: textTransform`);
  }
});

Deno.test('one accent pill: Draft is the room\'s only primary Button', () => {
  const room = strip(SOURCES['components/game/DraftRoom.tsx']);
  const buttons = room.match(/<Button [^>]*\/>/g) ?? [];
  const primaries = buttons.filter((b) => !/variant="(secondary|ghost|destructive)"/.test(b));
  assertEquals(primaries.length, 1, primaries.join('\n'));
  assert(primaries[0].includes("'Draft'"));
});

// ── Wrapping at XL: "·" stays with the segment before it ─────────────────────────

import { NBSP, keepDots } from '../lib/game/keepDots.ts';

Deno.test('keepDots: no line starts with "·"; short segments stay whole; long ones may wrap; the words are unchanged', () => {
  const round = keepDots('Round 2 of 6 · Pick 11, then 12');
  assertEquals(round, `Round${NBSP}2${NBSP}of${NBSP}6${NBSP}· Pick${NBSP}11,${NBSP}then${NBSP}12`);
  // The only breakable space is the one AFTER each dot.
  assertEquals(round.split(' ').length, 2);
  assert(!round.split(' ').some((part) => part.startsWith('·')));
  assertEquals(keepDots('1 of 6 · $2,000 per slot'), `1${NBSP}of${NBSP}6${NBSP}· $2,000${NBSP}per${NBSP}slot`);
  // A segment longer than the keep-whole limit keeps its ordinary spaces.
  const long = keepDots('Short · a segment far longer than twenty-four characters');
  assertEquals(long, `Short${NBSP}· a segment far longer than twenty-four characters`);
  // No dots: untouched. Same words either way.
  assertEquals(keepDots('Paolo M. is up'), 'Paolo M. is up');
  assertEquals(keepDots('Auto-picked · from your queue').replaceAll(NBSP, ' '), 'Auto-picked · from your queue');
});

Deno.test('every "·" line the draft surfaces draw goes through keepDots (source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  for (const n of ['{keepDots(roundLine)}', '{keepDots(afterPickLine(', 'caption={keepMoney(keepDots(caption))}', '{keepDots(`· ${row.label}`)}']) assert(room.includes(n), n);
  assert(SOURCES['components/game/QueueEditor.tsx'].includes('{keepDots(`Your queue · ${queue.length} of ${QUEUE_MAX}`)}'));
  assert(SOURCES['components/game/DraftLobby.tsx'].includes("{keepDots('Draft order · waiting')}"));
  assert(SOURCES['components/game/DraftComplete.tsx'].includes('{keepMoney(keepDots(rosterPickCaption(r)))}'));
});

Deno.test('a five-letter ticker shrinks to fit its tile, never under 11pt; the title wraps beside the ring', () => {
  const tile = SOURCES['components/sp/gn/DraftTile.tsx'];
  assert(tile.includes('adjustsFontSizeToFit minimumFontScale={TICKER_MIN_SCALE}'));
  const scale = Number(tile.match(/TICKER_MIN_SCALE = ([0-9.]+)/)?.[1]);
  assert(13 * scale >= 11, `${13 * scale}`);
  // `display` never wraps by default (sp Text's NEVER_WRAP); beside the ring it must.
  assert(SOURCES['components/game/DraftRoom.tsx'].includes('<Text variant="display" numberOfLines={2} style={styles.yourTurnTitle}'));
});

// ── The standout stays loudest (checklist §5): the clock card's headline at every size ──

import { CARD_LINE_MAX_SCALE } from '../lib/game/draftClockCard.ts';
import { type as TYPE } from '../constants/tokens/type.ts';

Deno.test('the clock card\'s headline outranks its other lines at every text size', () => {
  const cap = (v: keyof typeof TYPE, scale: number, own?: number) => TYPE[v].fontSize * Math.min(scale, own ?? TYPE[v].maxScale ?? Infinity);
  for (const s of [1, 1.35, 1.6, 2.35, 3.12]) {
    // "{Name} is up" / "Auto-picking…" (headline) and your "You're on the clock" (display at 26).
    const headline = cap('headline', s);
    const title = 26 * Math.min(s, TYPE.display.maxScale ?? Infinity);
    for (const line of [cap('callout', s, CARD_LINE_MAX_SCALE), cap('caption', s, CARD_LINE_MAX_SCALE)]) {
      assert(line < headline, `${s}: ${line} vs headline ${headline}`);
      assert(line < title, `${s}: ${line} vs title ${title}`);
    }
  }
  // Every callout and caption on the card carries the cap.
  const room = SOURCES['components/game/DraftRoom.tsx'];
  const card = room.slice(room.indexOf('<Card style={[styles.card, onTheClock ?'), room.indexOf('<DraftBoard'));
  const lines = card.match(/<Text variant="(callout|caption)"[^>]*>/g) ?? [];
  assertEquals(lines.length, 5); // "N-second picks" left the card (Giorgio, 2026-10-13)
  for (const l of lines) assert(l.includes('maxFontSizeMultiplier={CARD_LINE_MAX_SCALE}'), l);
});

// ── W4 gate BLOCK pass (2026-10-13) ──────────────────────────────────────────────

import { draftOffered } from '../lib/game/draftClockCard.ts';

Deno.test('Draft and the search are offered only on YOUR running clock, never auto-picking or stalled (P1)', () => {
  assertEquals(draftOffered('yours'), true);
  assertEquals(draftOffered('auto_picking'), false);
  assertEquals(draftOffered('stalled'), false);
  assertEquals(draftOffered('theirs'), false);
  const room = strip(SOURCES['components/game/DraftRoom.tsx']);
  assert(room.includes('{draftOffered(kind) ? ('));
  assert(!room.includes('{isMyTurn ? (\n        <Card style={[styles.card, styles.searchCard]}>'));
  // A selection left over when the running clock ends is dropped, never a stale Draft later.
  const at = room.indexOf('if (myTurnPick !== null) return;');
  assert(at > 0);
  assert(room.slice(at, at + 120).includes('setSelected(null);'));
});

// Giorgio, 2026-10-13 (PRODUCT_RULES): "I don't like the then blank blank picked twice. I think it
// just should show the you're on the clock and then what round and pick number it is. I don't think
// it needs that last thing at the bottom." Both cards; the ring and the status lines stay.
Deno.test('the clock card: the headline and "Round X of Y · Pick N" only: no ", then N", no "-second picks" (both cards)', () => {
  const room = strip(SOURCES['components/game/DraftRoom.tsx']);
  const card = room.slice(room.indexOf('<Card style={[styles.card, onTheClock ?'), room.indexOf('<DraftBoard'));
  assert(room.includes('const roundLine = roundPickLine(round, rounds, onClockPick);'));
  assert(!room.includes('snakeThenPick'));
  assert(!/second picks/.test(room));
  // The ring still reads the pick length for its arc; no LINE says it.
  assert(card.includes('totalSeconds={room.pickSeconds}'));
  assert(!card.includes('-second'));
  // VoiceOver follows the same rule.
  assert(room.includes('accessibilityLabel={[headline, clockLabel, roundLine].filter(Boolean).join(\', \')}'));
  // The ring and the status lines stay.
  assert(card.includes('<ClockRing'));
  assert(card.includes('{stalled?.line ?'));
  assert(card.includes('{AUTO_PICK_WAITING_FOR_PRICES}'));
  // Exactly those two went: on someone else's card the lines that say when you're up stay
  // (U-09 "You took AAPL · you're up in 2 picks", UX rule 10 "N picks until you").
  assert(card.includes('{keepDots(afterPickLine(lastMine, picksAway, lastMineAuto) ?? \'\')}'));
  assert(card.includes('{picksUntilYouLine(picksAway)}'));
  // ...shown under the same conditions as before the ruling (off your turn; before / after your first pick).
  assert(card.includes('{!isMyTurn && lastMine && afterPickLine(lastMine, picksAway, lastMineAuto) ? ('));
  assert(card.includes('{!isMyTurn && !lastMine && picksUntilYouLine(picksAway) ? ('));
});

import { HEADER_NAME_PT, headerNamePt, headerNameWidth } from '../lib/game/draftBoardLayout.ts';
import { estimateNameWidth } from '../components/sp/logic/gameNight.ts';

Deno.test('board header names: 11pt, shrunk never under 11, then the ellipsis; a scrolling board widens to its names', () => {
  assertEquals(HEADER_NAME_PT, 11);
  // Fits: its full size (and Dynamic Type to the tile's cap).
  assertEquals(headerNamePt('Paolo M.', 60, 1), 11);
  assertEquals(headerNamePt('Paolo M.', 200, 2), 11 * 1.2);
  // Too wide: shrunk toward the column, never under 11.
  assert(headerNamePt('Bartholomew Ashworth', 30, 1.2) >= 11);
  assertEquals(headerNamePt('Bartholomew Ashworth', 30, 1), 11);
  // 16 managers scroll anyway: the columns widen to the widest first name, so "Robertino" fits.
  const names = STRESS_SEATS.map((s) => s.name);
  const nameWidth = headerNameWidth(names, 1);
  const l = boardLayout({ columns: 16, available: 354, fontScale: 1, nameWidth });
  assertEquals(l.scrolls, true);
  // Every first name fits its column at its FULL size (not just at the floor, which a cut name also hits).
  assert(l.columnWidth >= nameWidth, `${l.columnWidth} < ${nameWidth}`);
  for (const n of names) assert(estimateNameWidth(boardFirstName(n), 11) <= l.columnWidth, n);
  // A board that fits keeps its width (names shrink/ellipsize there instead).
  assertEquals(boardLayout({ columns: 6, available: 354, fontScale: 1, nameWidth: 400 }).columnWidth, 59);
  const board = SOURCES['components/game/DraftBoard.tsx'];
  assert(board.includes('fontSize: headerNamePt(name, layout.columnWidth, fontScale)'));
  assert(board.includes('allowFontScaling={false}'));
  assert(!board.includes('adjustsFontSizeToFit'));
});

import { fixtureDraftOrder } from '../lib/game/seamFixtures.ts';
import { fixtureStartsAtMs } from '../lib/game/autoStartFixture.ts';

Deno.test('the lobby fixtures agree: the order is set only once the room opens, at the draft time − 1h', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const now = Date.parse('2026-10-13T16:00:00Z');
  const open = fixtureDraftOrder(ids, 'room_open', now);
  assertEquals(open.state, 'finalized');
  assertEquals(Date.parse(String(open.finalize_at)), (fixtureStartsAtMs('room_open', now) as number) - 3_600_000);
  assertEquals(open.order?.length, 6);
  for (const st of ['scheduled', 'at_risk', 'no_date', 'postponed']) {
    const o = fixtureDraftOrder(ids, st, now);
    assertEquals(o.state, 'open', st);
    assertEquals(o.order, null, st);
  }
  // ≥ 4 managers: never "waiting for managers" in these.
  assertEquals(open.waiting_for_members, false);
  // The room's captures (no start fixture): the order is set.
  assertEquals(fixtureDraftOrder(ids, null, now).state, 'finalized');
  // The at-risk stepper agrees with "8 playoff teams, but 7 teams are in".
  assert(SOURCES['lib/shell/devFixture.ts'].includes('playoff_teams: 8,'));
});

import { orderSetLine } from '../lib/game/draftLobby.ts';

Deno.test('"Draft order set …, an hour before the draft" hides when there is no draft time (reachable after a postponement)', () => {
  assertEquals(orderSetLine('Draft order set Tue 3:55 PM ET, an hour before the draft', '2026-10-13T20:55:00Z'), 'Draft order set Tue 3:55 PM ET, an hour before the draft');
  assertEquals(orderSetLine('Draft order set Tue 3:55 PM ET, an hour before the draft', null), null);
  assertEquals(orderSetLine(null, '2026-10-13T20:55:00Z'), null);
  assert(SOURCES['components/game/DraftLobby.tsx'].includes('orderSetLine(orderWasSetLine(data.finalizeAt), draftDate)'));
});

Deno.test('the lobby order is ManagerRow itself (its order kind), not a hand copy', () => {
  const lobby = SOURCES['components/game/DraftLobby.tsx'];
  assert(lobby.includes('<ManagerRow key={id} kind="order" rank={i + 1} name={nameOf(id)} isYou={id === myUserId} />'));
  assert(!lobby.includes('styles.orderRow'));
  const row = SOURCES['components/sp/gn/ManagerRow.tsx'];
  assert(row.includes("if (props.kind === 'order') {"));
  assert(row.includes('<Text variant="score.md" color={colors.text2} style={styles.rank}>{rank}</Text>'));
});

Deno.test('someone else\'s last 10 s has a fixture: after your pick, Paolo at 8 s', () => {
  assertEquals(parseDraftRoomVariant('theirs_last10'), 'theirs_last10');
  assertEquals(draftRoomPicks('theirs_last10').length, 11);
  assertEquals(new Date(String(draftRoomClock('theirs_last10', 0).deadline_at)).getTime(), 8_000);
});

import { managersProgressShown } from '../lib/game/draftLobby.ts';

Deno.test('the waiting card counts managers only toward the minimum ("6 of 4 managers" is hidden)', () => {
  assertEquals(managersProgressShown(3, 4), true);
  assertEquals(managersProgressShown(4, 4), false);
  assertEquals(managersProgressShown(6, 4), false);
  assert(SOURCES['components/game/DraftLobby.tsx'].includes('{managersProgressShown(data.memberCount, data.minMembers) ? <Text variant="caption" tone="secondary">{managersProgressCaption(data.memberCount, data.minMembers)}</Text> : null}'));
});

Deno.test('the 90-second clock fixture: 88 s left of a 90 s pick', () => {
  assertEquals(parseDraftRoomVariant('on_clock_90'), 'on_clock_90');
  const c = draftRoomClock('on_clock_90', 0);
  assertEquals(c.pick_seconds, 90);
  assertEquals(new Date(String(c.deadline_at)).getTime(), 88_000);
  assertEquals(draftRoomPicks('on_clock_90').length, 10);
});

Deno.test('no "Auto" tag on the board (Giorgio, 2026-10-13, final): the tile draws no auto mark', () => {
  const tile = strip(SOURCES['components/sp/gn/DraftTile.tsx']);
  // `auto` reaches only the VoiceOver label; nothing on the tile says it.
  assert(!/>\s*Auto\s*</i.test(tile));
  assert(!/['"`]AUTO['"`]/.test(tile));
  assert(!/auto\s*\?\s*</.test(tile));
  assert(tile.includes('draftTileLabel({ pick, state, spoken: spokenTicker ?? ticker, category, clock, yours, auto })'));
  assert(!strip(SOURCES['components/game/DraftBoard.tsx']).includes('variant="tag"'));
});
