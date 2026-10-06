/**
 * Hermetic tests for auto-pick.ts (the pick clock's server auto-pick) and
 * pick-gate.ts. No DB, no Alpaca, no Deno runtime APIs — run:
 *
 *   deno test supabase/functions/_shared/auto-pick.test.ts
 *
 * The heart of this file is Giorgio's acceptance criterion: auto-draft must
 * NEVER give someone a stock their league's rules forbid, and must not skip
 * when a legal stock exists. chooseAutoPick runs against an in-memory market
 * (FakeMarket) whose search port mirrors public.auto_pick_search_candidates
 * (the PGlite test proves the real SQL matches this mirror), and every result
 * is checked against the real validatePick by BRUTE FORCE over the whole
 * market — across hundreds of generated rule configurations.
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import type { BotSymbolCandidate } from './bot-pick.ts';
import {
  type AutoPickChoice,
  type AutoPickPorts,
  type AutoPickState,
  BEST_MAX_ATTEMPTS,
  type BestAvailableStrategy,
  chooseAutoPick,
  decideAutoPickGate,
  decideNoPick,
  type DraftClock,
  MARKET_CAP_STRATEGY,
  openSlotSpecs,
  parseDraftClockRow,
  planQueueCandidates,
  QUEUE_MAX_ATTEMPTS,
  type SlotSpec,
} from './auto-pick.ts';
import { type GatedPick, gatePick, type PickFeasibility } from './pick-gate.ts';
import {
  buildPoolGroups,
  demandVector,
  flexTypes,
  openInstances,
  type PoolGroup,
  type FeasibilityState,
  typesFromSlots,
} from './draft-feasibility.ts';
import { type LeagueRules, type PickRow, type Slot, type TradeRow, validatePick, leagueOwnedSymbols } from './draft-validation.ts';

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

// ===========================================================================
// FakeMarket: in-memory ports. searchCandidates mirrors the SQL exactly:
// active, !price_unsupported, draftable when draftableOnly, not excluded,
// cached price in bracket (unpriced only when !draftableOnly), category via
// effective eligibility, ORDER BY unpriced last, market_cap desc, symbol.
// ===========================================================================

interface Stock {
  symbol: string;
  cached: number | null; // symbols.last_price
  live: number | null; // Alpaca fill price (null = cannot be priced)
  draftable: boolean;
  marketCap: number;
  cats: string[]; // effective category ids ([] = unclassified, flex only)
}

class FakeMarket implements AutoPickPorts {
  priceCalls: string[] = [];
  constructor(
    public stocks: Stock[],
    public slots: Slot[] = [],
    public queue: string[] = [],
  ) {}
  row = (s: Stock): BotSymbolCandidate => ({ symbol: s.symbol, lastPrice: s.cached, isDraftable: s.draftable, marketCap: s.marketCap });
  loadSlots = () => Promise.resolve(this.slots);
  loadQueue = (_pickerId: string) =>
    Promise.resolve({
      queue: this.queue,
      meta: this.stocks.filter((s) => this.queue.includes(s.symbol)).map(this.row),
    });
  searchCandidates = (spec: SlotSpec, exclude: string[], draftableOnly: boolean, limit: number) => {
    const ex = new Set(exclude.map((x) => x.toUpperCase()));
    const rows = this.stocks
      .filter((s) => !draftableOnly || s.draftable)
      .filter((s) => !ex.has(s.symbol))
      .filter((s) =>
        s.cached == null
          ? !draftableOnly
          : s.cached > 0 && (spec.min == null || s.cached >= spec.min) && (spec.max == null || s.cached <= spec.max)
      )
      .filter((s) => spec.categoryId == null || s.cats.includes(spec.categoryId))
      .sort((a, b) =>
        Number(a.cached == null) - Number(b.cached == null) || b.marketCap - a.marketCap || a.symbol.localeCompare(b.symbol)
      )
      .slice(0, Math.min(Math.max(limit, 1), 100));
    return Promise.resolve(rows.map(this.row));
  };
  eligibility = (symbols: string[]) =>
    Promise.resolve(new Map(symbols.map((x) => [x, new Set(this.stocks.find((s) => s.symbol === x)?.cats ?? [])])));
  livePrice = (symbol: string) => {
    this.priceCalls.push(symbol);
    const s = this.stocks.find((x) => x.symbol === symbol);
    return Promise.resolve({ price: s?.live ?? null, source: 'fake' });
  };
  feasibilityPool = (types: Slot[], exclude: string[], draftableOnly: boolean, depth: number): Promise<PoolGroup[]> =>
    Promise.resolve(
      buildPoolGroups(
        types,
        this.stocks.map((s) => ({ symbol: s.symbol, cachedPrice: s.cached, eligibility: new Set(s.cats), isDraftable: s.draftable })),
        { exclude, draftableOnly, depth },
      ),
    );
}

/** A feasibility context that never refuses: one flex type, a deep pool. Used
 * by the gate unit tests that are about validatePick, not feasibility. */
