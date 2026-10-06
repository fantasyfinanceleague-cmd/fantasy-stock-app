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

import { PICK_REFUSAL_NEXT_STEP, pickRefusalLine, pickRefusalNextStep } from '../lib/game/draftRoom.ts';

Deno.test('the existing refusal lines are verbatim, and an unknown reason is one generic line', () => {
  assertEquals(pickRefusalLine('not_your_turn'), "It's not your turn to pick");
  assertEquals(pickRefusalLine('symbol_owned'), 'That stock is already owned in this league');
  assertEquals(pickRefusalLine('some_new_reason'), "That pick can't be made.");
});

Deno.test('would_strand_slot: the board\'s generic line with the stock (the server returns no names today)', () => {
  assertEquals(pickRefusalLine('would_strand_slot', { stock: 'orcl' }), 'Taking ORCL would leave another manager with no stock for one of their slots.');
});

Deno.test('would_strand_slot: the specific line once the manager and the slot are known (board #game "Pick refused")', () => {
  assertEquals(
    pickRefusalLine('would_strand_slot', { stock: 'ORCL', manager: 'Paolo M.', slot: 'Tech' }),
    'Taking ORCL would leave Paolo M. with no stock that fits their Tech slot. Every slot has to be fillable.',
  );
  // Half the names is still the generic line, never a sentence with a hole in it.
  assertEquals(pickRefusalLine('would_strand_slot', { stock: 'ORCL', manager: 'Paolo M.' }), 'Taking ORCL would leave another manager with no stock for one of their slots.');
});

Deno.test('budget_reserve: the board\'s generic line with the stock', () => {
  assertEquals(pickRefusalLine('budget_reserve', { stock: 'ORCL' }), 'ORCL would leave too little budget for your remaining picks.');
});

Deno.test('with no stock known, the never-skips refusals fall back to the one generic line', () => {
  assertEquals(pickRefusalLine('would_strand_slot'), "That pick can't be made.");
  assertEquals(pickRefusalLine('budget_reserve'), "That pick can't be made.");
});

Deno.test('the next step under the never-skips refusals only', () => {
  assertEquals(PICK_REFUSAL_NEXT_STEP, 'Your clock is still running. Pick from the list, or let your queue pick for you.');
  assertEquals(pickRefusalNextStep('would_strand_slot'), PICK_REFUSAL_NEXT_STEP);
  assertEquals(pickRefusalNextStep('budget_reserve'), PICK_REFUSAL_NEXT_STEP);
  assertEquals(pickRefusalNextStep('symbol_owned'), null);
  assertEquals(pickRefusalNextStep('not_your_turn'), null);
});

Deno.test('no refusal line is a placeholder', () => {
  for (const r of ['would_strand_slot', 'budget_reserve', 'not_your_turn', 'symbol_owned', 'no_eligible_slot', 'x']) {
    assertEquals(pickRefusalLine(r, { stock: 'NVDA' }).includes('[new copy'), false, r);
  }
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

import { picksUntilYouLine, roundPickLine } from '../lib/game/draftRoom.ts';
import { upNextLine } from '../lib/home/homeCopy.ts';
import { picksUntilTurn } from '../lib/home/draftTurn.ts';

Deno.test('the room: "Round 2 of 6 · Pick 11"', () => {
  assertEquals(roundPickLine(2, 6, 11), 'Round 2 of 6 · Pick 11');
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
  assertEquals(room.includes('roundPickLine(round, rounds, onClockPick)'), true);
  assertEquals(room.includes('!isMyTurn && picksUntilYouLine(picksAway)'), true);
});

// ── UX rule 4: your team in the room (Home's grid), and the budget left ──

import { budgetLeftLine, myDraftedSoFar } from '../lib/game/draftRoom.ts';
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
  assertEquals(mine, { symbols: ['NVDA', 'AAPL'], prices: [318.37, 211.42] });
});

