/**
 * Hermetic unit tests for auto-pick.ts (the pick clock's server auto-pick).
 * No DB, no Alpaca, no Deno runtime APIs — run:
 *
 *   deno test supabase/functions/_shared/auto-pick.test.ts
 */

import { assertEquals } from 'jsr:@std/assert';
import type { BotSymbolCandidate } from './bot-pick.ts';
import {
  BEST_MAX_ATTEMPTS,
  type BestAvailableStrategy,
  decideAutoPickGate,
  decideNoPick,
  type DraftClock,
  MARKET_CAP_STRATEGY,
  openBrackets,
  parseDraftClockRow,
  planAutoPickCandidates,
  type PlanInputs,
  postgrestInList,
  QUEUE_MAX_ATTEMPTS,
} from './auto-pick.ts';
import type { LeagueRules, PickRow, Slot } from './draft-validation.ts';

const rules: LeagueRules = { stakeMode: null, budgetAmount: null, notionalPerSlot: null, numRounds: 6 };

const c = (symbol: string, o: Partial<BotSymbolCandidate> = {}): BotSymbolCandidate => ({
  symbol,
  lastPrice: 100,
  isDraftable: true,
  marketCap: 1_000,
  ...o,
});
const pick = (user_id: string, symbol: string, n: number, o: Partial<PickRow> = {}): PickRow => ({
  user_id,
  symbol,
  entry_price: 100,
  quantity: 1,
  pick_number: n,
  ...o,
});
const slot = (id: string, min: number | null, max: number | null, o: Partial<Slot> = {}): Slot => ({
  id,
  slotIndex: Number(id.replace(/\D/g, '')) || 0,
  slotCount: 1,
  priceMin: min,
  priceMax: max,
  categoryId: null,
  ...o,
});

// ---------------------------------------------------------------------------
// decideAutoPickGate
// ---------------------------------------------------------------------------

const clock = (o: Partial<DraftClock> = {}): DraftClock => ({
  draftStatus: 'in_progress',
  clockRunning: true,
  pickSeconds: 60,
  picksMade: 4,
  turnStartedAt: '2026-10-10T12:00:00Z',
  deadlineAt: '2026-10-10T12:01:00Z',
  serverNow: '2026-10-10T12:01:00Z',
  ...o,
});

Deno.test('gate: exactly at the deadline is overdue (server clock)', () => {
  assertEquals(decideAutoPickGate(5, clock()), { kind: 'go' });
});

Deno.test('gate: 100ms before the deadline is not overdue, and says when', () => {
  assertEquals(decideAutoPickGate(5, clock({ serverNow: '2026-10-10T12:00:59.900Z' })), {
    kind: 'not_overdue',
    deadlineAt: '2026-10-10T12:01:00Z',
    serverNow: '2026-10-10T12:00:59.900Z',
  });
});

Deno.test('gate: an already-recorded pick is idempotent success, before any status check', () => {
  assertEquals(decideAutoPickGate(4, clock()), { kind: 'already_recorded' });
  assertEquals(decideAutoPickGate(1, clock()), { kind: 'already_recorded' });
  // The pick that finished the draft: status is completed, still "recorded".
  assertEquals(decideAutoPickGate(4, clock({ draftStatus: 'completed', clockRunning: false })), { kind: 'already_recorded' });
});

Deno.test('gate: a pick number ahead of the draft is stale', () => {
  assertEquals(decideAutoPickGate(6, clock()), { kind: 'stale_pick_number' });
  assertEquals(decideAutoPickGate(0, clock()), { kind: 'stale_pick_number' });
  assertEquals(decideAutoPickGate(Number.NaN, clock()), { kind: 'stale_pick_number' });
});

Deno.test('gate: not in progress / unclocked drafts are never auto-picked', () => {
  assertEquals(decideAutoPickGate(5, clock({ draftStatus: 'not_started' })), { kind: 'draft_not_in_progress' });
  assertEquals(decideAutoPickGate(5, clock({ clockRunning: false, deadlineAt: null })), { kind: 'clock_not_running' });
});

Deno.test('parseDraftClockRow: maps the RPC row; rejects garbage', () => {
  assertEquals(
    parseDraftClockRow({
      league_id: 'l',
      draft_status: 'in_progress',
      clock_running: true,
      pick_seconds: 45,
      picks_made: 3,
      turn_started_at: 'a',
      deadline_at: 'b',
      server_now: 'c',
    }),
    { draftStatus: 'in_progress', clockRunning: true, pickSeconds: 45, picksMade: 3, turnStartedAt: 'a', deadlineAt: 'b', serverNow: 'c' },
  );
  assertEquals(parseDraftClockRow(null), null);
  assertEquals(parseDraftClockRow({ picks_made: 1 }), null);
});