const permissive = (price: number | null): PickFeasibility => {
  const types = flexTypes(6);
  const state: FeasibilityState = {
    types,
    demand: [1],
    groups: [{ ordinals: [0], n: 1000, prices: Array.from({ length: 50 }, (_, i) => i + 1) }],
    budget: null,
  };
  return { state, open: [1], cachedPrice: price, eligibility: new Set() };
};

/** The full gate (validatePick + feasibility) on a market stock, with the
 * feasibility state the auto-pick search would have built. Test oracle. */
async function gateLegal(state: AutoPickState, m: FakeMarket, pickerId: string, s: Stock): Promise<boolean> {
  if (s.live == null) return false;
  const types = typesFromSlots(m.slots, state.numRounds);
  const demand = demandVector(types, state.order, state.picks, state.numRounds);
  const owned = [...leagueOwnedSymbols(state.picks, state.trades)];
  const total = demand.reduce((a, b) => a + b, 0);
  const groups = await m.feasibilityPool(types, owned, state.rules.allowUndraftable !== true, total + 1);
  const budget = state.rules.stakeMode === 'budget_cap' ? Number(state.rules.budgetAmount) || 0 : null;
  return gatePick('L', {
    rules: state.rules,
    slots: m.slots,
    order: state.order,
    picks: state.picks,
    trades: state.trades,
    pickerId,
    symbol: s.symbol,
    price: s.live,
    eligibleCategories: new Set(s.cats),
    isDraftable: s.draftable,
  }, { state: { types, demand, groups, budget }, open: openInstances(types, state.picks, pickerId, state.numRounds), cachedPrice: s.cached, eligibility: new Set(s.cats) }).ok;
}

/** The brute-force oracle: is `sym` a legal pick right now, judged by the
 * REAL validatePick on its live price and true eligibility? */
function legal(state: AutoPickState, slots: Slot[], pickerId: string, s: Stock): boolean {
  if (s.live == null) return false;
  return validatePick({
    rules: state.rules,
    slots,
    order: state.order,
    picks: state.picks,
    trades: state.trades,
    pickerId,
    symbol: s.symbol,
    price: s.live,
    eligibleCategories: new Set(s.cats),
    isDraftable: s.draftable,
  }).legal;
}

/** The acceptance assertion, used by every scenario below. */
function assertNeverIllegal(choice: AutoPickChoice, state: AutoPickState, m: FakeMarket, pickerId: string, label: string) {
  if (choice.kind === 'pick') {
    const s = m.stocks.find((x) => x.symbol === choice.gated.symbol)!;
    assert(s, `${label}: picked a symbol not in the market`);
    assert(legal(state, m.slots, pickerId, s), `${label}: ILLEGAL auto-pick ${s.symbol}`);
    assertEquals(choice.gated.price, s.live, `${label}: not filled at the live price`);
  }
}

// ===========================================================================
// Scenario helpers
// ===========================================================================

