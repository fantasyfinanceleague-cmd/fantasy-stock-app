/**
 * Draft room rules (3c): the pick-log line for each pick_source (the Auto badge
 * for auto_%), and the clock state (on the clock, the last 10 seconds, auto-
 * picking past the deadline until the row arrives). Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { pickLogLine, isAutoPick, clockState, pickRowView } from '../lib/game/draftRoom.ts';

Deno.test('the pick log says where each pick came from, in the board\'s words', () => {
  assertEquals(pickLogLine('auto_queue'), 'Auto-picked · from their queue');
  assertEquals(pickLogLine('auto_best'), 'Auto-picked · best available');
  assertEquals(pickLogLine('manual'), 'Picked');
  assertEquals(pickLogLine('bot'), 'Picked');
});

Deno.test('a legacy SKIP row is a plain row: a dash for the symbol, no label, no badge, not counted, never the word Skip', () => {
  const row = pickRowView({ symbol: 'SKIP', source: 'skip' });
  assertEquals(row, { symbolCell: '—', symbolLabel: 'No pick', label: null, auto: false, countsAsPick: false });
  const autoSkip = pickRowView({ symbol: 'SKIP', source: 'auto_skip' });
  assertEquals(autoSkip, { symbolCell: '—', symbolLabel: 'No pick', label: null, auto: false, countsAsPick: false });
  // VoiceOver reads the Design Lead's label, never "dash" or nothing.
  assertEquals(row.symbolLabel, 'No pick');
  const text = JSON.stringify([row, autoSkip]);
  assertEquals(/skip/i.test(text), false);
});

Deno.test('a real pick is shown with its symbol, its line and whether it counts', () => {
  assertEquals(pickRowView({ symbol: 'LLY', source: 'auto_queue' }), { symbolCell: 'LLY', symbolLabel: 'LLY', label: 'Auto-picked · from their queue', auto: true, countsAsPick: true });
});

Deno.test('the Auto badge marks every auto pick and nothing else', () => {
  assertEquals(isAutoPick('auto_queue'), true);
  assertEquals(isAutoPick('auto_best'), true);
  assertEquals(isAutoPick('manual'), false);
  assertEquals(isAutoPick('bot'), false);
});

Deno.test('the clock: on the clock with time left, the last 10 seconds, and auto-picking past the deadline', () => {
  const deadline = '2026-10-05T19:00:30.000Z';
  assertEquals(clockState({ running: true, deadlineAt: deadline, serverNow: '2026-10-05T19:00:00.000Z' }).kind, 'on_clock');
  assertEquals(clockState({ running: true, deadlineAt: deadline, serverNow: '2026-10-05T19:00:25.000Z' }).kind, 'last10');
  assertEquals(clockState({ running: true, deadlineAt: deadline, serverNow: '2026-10-05T19:00:31.000Z' }).kind, 'auto_picking');
});

Deno.test('a stopped clock or a missing deadline is idle, never a guessed countdown', () => {
  assertEquals(clockState({ running: false, deadlineAt: null, serverNow: '2026-10-05T19:00:00.000Z' }).kind, 'idle');
  assertEquals(clockState({ running: true, deadlineAt: null, serverNow: '2026-10-05T19:00:00.000Z' }).kind, 'idle');
});

Deno.test('the seconds left come from the server clock, so the device clock cannot skew them', () => {
  const s = clockState({ running: true, deadlineAt: '2026-10-05T19:00:30.000Z', serverNow: '2026-10-05T19:00:20.000Z' });
  assertEquals(s.secondsLeft, 10);
});

// ── The pick clock as m:ss (P0, Design Lead audit: it read "0:75" / "0:90") ──

import { pickClockLabel } from '../lib/game/draftRoom.ts';

const on = (secondsLeft: number) => clockState({ running: true, deadlineAt: new Date(Date.parse('2026-10-03T23:00:00Z') + secondsLeft * 1000).toISOString(), serverNow: '2026-10-03T23:00:00Z' });

Deno.test('every pick clock length reads m:ss at the start of a turn: 30 / 45 / 60 / 75 / 90', () => {
  assertEquals(pickClockLabel(on(30)), '0:30');
  assertEquals(pickClockLabel(on(45)), '0:45');
  assertEquals(pickClockLabel(on(60)), '1:00');
  assertEquals(pickClockLabel(on(75)), '1:15');
  assertEquals(pickClockLabel(on(90)), '1:30');
});

Deno.test('the last 10 seconds: 0:10 down to 0:01, still the last10 state', () => {
  for (let s = 10; s >= 1; s--) {
    const c = on(s);
    assertEquals(c.kind, 'last10');
    assertEquals(pickClockLabel(c), `0:${String(s).padStart(2, '0')}`);
  }
  assertEquals(pickClockLabel(on(11)), '0:11');
  assertEquals(on(11).kind, 'on_clock');
});

Deno.test('no clock while idle or auto-picking (the headline says it)', () => {
  assertEquals(pickClockLabel(clockState({ running: false, deadlineAt: null, serverNow: '2026-10-03T23:00:00Z' })), '');
  assertEquals(pickClockLabel(on(0)), '');
  assertEquals(pickClockLabel(on(-3)), '');
});

Deno.test('never "0:75": no label has more than 59 seconds after the colon', () => {
  for (let s = 1; s <= 90; s++) {
    const secs = Number(pickClockLabel(on(s)).split(':')[1]);
    assertEquals(secs <= 59, true, String(s));
  }
});

import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('the draft room renders the clock through pickClockLabel, never a hand-built "0:" (source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assertEquals(room.includes('{pickClockLabel(room.clock)}'), true);
  assertEquals(room.includes('`0:${'), false);
});

// ── UX rule 10: the round with its total, and how far your next pick is ──

import { picksUntilYouLine, roundPickLine, snakeThenPick } from '../lib/game/draftRoom.ts';
import { upNextLine } from '../lib/home/homeCopy.ts';
import { picksUntilTurn } from '../lib/home/draftTurn.ts';

Deno.test('the room: "Round 2 of 6 · Pick 11", and the snake\'s turn "Pick 12, then 13" (board key screen 4)', () => {
  assertEquals(roundPickLine(2, 6, 11), 'Round 2 of 6 · Pick 11');
  assertEquals(roundPickLine(2, 6, 12, 13), 'Round 2 of 6 · Pick 12, then 13');
});

Deno.test('"then" only when the manager on the clock holds the next pick too (6 teams)', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f'];
  assertEquals(snakeThenPick(order, 6, 36), 7); // f ends round 1 and opens round 2
  assertEquals(snakeThenPick(order, 12, 36), 13); // a ends round 2 and opens round 3
  assertEquals(snakeThenPick(order, 11, 36), null); // b, then a
  assertEquals(snakeThenPick(order, 1, 36), null);
  assertEquals(snakeThenPick(order, 36, 36), null); // the last pick has no next
  assertEquals(snakeThenPick([], 1, 0), null);
});

Deno.test('the room: "{k} picks until you", singular, and nothing on your turn or with no pick left', () => {
  assertEquals(picksUntilYouLine(3), '3 picks until you');
  assertEquals(picksUntilYouLine(1), '1 pick until you');
  assertEquals(picksUntilYouLine(0), null);
  assertEquals(picksUntilYouLine(-1), null);
});

Deno.test('Home: "Round 2 of 6 · Pick 11 · you\'re up in 3 picks"', () => {
  assertEquals(upNextLine(2, 6, 11, 3), "Round 2 of 6 · Pick 11 · you're up in 3 picks");
  assertEquals(upNextLine(1, 6, 2, 1), "Round 1 of 6 · Pick 2 · you're up in 1 pick");
});

Deno.test('picks until you follows the snake (4 teams; you are seat 2)', () => {
  const order = ['a', 'me', 'c', 'd'];
  assertEquals(picksUntilTurn(order, 0, 6, 'me'), 1); // pick 1 is a's, then you
  assertEquals(picksUntilTurn(order, 2, 6, 'me'), 4); // picks 3,4 then round 2 reverses: d(5) c(6) you(7)
  assertEquals(picksUntilYouLine(picksUntilTurn(order, 2, 6, 'me')), '4 picks until you');
});

Deno.test('the room renders both lines (source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assertEquals(room.includes('roundPickLine(round, rounds, onClockPick, snakeThenPick(room.order, onClockPick, totalPicks))'), true);
  // Before your first pick, the picks-until line; after it, the board's "You took …" line.
  assertEquals(room.includes('!isMyTurn && !lastMine && picksUntilYouLine(picksAway)'), true);
});

// ── U-06: the board's roster strip ("Your roster · 1 of 6 · $2,000 per slot"), Home's grid ──

import { YOUR_ROSTER, budgetLeft, myDraftedSoFar, rosterCaption } from '../lib/game/draftRoom.ts';
import { indexPicks } from '../lib/game/draftBoard.ts';

Deno.test('your picks, in pick order, from the snake (4 teams, you are seat 2); a SKIP row is not a stock', () => {
  const picks = indexPicks([
    { pick_number: 1, symbol: 'MSFT', pick_source: 'manual', entry_price: 421 },
    { pick_number: 2, symbol: 'NVDA', pick_source: 'manual', entry_price: '318.37' },
    { pick_number: 7, symbol: 'AAPL', pick_source: 'auto_queue', entry_price: 211.42 },
    { pick_number: 10, symbol: 'SKIP', pick_source: 'skip', entry_price: null },
    { pick_number: 3, symbol: 'META', pick_source: 'manual', entry_price: 508 },
  ]);
  const mine = myDraftedSoFar(picks, ['a', 'me', 'c', 'd'], 'me');
  assertEquals(mine, { symbols: ['NVDA', 'AAPL'], prices: [318.37, 211.42], sources: ['manual', 'auto_queue'] });
});

Deno.test('budget left: the cap minus what your picks cost', () => {
  assertEquals(budgetLeft(2500, [318.37, 211.42]), 1970.21);
  assertEquals(budgetLeft(2500, []), 2500);
  assertEquals(budgetLeft(1000, [600, 500]), 0); // never negative
});

Deno.test('budget left is real or absent: no cap, or any unknown price, is null', () => {
  assertEquals(budgetLeft(null, [100]), null);
  assertEquals(budgetLeft(undefined, [100]), null);
  assertEquals(budgetLeft(2500, [100, null]), null);
});

Deno.test('the strip: the board\'s header and caption, per stake mode', () => {
  assertEquals(YOUR_ROSTER, 'Your roster');
  assertEquals(rosterCaption(1, 6, { stakeMode: 'fixed_notional', notionalPerSlot: 2000 }), '1 of 6 · $2,000 per slot');
  // Budget cap (ruled): what's left in place of the per-slot amount.
  assertEquals(rosterCaption(2, 6, { stakeMode: 'budget_cap', budgetLeft: 1970.21 }), '2 of 6 · $1,970.21 left');
  assertEquals(rosterCaption(2, 6, { stakeMode: 'budget_cap', budgetLeft: 0 }), '2 of 6 · $0 left');
});

Deno.test('the strip never invents an amount: unknown, zero per-slot, or price tiers show the count alone', () => {
  assertEquals(rosterCaption(1, 6, { stakeMode: 'fixed_notional', notionalPerSlot: null }), '1 of 6');
  assertEquals(rosterCaption(1, 6, { stakeMode: 'fixed_notional', notionalPerSlot: 0 }), '1 of 6');
  assertEquals(rosterCaption(1, 6, { stakeMode: 'budget_cap', budgetLeft: null }), '1 of 6');
  assertEquals(rosterCaption(1, 6, { stakeMode: 'price_tiers', notionalPerSlot: 2000 }), '1 of 6');
  assertEquals(rosterCaption(0, 6, { stakeMode: null }), '0 of 6');
});

Deno.test('indexPicks keeps the price as a number (or null), from a number or a numeric string', () => {
  const p = indexPicks([
    { pick_number: 1, symbol: 'A', pick_source: 'manual', entry_price: '12.5' },
    { pick_number: 2, symbol: 'B', pick_source: 'manual' },
    { pick_number: 3, symbol: 'C', pick_source: 'manual', entry_price: 'x' },
  ]);
  assertEquals([p.get(1)!.price, p.get(2)!.price, p.get(3)!.price], [12.5, null, null]);
});

Deno.test('the room and Home show the SAME team grid; the room\'s is the board\'s roster strip, under the search (source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  // Not wrapped in !draftDone any more: a finished draft returns the ending first.
  assertEquals(room.includes('<TeamSoFarGrid title={YOUR_ROSTER} caption={caption} symbols={mine.symbols} numRounds={rounds} />'), true);
  assertEquals(room.indexOf('<SymbolSearchField') < room.indexOf('<TeamSoFarGrid title={YOUR_ROSTER}'), true);
  assertEquals(SOURCES['app/(tabs)/league.tsx'].includes('notionalPerSlot={activeLeague?.notional_per_slot ?? null}'), true);
  assertEquals(SOURCES['components/home/DraftingCard.tsx'].includes('<TeamSoFarGrid symbols={myPicks} numRounds={numRounds} />'), true);
  assertEquals(SOURCES['lib/game/useDraftRoom.ts'].includes("select('pick_number, symbol, pick_source, entry_price')"), true);
});

// ── UX rule 9: the pick on its way, and an unknown outcome ──

import { PICK_SENDING, PICK_UNCONFIRMED } from '../lib/game/draftRoom.ts';

Deno.test('the ruled strings', () => {
  assertEquals(PICK_SENDING, 'Sending…');
  assertEquals(PICK_UNCONFIRMED, "Couldn't confirm your pick. Checking…");
});

Deno.test('the Draft button says Sending… and is disabled while the pick is on its way (source guard)', () => {
  assertEquals(SOURCES['components/game/DraftRoom.tsx'].includes("<Button label={pending ? PICK_SENDING : 'Draft'} onPress={draft} disabled={!selected || pending} />"), true);
});

Deno.test('a transport error or server fault never says "That pick can\'t be made.": Checking…, a re-read, cleared by the new board (source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assertEquals(room.includes('const v = pickRefusalView(r.transport ? null : r.reason, r.transport ? null : r.status, {'), true);
  assertEquals(room.includes('if (v.refresh) room.refresh();'), true);
  assertEquals(room.includes('setRefusal((cur) => (cur?.checking ? null : cur));'), true);
  assertEquals(room.includes("That pick can't be made"), false);
});

// ── U-09 (corrected): the board's "After the pick" clock card ──

import { afterPickLine } from '../lib/game/draftRoom.ts';

Deno.test('"You took AAPL · you\'re up in 2 picks" (Home\'s wording), singular, and the last pick', () => {
  assertEquals(afterPickLine('aapl', 2), "You took AAPL · you're up in 2 picks");
  assertEquals(afterPickLine('AAPL', 1), "You took AAPL · you're up in 1 pick");
  assertEquals(afterPickLine('COST', -1), "You took COST · that's your team");
  assertEquals(afterPickLine('AAPL', 0), null); // your turn: the on-clock card instead
});

Deno.test('after YOUR auto-pick (ruled): "Auto-picked AAPL for you · you\'re up in 2 picks", distinct from "You took"', () => {
  assertEquals(afterPickLine('aapl', 2, true), "Auto-picked AAPL for you · you're up in 2 picks");
  assertEquals(afterPickLine('AAPL', 1, true), "Auto-picked AAPL for you · you're up in 1 pick");
  assertEquals(afterPickLine('COST', -1, true), "Auto-picked COST for you · that's your team"); // ruled, pairs with the manual form
  assertEquals(afterPickLine('AAPL', 0, true), null);
  assertEquals(afterPickLine('AAPL', 2, false), "You took AAPL · you're up in 2 picks");
});

Deno.test('counted on the snake, from the board as read (6 teams; you are seat 1)', () => {
  const order = ['me', 'b', 'c', 'd', 'e', 'f'];
  // Board key screen 4's shape: you took 11 (6 teams, seat 2 in round 2 = pick 11 for seat 2).
  const seat2 = ['a', 'me', 'c', 'd', 'e', 'f'];
  assertEquals(afterPickLine('AAPL', picksUntilTurn(seat2, 11, 6, 'me')), "You took AAPL · you're up in 2 picks"); // 12, 13 are a's
  // You took pick 1: next yours is 12 → 10 picks between.
  assertEquals(afterPickLine('NVDA', picksUntilTurn(order, 1, 6, 'me')), "You took NVDA · you're up in 10 picks");
  // Your last pick of a 2-round draft: none left.
  assertEquals(afterPickLine('COST', picksUntilTurn(order, 12, 2, 'me')), "You took COST · that's your team");
});

Deno.test('the room shows it from the recorded board, not from the button: no timer, no "is yours" (source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assertEquals(room.includes('!isMyTurn && lastMine && afterPickLine(lastMine, picksAway, lastMineAuto)'), true);
  assertEquals(room.includes('const lastMineAuto = mine.sources.length > 0 && isAutoPick(mine.sources[mine.sources.length - 1]);'), true);
  assertEquals(room.includes('const lastMine = mine.symbols.length > 0 ? mine.symbols[mine.symbols.length - 1] : null;'), true);
  for (const gone of ['setConfirmed', 'PICK_CONFIRMED_MS', 'pickConfirmedLine', 'is yours']) assertEquals(room.includes(gone), false, gone);
  assertEquals(SOURCES['lib/game/draftRoom.ts'].includes('is yours'), false);
});

// ── U-10: the draft's ending (DraftComplete): see game-draft-complete.test.ts ──

// ── The audit's Rule 8 table › validate-and-record-pick (verbatim), and U-04 ──

import { AUTO_PICK_WAITING_FOR_PRICES, PICK_ANOTHER_NEXT_STEP, PICK_REFUSAL_REASONS, pickRefusalView } from '../lib/game/draftRoom.ts';

const mine = { stock: 'aapl', manager: 'Paolo M.', isMyTurn: true };
const line = (reason: string, status: number | null = null, ctx = mine) => pickRefusalView(reason, status, ctx).line;

Deno.test('the Message column, verbatim, with the stock and the manager', () => {
  assertEquals(line('would_strand_slot'), 'Taking AAPL would leave another manager with no stock for one of their slots.');
  assertEquals(line('budget_reserve'), 'AAPL would leave too little budget for your remaining picks.');
  assertEquals(line('symbol_owned'), 'AAPL is already taken.');
  assertEquals(line('no_eligible_slot'), "AAPL doesn't fit any of your open slots.");
  assertEquals(line('over_budget'), 'AAPL costs more than your budget left.');
  assertEquals(line('not_draftable'), "AAPL isn't in this league's list of stocks.");
  assertEquals(line('no_price'), 'AAPL has no usable price right now.');
  assertEquals(line('invalid_price'), 'AAPL has no usable price right now.');
  assertEquals(line('not_your_turn'), "It's Paolo M.'s pick now.");
  assertEquals(line('pick_conflict'), 'Someone picked at the same moment. Pick again.');
  assertEquals(line('draft_complete'), 'The draft is over. Your team is set.');
  assertEquals(line('draft_not_in_progress'), "The draft isn't running right now.");
  assertEquals(line('rate_limited', 429), 'Too many tries at once. Wait a moment, then pick again.');
  for (const r of ['not_a_member', 'forbidden_target', 'target_not_member', 'league_not_found', 'bad_request']) {
    assertEquals(line(r, 403), "That pick didn't go through.", r);
  }
  assertEquals(line('not_authenticated', 401), 'Your session ended. Sign in again.');
  assertEquals(line('something_new'), "That pick didn't go through.");
});

Deno.test('U-04: a server fault or no answer is "Checking…" and a re-read, never a refusal', () => {
  const checking = { line: "Couldn't confirm your pick. Checking…", next: null, checking: true, refresh: true };
  assertEquals(pickRefusalView(null, null, mine), checking); // network
  for (const r of ['draft_order_invalid', 'server_config_error', 'unhandled']) assertEquals(pickRefusalView(r, 500, mine), checking, r);
  assertEquals(pickRefusalView('symbol_owned', 503, mine), checking); // any 5xx: it may have landed
});

Deno.test('the shared next step shows on your turn only, and only where the table says', () => {
  assertEquals(PICK_ANOTHER_NEXT_STEP, 'Your clock is still running. Pick another stock.');
  for (const r of ['would_strand_slot', 'budget_reserve', 'symbol_owned', 'no_eligible_slot', 'over_budget', 'not_draftable', 'no_price', 'pick_conflict', 'rate_limited', 'not_a_member']) {
    assertEquals(pickRefusalView(r, null, mine).next, PICK_ANOTHER_NEXT_STEP, r);
    assertEquals(pickRefusalView(r, null, { ...mine, isMyTurn: false }).next, null, r);
  }
  for (const r of ['not_your_turn', 'draft_complete', 'draft_not_in_progress', 'not_authenticated']) {
    assertEquals(pickRefusalView(r, null, mine).next, null, r);
  }
});

Deno.test('the room re-reads after a conflict, a finished or stopped draft', () => {
  for (const r of ['pick_conflict', 'draft_complete', 'draft_not_in_progress']) assertEquals(pickRefusalView(r, null, mine).refresh, true, r);
  assertEquals(pickRefusalView('symbol_owned', null, mine).refresh, false);
});

Deno.test('rule 8: every line is a whole sentence, with no em dash and no placeholder', () => {
  for (const r of [...PICK_REFUSAL_REASONS, 'unknown', 'unhandled']) {
    const l = line(r);
    assertEquals(/[.!?…]$/.test(l), true, `${r}: ${l}`);
    assertEquals(l.includes('—'), false, r);
    assertEquals(l.includes('[new'), false, r);
  }
  assertEquals(AUTO_PICK_WAITING_FOR_PRICES, 'Auto-pick is waiting for prices. Nobody is skipped.');
});

Deno.test('no names known: the manager falls back, never an empty possessive', () => {
  assertEquals(pickRefusalView('not_your_turn', null, { stock: 'AAPL', manager: '' }).line, "It's another manager's pick now.");
});

// ── Capture pass: the sp Card has no padding or radius of its own ──

Deno.test('the room, its queue and the ending pad their cards (no bare <Card>; source guard)', () => {
  for (const p of ['components/game/DraftRoom.tsx', 'components/game/QueueEditor.tsx', 'components/game/DraftComplete.tsx']) {
    assertEquals(SOURCES[p].includes('<Card>'), false, p);
  }
  assertEquals(SOURCES['components/game/DraftRoom.tsx'].includes('card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },'), true);
  assertEquals(SOURCES['components/game/DraftComplete.tsx'].includes('hero: { borderRadius: radius.lg, padding: space[5], gap: space[2] },'), true);
});

// ── G-2 (pass-2 gate, rule 6): on your turn the clock card's one emphasis ──

Deno.test('your turn: "You\'re on the clock" in title + liveText, the clock in score type; off-turn unchanged (source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assertEquals(room.includes("const onTheClock = isMyTurn && !stalled && room.clock.kind !== 'auto_picking';"), true);
  assertEquals(room.includes('<Text variant="title" color={colors.liveText} accessibilityRole="header">{headline}</Text>'), true);
  assertEquals(room.includes("variant={onTheClock ? 'score.md' : 'headline'}"), true);
  // The last 10 s stay in loss on and off your turn.
  assertEquals(room.includes("style={{ color: room.clock.kind === 'last10' ? colors.loss : colors.text }}"), true);
  // Off your turn ("{Name} is up") keeps the plain callout.
  assertEquals(room.includes('<Text variant="callout">{headline}</Text>'), true);
  assertEquals(room.includes("style={isMyTurn ? { fontWeight: '700' } : undefined}"), false);
});

// ── G-4 (pass-2 gate, ruled): your own auto-pick in the log ──

Deno.test('your own queue auto-pick reads "from your queue"; others\' keep "their"; best available is the same for all', () => {
  assertEquals(pickLogLine('auto_queue', true), 'Auto-picked · from your queue');
  assertEquals(pickLogLine('auto_queue', false), 'Auto-picked · from their queue');
  assertEquals(pickLogLine('auto_best', true), 'Auto-picked · best available');
  assertEquals(pickLogLine('manual', true), 'Picked');
  assertEquals(pickRowView({ symbol: 'AAPL', source: 'auto_queue' }, true).label, 'Auto-picked · from your queue');
  assertEquals(pickRowView({ symbol: 'SKIP', source: 'skip' }, true).label, null); // a legacy skip is still a plain dash
});

Deno.test('the room passes "mine" by the snake seat (source guard)', () => {
  assertEquals(SOURCES['components/game/DraftRoom.tsx'].includes('pickRowView({ symbol: p.symbol, source: p.source }, managerAtPick(pick, room.order) === myUserId)'), true);
});