// ---------------------------------------------------------------------------
// openBrackets
// ---------------------------------------------------------------------------

Deno.test('openBrackets: slot-less league = one unbounded bracket', () => {
  assertEquals(openBrackets(rules, [], [], [], 'u'), [{ min: null, max: null }]);
});

Deno.test('openBrackets: only slots with spare capacity; SKIP rows occupy nothing', () => {
  const slots = [slot('s1', 0, 10), slot('s2', 10, 50), slot('s3', 50, null)];
  const picks = [pick('u', 'AAA', 1, { slot_id: 's2' }), pick('u', 'SKIP', 2, { slot_id: 's1' }), pick('v', 'BBB', 3, { slot_id: 's3' })];
  assertEquals(openBrackets(rules, slots, picks, [], 'u'), [{ min: 0, max: 10 }, { min: 50, max: null }]);
});

Deno.test('openBrackets: budget_cap clamps the top of every bracket to what is left', () => {
  const r: LeagueRules = { ...rules, stakeMode: 'budget_cap', budgetAmount: 300 };
  const slots = [slot('s1', 0, 50), slot('s2', 100, null), slot('s3', 250, 500)];
  const picks = [pick('u', 'AAA', 1, { entry_price: 120, slot_id: 'sX' })]; // 180 left
  assertEquals(openBrackets(r, slots, picks, [], 'u'), [{ min: 0, max: 50 }, { min: 100, max: 180 }]);
});

Deno.test('openBrackets: budget exhausted = nothing open', () => {
  const r: LeagueRules = { ...rules, stakeMode: 'budget_cap', budgetAmount: 100 };
  assertEquals(openBrackets(r, [], [pick('u', 'AAA', 1)], [], 'u'), []);
});

Deno.test('openBrackets: duplicate brackets collapse', () => {
  const slots = [slot('s1', 0, 10), slot('s2', 0, 10)];
  assertEquals(openBrackets(rules, slots, [], [], 'u'), [{ min: 0, max: 10 }]);
});

// ---------------------------------------------------------------------------
// planAutoPickCandidates
// ---------------------------------------------------------------------------

const plan = (o: Partial<PlanInputs>) =>
  planAutoPickCandidates({
    isBot: false,
    rules,
    slots: [],
    picks: [],
    trades: [],
    pickerId: 'u',
    queue: [],
    queueMeta: [],
    pool: [],
    strategy: MARKET_CAP_STRATEGY,
    ...o,
  });

Deno.test('plan: queue first IN THE MANAGER\'S ORDER, then best available by market cap', () => {
  const out = plan({
    queue: ['SMALL', 'BIG'],
    queueMeta: [c('SMALL', { marketCap: 1 }), c('BIG', { marketCap: 9 })],
    pool: [c('MID', { marketCap: 5 }), c('HUGE', { marketCap: 99 })],
  });
  assertEquals(out, [
    { symbol: 'SMALL', source: 'auto_queue' },
    { symbol: 'BIG', source: 'auto_queue' },
    { symbol: 'HUGE', source: 'auto_best' },
    { symbol: 'MID', source: 'auto_best' },
  ]);
});

Deno.test('plan: owned / non-draftable / off-bracket / over-budget queue items are skipped, order kept', () => {
  const r: LeagueRules = { ...rules, stakeMode: 'budget_cap', budgetAmount: 1000 };
  const out = plan({
    rules: r,
    slots: [slot('s1', 10, 500)],
    picks: [pick('x', 'TAKEN', 1)],
    queue: ['TAKEN', 'JUNK', 'PENNY', 'PRICEY', 'OK1', 'OK2'],
    queueMeta: [
      c('TAKEN'),
      c('JUNK', { isDraftable: false }),
      c('PENNY', { lastPrice: 2 }),
      c('PRICEY', { lastPrice: 1500 }),
      c('OK2'),
      c('OK1'),
    ],
  });
  assertEquals(out.map((x) => x.symbol), ['OK1', 'OK2']);
});

Deno.test('plan: an unpriced queued symbol still gets one live attempt; an unpriced pool symbol does not', () => {
  const out = plan({ queue: ['NEW'], queueMeta: [c('NEW', { lastPrice: null })], pool: [c('NOPX', { lastPrice: null })] });
  assertEquals(out, [{ symbol: 'NEW', source: 'auto_queue' }]);
});