// order ['u','x','y'] with 6 picks made => round 3 (odd), index 0 => 'u' is up.
const ORDER = ['u', 'x', 'y'];
function stateWith(r: Partial<LeagueRules>, picks: PickRow[], trades: TradeRow[] = []): AutoPickState {
  return { leagueId: 'L', rules: { ...rules, ...r }, order: ORDER, numRounds: 6, picks, trades };
}
const fillerPicks = (uPicks: PickRow[]): PickRow[] => {
  const others = [pick('x', 'X1', 0), pick('x', 'X2', 0), pick('y', 'Y1', 0), pick('y', 'Y2', 0)];
  const all = [...uPicks, ...others].slice(0, 6);
  while (all.length < 6) all.push(pick('y', `YF${all.length}`, 0));
  return all.map((p, i) => ({ ...p, pick_number: i + 1 }));
};
const stock = (symbol: string, price: number | null, o: Partial<Stock> = {}): Stock => ({
  symbol,
  cached: price,
  live: price,
  draftable: true,
  marketCap: 1000,
  cats: [],
  ...o,
});

// ===========================================================================
// decideAutoPickGate / parseDraftClockRow
// ===========================================================================

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
  assertEquals(decideAutoPickGate(4, clock({ draftStatus: 'completed', clockRunning: false })), { kind: 'already_recorded' });
});

Deno.test('gate: stale / not-in-progress / unclocked', () => {
  assertEquals(decideAutoPickGate(6, clock()), { kind: 'stale_pick_number' });
  assertEquals(decideAutoPickGate(0, clock()), { kind: 'stale_pick_number' });
  assertEquals(decideAutoPickGate(5, clock({ draftStatus: 'not_started' })), { kind: 'draft_not_in_progress' });
  assertEquals(decideAutoPickGate(5, clock({ clockRunning: false, deadlineAt: null })), { kind: 'clock_not_running' });
});

Deno.test('parseDraftClockRow: maps the RPC row; rejects garbage', () => {
  assertEquals(
    parseDraftClockRow({ draft_status: 'in_progress', clock_running: true, pick_seconds: 45, picks_made: 3, turn_started_at: 'a', deadline_at: 'b', server_now: 'c' }),
    { draftStatus: 'in_progress', clockRunning: true, pickSeconds: 45, picksMade: 3, turnStartedAt: 'a', deadlineAt: 'b', serverNow: 'c' },
  );
  assertEquals(parseDraftClockRow(null), null);
  assertEquals(parseDraftClockRow({ picks_made: 1 }), null);
});

// ===========================================================================
// pick-gate: the one authority
// ===========================================================================

Deno.test('gatePick: legal -> GatedPick with the decision; illegal -> refusal, no pick', () => {
  const base = { rules, slots: [], order: ['u'], picks: [], trades: [], pickerId: 'u', eligibleCategories: new Set<string>() };
  const ok = gatePick('L', { ...base, symbol: 'aapl', price: 150, isDraftable: true }, permissive(150));
  assert(ok.ok);
  assertEquals([ok.pick.leagueId, ok.pick.symbol, ok.pick.price, ok.pick.pickNumber], ['L', 'AAPL', 150, 1]);
  assertEquals(gatePick('L', { ...base, symbol: 'JUNK', price: 1, isDraftable: false }, permissive(1)), { ok: false, reason: 'not_draftable' });
});

Deno.test('GatedPick cannot be built by hand (compile-time brand)', () => {
  // @ts-expect-error — an object literal is not a GatedPick; only gatePick makes one.
  const forged: GatedPick = { leagueId: 'L', pickerId: 'u', symbol: 'X', price: 1, quantity: 1, round: 1, pickNumber: 1, slotId: null };
  assert(forged); // runtime irrelevant: `deno test` type-checks, and fails if the line above compiles cleanly
});

// ===========================================================================
// openSlotSpecs
// ===========================================================================

Deno.test('openSlotSpecs: slot-less league = one unbounded spec', () => {
  assertEquals(openSlotSpecs(rules, [], [], [], 'u'), [{ min: null, max: null, categoryId: null }]);
});