Deno.test('budget left: the cap minus what your picks cost, in dollars', () => {
  assertEquals(budgetLeftLine(2500, [318.37, 211.42]), 'Budget left $1,970.21');
  assertEquals(budgetLeftLine(2500, []), 'Budget left $2,500');
  assertEquals(budgetLeftLine(1000, [600, 500]), 'Budget left $0'); // never negative
});

Deno.test('budget left is real or absent: no cap, or any unknown price, shows nothing', () => {
  assertEquals(budgetLeftLine(null, [100]), null);
  assertEquals(budgetLeftLine(undefined, [100]), null);
  assertEquals(budgetLeftLine(2500, [100, null]), null);
});

Deno.test('indexPicks keeps the price as a number (or null), from a number or a numeric string', () => {
  const p = indexPicks([
    { pick_number: 1, symbol: 'A', pick_source: 'manual', entry_price: '12.5' },
    { pick_number: 2, symbol: 'B', pick_source: 'manual' },
    { pick_number: 3, symbol: 'C', pick_source: 'manual', entry_price: 'x' },
  ]);
  assertEquals([p.get(1)!.price, p.get(2)!.price, p.get(3)!.price], [12.5, null, null]);
});

Deno.test('the room and Home show the SAME team grid (source guard)', () => {
  assertEquals(SOURCES['components/game/DraftRoom.tsx'].includes('<TeamSoFarGrid symbols={mine.symbols} numRounds={rounds} footer={budgetLine} />'), true);
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

Deno.test('a transport error never says "That pick can\'t be made.": it says Checking…, re-reads, and clears on the new board', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  const t = room.indexOf('if (r.transport) {');
  const unconfirmed = room.indexOf('setRefusal({ line: PICK_UNCONFIRMED, next: null, checking: true });', t);
  const reread = room.indexOf('room.refresh();', unconfirmed);
  assertEquals(t > 0 && unconfirmed > t && reread > unconfirmed, true);
  assertEquals(room.includes('setRefusal((cur) => (cur?.checking ? null : cur));'), true);
});

// ── UX rule 11: your pick confirmed, for ~3 s ──

import { PICK_CONFIRMED_MS, pickConfirmedLine } from '../lib/game/draftRoom.ts';

Deno.test('the confirmation line (the Design Lead\'s), and its edges', () => {
  assertEquals(pickConfirmedLine('nvda', 3), 'NVDA is yours. Next pick in 3 turns.');
  assertEquals(pickConfirmedLine('NVDA', 1), 'NVDA is yours. Next pick in 1 turn.');
  assertEquals(pickConfirmedLine('NVDA', -1), "NVDA is yours. That's your team.");
  assertEquals(pickConfirmedLine('NVDA', 0), 'NVDA is yours. You pick again next.'); // the snake's turn
  assertEquals(PICK_CONFIRMED_MS, 3000);
});

Deno.test('next pick counted AFTER your pick, on the snake (4 teams)', () => {
  const order = ['a', 'b', 'c', 'me'];
  // You took pick 4 (last of round 1): round 2 reverses, so you pick 5 at once.
  assertEquals(pickConfirmedLine('AAPL', picksUntilTurn(order, 4, 6, 'me')), 'AAPL is yours. You pick again next.');
  // You took pick 5: next yours is 12 (round 3 forward: a9 b10 c11 me12) → 6 picks between.
  assertEquals(pickConfirmedLine('MSFT', picksUntilTurn(order, 5, 6, 'me')), 'MSFT is yours. Next pick in 6 turns.');
  // Your last pick of a 2-round draft: none left.
  assertEquals(pickConfirmedLine('COST', picksUntilTurn(order, 5, 2, 'me')), "COST is yours. That's your team.");
});

Deno.test('the room shows it in the clock card after a successful pick, then clears it (source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assertEquals(room.includes('setConfirmed(pickConfirmedLine(symbol, picksUntilTurn(room.order, onClockPick, rounds, myUserId)));'), true);
  assertEquals(room.includes('setTimeout(() => setConfirmed(null), PICK_CONFIRMED_MS)'), true);
});