Deno.test('plan: a queued symbol missing from the catalog is dropped', () => {
  assertEquals(plan({ queue: ['GHOST'], queueMeta: [] }), []);
});

Deno.test('plan: best available never repeats a queue candidate', () => {
  const out = plan({ queue: ['AAA'], queueMeta: [c('AAA')], pool: [c('AAA', { marketCap: 99 }), c('BBB')] });
  assertEquals(out, [{ symbol: 'AAA', source: 'auto_queue' }, { symbol: 'BBB', source: 'auto_best' }]);
});

Deno.test('plan: attempt caps per source', () => {
  const syms = Array.from({ length: 12 }, (_, i) => `Q${String(i).padStart(2, '0')}`);
  const poolSyms = Array.from({ length: 12 }, (_, i) => `P${String(i).padStart(2, '0')}`);
  const out = plan({ queue: syms, queueMeta: syms.map((s) => c(s)), pool: poolSyms.map((s) => c(s)) });
  assertEquals(out.filter((x) => x.source === 'auto_queue').length, QUEUE_MAX_ATTEMPTS);
  assertEquals(out.filter((x) => x.source === 'auto_best').length, BEST_MAX_ATTEMPTS);
});

Deno.test('plan: bots ignore any queue and are tagged bot', () => {
  const out = plan({ isBot: true, pickerId: 'bot-1', queue: ['AAA'], queueMeta: [c('AAA')], pool: [c('BBB')] });
  assertEquals(out, [{ symbol: 'BBB', source: 'bot' }]);
});

Deno.test('plan: with category eligibility, candidates must fit an OPEN slot by price AND category', () => {
  const slots = [slot('s1', null, null, { categoryId: 'tech' }), slot('s2', null, null, { categoryId: 'energy' })];
  const eligibility = new Map([
    ['CHIP', new Set(['tech'])],
    ['OIL', new Set(['energy'])],
    ['BANK', new Set(['fin'])],
  ]);
  const out = plan({
    slots,
    picks: [pick('u', 'SOFT', 1, { slot_id: 's1' })], // tech slot already filled
    pool: [c('CHIP', { marketCap: 99 }), c('BANK', { marketCap: 50 }), c('OIL', { marketCap: 1 })],
    eligibility,
  });
  assertEquals(out.map((x) => x.symbol), ['OIL']);
});

Deno.test('plan: nothing looks legal -> empty (caller records auto_skip)', () => {
  assertEquals(plan({ pool: [c('AAA')], picks: [pick('x', 'AAA', 1)] }), []);
});

Deno.test('plan: the ranking is pluggable without touching the gate or queue handling', () => {
  const alphabetical: BestAvailableStrategy = {
    id: 'test_alpha',
    poolOrderColumn: 'market_cap',
    poolPerBracket: 10,
    rank: (i) => i.candidates.map((x) => x.symbol).sort(),
  };
  const out = plan({
    strategy: alphabetical,
    queue: ['ZED'],
    queueMeta: [c('ZED')],
    pool: [c('MMM', { marketCap: 99 }), c('AAA', { marketCap: 1 })],
  });
  assertEquals(out.map((x) => x.symbol), ['ZED', 'AAA', 'MMM']);
});

// ---------------------------------------------------------------------------
// decideNoPick
// ---------------------------------------------------------------------------

Deno.test('noPick: a human is auto-skipped only for legality, never for a vendor outage', () => {
  assertEquals(decideNoPick(false, 0, 0), { kind: 'skip', source: 'auto_skip' }); // nothing looked legal
  assertEquals(decideNoPick(false, 4, 2), { kind: 'skip', source: 'auto_skip' }); // priced, all illegal
  assertEquals(decideNoPick(false, 4, 0), { kind: 'retry_later' }); // Alpaca down: keep the turn open
});

Deno.test('noPick: bots keep the existing skip rule (even on an outage)', () => {
  assertEquals(decideNoPick(true, 4, 0), { kind: 'skip', source: 'skip' });
  assertEquals(decideNoPick(true, 0, 0), { kind: 'skip', source: 'skip' });
});

Deno.test('postgrestInList: quotes dotted tickers, drops anything unsafe', () => {
  assertEquals(postgrestInList(['brk.b', 'AAPL', 'x"),or(']), '("BRK.B","AAPL")');
});