Deno.test('openSlotSpecs: only slots with spare capacity, with their category; SKIP occupies nothing', () => {
  const slots = [slot('s1', 0, 10), slot('s2', 10, 50, { categoryId: 'tech' }), slot('s3', 50, null, { categoryId: 'energy' })];
  const picks = [pick('u', 'AAA', 1, { slot_id: 's2' }), pick('u', 'SKIP', 2, { slot_id: 's1' }), pick('v', 'BBB', 3, { slot_id: 's3' })];
  assertEquals(openSlotSpecs(rules, slots, picks, [], 'u'), [
    { min: 0, max: 10, categoryId: null },
    { min: 50, max: null, categoryId: 'energy' },
  ]);
});

Deno.test('openSlotSpecs: budget_cap clamps each top to what is left; exhausted = nothing open', () => {
  const r: LeagueRules = { ...rules, stakeMode: 'budget_cap', budgetAmount: 300 };
  const slots = [slot('s1', 0, 50), slot('s2', 100, null), slot('s3', 250, 500)];
  assertEquals(openSlotSpecs(r, slots, [pick('u', 'AAA', 1, { entry_price: 120, slot_id: 'sX' })], [], 'u'), [
    { min: 0, max: 50, categoryId: null },
    { min: 100, max: 180, categoryId: null },
  ]);
  assertEquals(openSlotSpecs({ ...r, budgetAmount: 100 }, [], [pick('u', 'AAA', 1)], [], 'u'), []);
});

// ===========================================================================
// planQueueCandidates
// ===========================================================================

Deno.test('queue plan: manager order kept; owned / undraftable / off-bracket / over-budget / missing dropped', () => {
  const out = planQueueCandidates({
    rules: { ...rules, stakeMode: 'budget_cap', budgetAmount: 1000 },
    slots: [slot('s1', 10, 500)],
    picks: [pick('x', 'TAKEN', 1)],
    trades: [],
    pickerId: 'u',
    queue: ['TAKEN', 'JUNK', 'PENNY', 'PRICEY', 'GHOST', 'OK1', 'OK2'],
    queueMeta: [c('TAKEN'), c('JUNK', { isDraftable: false }), c('PENNY', { lastPrice: 2 }), c('PRICEY', { lastPrice: 1500 }), c('OK2'), c('OK1')],
    eligibility: new Map(),
  });
  assertEquals(out.map((x) => x.symbol), ['OK1', 'OK2']);
});

Deno.test('queue plan: capped at QUEUE_MAX_ATTEMPTS', () => {
  const syms = Array.from({ length: 12 }, (_, i) => `Q${i}`);
  const out = planQueueCandidates({ rules, slots: [], picks: [], trades: [], pickerId: 'u', queue: syms, queueMeta: syms.map((s) => c(s)), eligibility: new Map() });
  assertEquals(out.length, QUEUE_MAX_ATTEMPTS);
});

// ===========================================================================
// decideNoPick
// ===========================================================================

Deno.test('noPick: NO SKIP for anyone (2026-10-05): stall on legality, retry on an outage', () => {
  assertEquals(decideNoPick(0, 0), { kind: 'stalled' });
  assertEquals(decideNoPick(4, 2), { kind: 'stalled' });
  assertEquals(decideNoPick(4, 0), { kind: 'retry_later' });
});

// ===========================================================================
// chooseAutoPick — targeted scenarios
// ===========================================================================

Deno.test('best available = the largest company that fits (walk by market cap)', async () => {
  const m = new FakeMarket([stock('MID', 100, { marketCap: 500 }), stock('MEGA', 100, { marketCap: 3000 }), stock('BIG', 100, { marketCap: 2000 })]);
  const st = stateWith({}, fillerPicks([]));
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick');
  assertEquals([r.gated.symbol, r.source], ['MEGA', 'auto_best']);
  assertEquals(m.priceCalls, ['MEGA'], 'one live price call when the first fit is legal');
});

Deno.test('ONLY legal stock sits far outside the top-N by market cap, behind same-price decoys: it is found', async () => {
  // 300 larger tech stocks priced INSIDE the open slot's $1-5 bracket, and one
  // tiny energy stock — the open slot is energy-only. A bracket-only (or
  // top-N) search drowns in tech decoys; the category-aware search does not.
  const stocks = Array.from({ length: 300 }, (_, i) => stock(`T${i}`, 2 + (i % 3), { marketCap: 1_000_000 - i, cats: ['tech'] }));
  stocks.push(stock('TINY', 3, { marketCap: 5, cats: ['energy'] }));
  const slots = [slot('s1', null, null, { categoryId: 'tech' }), slot('s2', 1, 5, { categoryId: 'energy' })];
  const m = new FakeMarket(stocks, slots);
  const st = stateWith({}, fillerPicks([pick('u', 'T0', 0, { slot_id: 's1' })])); // tech slot filled
  const rank = [...stocks].sort((a, b) => b.marketCap - a.marketCap).findIndex((s) => s.symbol === 'TINY') + 1;
  assert(rank > 150, `TINY is #${rank} by market cap — beyond any fixed top-150 pool`);
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals(r.gated.symbol, 'TINY');
  assertEquals(r.gated.slotId, 's2');
  assertEquals(m.priceCalls, ['TINY'], 'found on the first live attempt');
  assertNeverIllegal(r, st, m, 'u', 'outside-top-N');
});

Deno.test('queue first, in order; a queued stock that became illegal is skipped, never forced', async () => {
  const stocks = [
    stock('OWNEDNOW', 100), // someone drafted it since it was queued
    stock('MOVED', 100, { live: 900 }), // cached price fits, LIVE price left the bracket
    stock('WANTED', 100, { marketCap: 1 }),
    stock('MEGA', 100, { marketCap: 9999 }),
  ];
  const m = new FakeMarket(stocks, [slot('s1', 10, 500)], ['OWNEDNOW', 'MOVED', 'WANTED']);
  const st = stateWith({}, fillerPicks([]).map((p, i) => i === 3 ? { ...p, symbol: 'OWNEDNOW' } : p));
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick');
  assertEquals([r.gated.symbol, r.source], ['WANTED', 'auto_queue']);
  assertEquals(m.priceCalls, ['MOVED', 'WANTED'], 'owned one never even priced; moved one priced and refused by the gate');
  assertNeverIllegal(r, st, m, 'u', 'queue');
});

Deno.test('budget_cap near exhaustion: nothing affordable that keeps the roster fillable -> stalled, never an illegal pick', async () => {
  // $12 left for FOUR open turns, from a three-stock market. No set of stocks can
  // complete this roster, so this league could never have passed the start check.
  // The reserve refuses CHEAP ($11 + three more instances >= $33) and the turn
  // stalls honestly, rather than taking CHEAP and dead-ending the roster.
  const stocks = [stock('MEGA', 500, { marketCap: 9999 }), stock('CHEAP', 11, { marketCap: 10 }), stock('ALMOST', 12.5, { marketCap: 20 })];
  const m = new FakeMarket(stocks);
  const st = stateWith({ stakeMode: 'budget_cap', budgetAmount: 1000 }, fillerPicks([pick('u', 'A', 0, { entry_price: 494 }), pick('u', 'B', 0, { entry_price: 494 })]));
  const r = await chooseAutoPick(st, m, 7); // $12 left
  assertEquals(r.kind, 'stalled');
  assertNeverIllegal(r, st, m, 'u', 'budget');
});

Deno.test('allow_undraftable=false: never a non-draftable stock, however large', async () => {
  const m = new FakeMarket([stock('GIANT_OTC', 50, { marketCap: 99999, draftable: false }), stock('OK', 50, { marketCap: 1 })]);
  const st = stateWith({ allowUndraftable: false }, fillerPicks([]));
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick');
  assertEquals(r.gated.symbol, 'OK');
  assert(!m.priceCalls.includes('GIANT_OTC'));
});

Deno.test('every slot filled but one: fills exactly that slot\'s bracket and category', async () => {
  const slots = [slot('s1', 0, 1000, { categoryId: 'tech' }), slot('s2', 0, 1000, { categoryId: 'fin' }), slot('s3', 20, 40, { categoryId: 'energy' })];
  const stocks = [stock('CHIP', 30, { marketCap: 900, cats: ['tech'] }), stock('BANK', 30, { marketCap: 800, cats: ['fin'] }), stock('OILBIG', 80, { marketCap: 700, cats: ['energy'] }), stock('OIL', 30, { marketCap: 10, cats: ['energy'] })];
  const m = new FakeMarket(stocks, slots);
  const st = stateWith({}, fillerPicks([pick('u', 'T', 0, { slot_id: 's1' }), pick('u', 'F', 0, { slot_id: 's2' })]));
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick');
  assertEquals([r.gated.symbol, r.gated.slotId], ['OIL', 's3']);
});

Deno.test('roster/budget exhausted: stalled as nothing_legal, with ZERO price calls', async () => {
  const m = new FakeMarket([stock('A', 10)], [slot('s1', 0, 100)]);
  const st = stateWith({}, fillerPicks([pick('u', 'Z', 0, { slot_id: 's1' })]));
  const r = await chooseAutoPick(st, m, 7);
  assertEquals(r, { kind: 'stalled', pickerId: 'u', why: 'nothing_legal', attempts: 0 });
  assertEquals(m.priceCalls, []);
});

Deno.test('stale catalog prices: keeps paging past refusals and finds the legal one', async () => {
  // The 30 largest look in-bracket on cached prices but are $900 live.
  const stale = Array.from({ length: 30 }, (_, i) => stock(`S${i}`, 50, { live: 900, marketCap: 1000 - i }));
  const m = new FakeMarket([...stale.slice(0, 10), stock('REAL', 50, { marketCap: 1 })], [slot('s1', 10, 100)]);
  const st = stateWith({}, fillerPicks([]));
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick');
  assertEquals(r.gated.symbol, 'REAL');
  assertEquals(m.priceCalls.length, 11);
});

Deno.test(`the documented bound: ${BEST_MAX_ATTEMPTS} live refusals -> stalled (attempts_exhausted)`, async () => {
  const stale = Array.from({ length: 30 }, (_, i) => stock(`S${String(i).padStart(2, '0')}`, 50, { live: 900, marketCap: 1000 - i }));
  const m = new FakeMarket([...stale, stock('REAL', 50, { marketCap: 1 })], [slot('s1', 10, 100)]);
  const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
  assertEquals(r.kind === 'stalled' && r.why, 'attempts_exhausted');
  assertEquals(m.priceCalls.length, BEST_MAX_ATTEMPTS);
});

Deno.test('vendor outage: a human\'s turn stays open (retry_later); a bot too — nobody is skipped', async () => {
  const stocks = [stock('A', null, { cached: 50 }), stock('B', null, { cached: 60 })];
  const human = await chooseAutoPick(stateWith({}, fillerPicks([])), new FakeMarket(stocks), 7);
  assertEquals(human.kind, 'retry_later');
  const botState: AutoPickState = { ...stateWith({}, fillerPicks([])), order: ['bot-1', 'x', 'y'] };
  const bot = await chooseAutoPick(botState, new FakeMarket(stocks), 7);
  assertEquals(bot.kind, 'retry_later');
});

Deno.test('bots ignore queues and are tagged bot', async () => {
  const m = new FakeMarket([stock('BIG', 50, { marketCap: 9 }), stock('Q', 50, { marketCap: 1 })], [], ['Q']);
  const st: AutoPickState = { ...stateWith({}, fillerPicks([])), order: ['bot-1', 'x', 'y'] };
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick');
  assertEquals([r.gated.symbol, r.source, r.gated.pickerId], ['BIG', 'bot', 'bot-1']);
});

Deno.test('a pick that landed meanwhile -> conflict, never a pick for the next manager', async () => {
  const r = await chooseAutoPick(stateWith({}, fillerPicks([])), new FakeMarket([stock('A', 10)]), 6);
  assertEquals(r, { kind: 'conflict' });
});

Deno.test('the ranking is pluggable without touching the gate or the queue', async () => {
  const alphabetical: BestAvailableStrategy = { id: 'test_alpha', searchPerSlot: 20, rank: (cs) => cs.map((x) => x.symbol).sort() };
  const m = new FakeMarket([stock('MMM', 50, { marketCap: 99 }), stock('AAA', 50, { marketCap: 1 })]);
  const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7, alphabetical);
  assert(r.kind === 'pick');
  assertEquals(r.gated.symbol, 'AAA');
  assertEquals(MARKET_CAP_STRATEGY.rank([c('LO', { marketCap: 1 }), c('NOPX', { lastPrice: null, marketCap: 99 }), c('HI', { marketCap: 9 })]), ['HI', 'LO', 'NOPX']);
});

// ===========================================================================
// THE PROPERTY SWEEP — Giorgio's acceptance criterion across rule configs
// ===========================================================================

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATS = ['tech', 'energy', 'fin'];

function generate(seed: number, staleness: boolean) {
  const rnd = mulberry32(seed);
  const pickOne = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const nStocks = 20 + Math.floor(rnd() * 60);
  const stocks: Stock[] = Array.from({ length: nStocks }, (_, i) => {
    const cached = rnd() < 0.05 ? null : Math.round((1 + rnd() ** 2 * 600) * 100) / 100;
    let live: number | null = cached;
    if (staleness) {
      if (rnd() < 0.1) live = null; // unpriceable right now
      else if (live != null && rnd() < 0.35) live = Math.round(live * (0.6 + rnd() * 0.8) * 100) / 100;
      else if (live == null && rnd() < 0.5) live = Math.round((1 + rnd() * 300) * 100) / 100;
    } else if (live == null) {
      live = Math.round((1 + rnd() * 300) * 100) / 100;
    }
    const cats = rnd() < 0.2 ? [] : rnd() < 0.15 ? [pickOne(CATS), pickOne(CATS)] : [pickOne(CATS)];
    return {
      symbol: `S${seed}_${i}`,
      cached,
      live,
      draftable: cached != null && rnd() < 0.8, // like prod: unpriced is never draftable
      marketCap: Math.floor(rnd() * 1_000_000),
      cats: [...new Set(cats)],
    };
  });

  const nSlots = Math.floor(rnd() * 5); // 0 = slot-less league
  const slots: Slot[] = Array.from({ length: nSlots }, (_, i) => {
    const lo = rnd() < 0.3 ? null : Math.round(rnd() * 200);
    const hi = rnd() < 0.3 ? null : (lo ?? 0) + Math.round(1 + rnd() * 300);
    return slot(`s${i + 1}`, lo, hi, { slotCount: 1 + Math.floor(rnd() * 2), categoryId: rnd() < 0.5 ? pickOne(CATS) : null });
  });

  const stakeMode = pickOne<LeagueRules['stakeMode']>([null, 'budget_cap', 'fixed_notional', 'price_tiers']);
  const r: Partial<LeagueRules> = {
    stakeMode,
    budgetAmount: stakeMode === 'budget_cap' ? Math.round(200 + rnd() * 1500) : null,
    notionalPerSlot: stakeMode === 'fixed_notional' ? 1000 : null,
    allowUndraftable: rnd() < 0.3,
  };

  // u's own two earlier picks (maybe SKIP), possibly occupying slots; others own random stocks.
  const uPick = (k: number): PickRow => {
    if (rnd() < 0.2) return pick('u', 'SKIP', 0, { entry_price: 0, quantity: 0 });
    const s = pickOne(stocks);
    const sl = slots.length && rnd() < 0.8 ? pickOne(slots).id : null;
    return pick('u', rnd() < 0.5 ? s.symbol : `OLD${k}`, 0, { entry_price: Math.round(rnd() * 500), quantity: 1, slot_id: sl });
  };
  const picks = fillerPicks([uPick(1), uPick(2)]).map((p) =>
    p.user_id !== 'u' && rnd() < 0.6 ? { ...p, symbol: pickOne(stocks).symbol } : p
  );
  const queue = rnd() < 0.5 ? Array.from({ length: Math.floor(rnd() * 8) }, () => pickOne(stocks).symbol) : [];
  const isBot = rnd() < 0.2;
  const state: AutoPickState = { ...stateWith(r, picks), order: isBot ? ['bot-1', 'x', 'y'] : ORDER };
  return { state, market: new FakeMarket(stocks, slots, queue), pickerId: isBot ? 'bot-1' : 'u' };
}

Deno.test('SWEEP (exact catalog prices): every result is legal; a stall happens ONLY when no stock passes the full gate', async () => {
  let picks = 0, stalls = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const { state, market, pickerId } = generate(seed, false);
    const r = await chooseAutoPick(state, market, 7);
    assertNeverIllegal(r, state, market, pickerId, `seed ${seed}`);
    if (r.kind === 'pick') picks++;
    else {
      stalls++;
      assertEquals(r.kind, 'stalled', `seed ${seed}: ${JSON.stringify(r)}`);
      let anyGateLegal = false;
      for (const st of market.stocks) anyGateLegal ||= await gateLegal(state, market, pickerId, st);
      assert(!anyGateLegal, `seed ${seed}: STALLED although a stock passed the full gate`);
    }
  }
  assert(picks > 100 && stalls > 10, `sweep must exercise both outcomes (picks=${picks}, stalls=${stalls})`);
});

Deno.test('SWEEP (stale + unpriceable live prices): never an illegal pick, never more than the bound', async () => {
  let picks = 0;
  for (let seed = 1001; seed <= 1400; seed++) {
    const { state, market, pickerId } = generate(seed, true);
    const r = await chooseAutoPick(state, market, 7);
    assertNeverIllegal(r, state, market, pickerId, `seed ${seed}`);
    assert(market.priceCalls.length <= QUEUE_MAX_ATTEMPTS + BEST_MAX_ATTEMPTS, `seed ${seed}: ${market.priceCalls.length} price calls`);
    assertEquals(new Set(market.priceCalls).size, market.priceCalls.length, `seed ${seed}: priced a symbol twice`);
    if (r.kind === 'pick') picks++;
  }
  assert(picks > 100, `picks=${picks}`);
});

/** A market whose SEARCH lies: it ignores every filter (bracket, category,
 * draftable, budget) and returns everything but the excluded, largest first.
 * The only thing standing between it and an illegal pick is the gate — which
 * is exactly the claim under test: validatePick is the authority, the search
 * only decides what to try. */
class HostileMarket extends FakeMarket {
  override searchCandidates = (_spec: SlotSpec, exclude: string[], _draftableOnly: boolean, limit: number) => {
    const ex = new Set(exclude);
    return Promise.resolve(
      this.stocks.filter((s) => !ex.has(s.symbol)).sort((a, b) => b.marketCap - a.marketCap).slice(0, limit).map(this.row),
    );
  };
}

Deno.test('SWEEP (hostile search that ignores every rule): the gate alone still never lets an illegal pick through', async () => {
  let picks = 0;
  for (let seed = 2001; seed <= 2400; seed++) {
    const g = generate(seed, true);
    const m = new HostileMarket(g.market.stocks, g.market.slots, g.market.queue);
    const r = await chooseAutoPick(g.state, m, 7);
    assertNeverIllegal(r, g.state, m, g.pickerId, `seed ${seed}`);
    if (r.kind === 'pick') picks++;
  }
  assert(picks > 100, `picks=${picks}`);
});
