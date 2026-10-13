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
  LIVE_MAX_ATTEMPTS,
  OUTAGE_ESCALATE_MS,
  outageEscalation,
  PRICE_COOLDOWN_MS,
  type BestAvailableStrategy,
  chooseAutoPick,
  decideAutoPickGate,
  decideManualPickClock,
  decideNoPick,
  MANUAL_PICK_GRACE_MS,
  WALK_MAX_CANDIDATES,
  type DraftClock,
  isNearMiss,
  MARKET_CAP_STRATEGY,
  reserveNearMiss,
  slotCap,
  NEAR_MISS_MARGIN,
  NEAR_MISS_MARGINS,
  openSlotSpecs,
  openSlotWindows,
  QUEUE_PLAN_MAX,
  SCREEN_MAX_REQUESTS,
  WALL_BUDGET_MS,
  BOUNDED_STALL_AFTER,
  FRESH_MS,
  stallCooldownVerdict,
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
import { type LeagueRules, type PickRow, type Slot, type TradeRow, validatePick, leagueOwnedSymbols, currentTurn } from './draft-validation.ts';
import { checkStartFeasibility } from './draft-feasibility.ts';

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
  /** The batched screen (the real port is Alpaca /v2/stocks/snapshots). Each call
   * is one vendor request; `screenDown` simulates the endpoint being unavailable. */
  screenCalls: string[][] = [];
  screenDown = false;
  screenPrices = (symbols: string[], _maxRequests: number) => {
    this.screenCalls.push(symbols);
    const prices = new Map<string, number>();
    if (!this.screenDown) {
      for (const x of symbols) {
        const live = this.stocks.find((s) => s.symbol === x)?.live;
        if (live != null) prices.set(x, live);
      }
    }
    this.onScreen?.();
    return Promise.resolve({ prices, requests: 1, unavailable: this.screenDown || undefined });
  };
  /** Test hooks: run on every screen / fill call (e.g. to move a fake clock). */
  onScreen?: () => void;
  onFill?: () => void;
  livePrice = (symbol: string) => {
    this.priceCalls.push(symbol);
    this.onFill?.();
    const s = this.stocks.find((x) => x.symbol === symbol);
    // A trade price: the write-back accepts only trade/bar sources (review M2).
    return Promise.resolve({ price: s?.live ?? null, source: 'trade.p' });
  };
  /** The per-symbol negative cache (the real port is auto_pick_price_failures). */
  failures = new Map<string, number>();
  coolingSymbols = (symbols: string[]) =>
    Promise.resolve(
      new Set(
        symbols
          .map((x) => x.toUpperCase())
          .filter((x) => {
            const t = this.failures.get(x);
            return t != null && Date.now() - t < PRICE_COOLDOWN_MS;
          }),
      ),
    );
  recordPriceFailure = (symbol: string): Promise<void> => {
    this.failures.set(symbol.toUpperCase(), Date.now());
    return Promise.resolve();
  };
  clearPriceFailure = (symbol: string): Promise<void> => {
    this.failures.delete(symbol.toUpperCase());
    return Promise.resolve();
  };
  /** The catalog cache takes the fresh live prices in one batch (the real port is
   * public.record_live_prices: last_price + last_price_at). */
  writes: number[] = []; // batch sizes, one entry per write call
  priceAt = new Map<string, number>();
  recordLivePrices = (prices: Map<string, number>): Promise<void> => {
    this.writes.push(prices.size);
    for (const [symbol, price] of prices) {
      const s = this.stocks.find((x) => x.symbol === symbol);
      if (s) {
        s.cached = price;
        this.priceAt.set(symbol, Date.now());
      }
    }
    return Promise.resolve();
  };
  priceAges = (symbols: string[]): Promise<Map<string, number>> =>
    Promise.resolve(new Map(symbols.flatMap((x) => (this.priceAt.has(x) ? [[x, this.priceAt.get(x)!] as [string, number]] : []))));
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

// ===========================================================================
// decideManualPickClock — a manager's OWN pick after the clock (2026-10-13)
// ===========================================================================
// The clock() fixture: pick 5 is on the clock, deadline 12:01:00 (server time).

const at = (serverNow: string) => clock({ serverNow });

Deno.test('manual clock: the grace is 2 s (latency only, not thinking time)', () => {
  assertEquals(MANUAL_PICK_GRACE_MS, 2_000);
});

Deno.test('manual clock: before the deadline -> go', () => {
  assertEquals(decideManualPickClock(5, at('2026-10-10T12:00:30Z')), { kind: 'go' });
  assertEquals(decideManualPickClock(5, at('2026-10-10T12:00:59.999Z')), { kind: 'go' });
});

Deno.test('manual clock: at the deadline and within the 2 s grace -> go', () => {
  assertEquals(decideManualPickClock(5, at('2026-10-10T12:01:00Z')), { kind: 'go' });
  assertEquals(decideManualPickClock(5, at('2026-10-10T12:01:01Z')), { kind: 'go' });
  assertEquals(decideManualPickClock(5, at('2026-10-10T12:01:01.999Z')), { kind: 'go' });
});

Deno.test('manual clock: from deadline + grace on -> clock_expired, with both times (server clock)', () => {
  assertEquals(decideManualPickClock(5, at('2026-10-10T12:01:02Z')), {
    kind: 'clock_expired',
    deadlineAt: '2026-10-10T12:01:00Z',
    serverNow: '2026-10-10T12:01:02Z',
  });
  assertEquals(decideManualPickClock(5, at('2026-10-10T12:30:00Z')).kind, 'clock_expired');
});

Deno.test('manual clock: a stalled turn keeps its past deadline -> still expired (the auto-pick owns it)', () => {
  // get_draft_clock has no pause: a stall writes no drafts row, so the anchor
  // (and deadline) stays where it was and the turn reads as long overdue.
  assertEquals(decideManualPickClock(5, at('2026-10-10T13:00:00Z')).kind, 'clock_expired');
});

Deno.test('manual clock: no clock running (unclocked draft, or no longer in_progress) -> go; no deadline exists', () => {
  assertEquals(decideManualPickClock(5, clock({ clockRunning: false, deadlineAt: null, turnStartedAt: null, serverNow: '2026-10-10T13:00:00Z' })), { kind: 'go' });
  assertEquals(decideManualPickClock(5, clock({ draftStatus: 'completed', clockRunning: false, deadlineAt: null })), { kind: 'go' });
});

Deno.test('manual clock: the clock read failing or malformed -> clock_unreadable (fail CLOSED)', () => {
  assertEquals(decideManualPickClock(5, null), { kind: 'clock_unreadable' });
  assertEquals(decideManualPickClock(5, clock({ deadlineAt: null })), { kind: 'clock_unreadable' });
  assertEquals(decideManualPickClock(5, clock({ deadlineAt: 'not a time' })), { kind: 'clock_unreadable' });
  assertEquals(decideManualPickClock(5, clock({ serverNow: 'not a time' })), { kind: 'clock_unreadable' });
});

Deno.test('manual clock: a clock for a different pick is not this pick\'s to judge -> turn_moved', () => {
  // A pick (often the auto-pick) landed between the caller's read and the clock read.
  assertEquals(decideManualPickClock(4, clock()), { kind: 'turn_moved' });
  // ...even when that later turn's own clock is long expired: never "your clock ran out".
  assertEquals(decideManualPickClock(4, at('2026-10-10T13:00:00Z')), { kind: 'turn_moved' });
  assertEquals(decideManualPickClock(6, clock()), { kind: 'turn_moved' });
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
  // Brackets are widened by the 10% search margin (the gate stays exact).
  assertEquals(openSlotSpecs(rules, slots, picks, [], 'u'), [
    { min: 0, max: 11, categoryId: null },
    { min: 45, max: null, categoryId: 'energy' },
  ]);
});

Deno.test('openSlotSpecs: budget_cap clamps each top to what is left; exhausted = nothing open', () => {
  const r: LeagueRules = { ...rules, stakeMode: 'budget_cap', budgetAmount: 300 };
  const slots = [slot('s1', 0, 50), slot('s2', 100, null), slot('s3', 250, 500)];
  assertEquals(openSlotSpecs(r, slots, [pick('u', 'AAA', 1, { entry_price: 120, slot_id: 'sX' })], [], 'u'), [
    { min: 0, max: 55, categoryId: null },
    { min: 90, max: 180, categoryId: null },
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

Deno.test('noPick: NO SKIP for anyone (2026-10-05): stall only with no outage, retry on an outage', () => {
  assertEquals(decideNoPick(0), { kind: 'stalled' });
  assertEquals(decideNoPick(2), { kind: 'retry_later' });
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

Deno.test('budget_cap near exhaustion: an already-short roster still drafts what it can afford (never stuck), then stalls only on the hard budget', async () => {
  // $12 left for FOUR open turns, from a three-stock market. No set of stocks can
  // complete this roster: it is short before the pick. Never-worsen (2026-10-13)
  // takes CHEAP ($11, within the hard budget, and the shortfall does not grow)
  // rather than freezing; ALMOST ($12.50) is over the hard budget and never legal.
  const stocks = [stock('MEGA', 500, { marketCap: 9999 }), stock('CHEAP', 11, { marketCap: 10 }), stock('ALMOST', 12.5, { marketCap: 20 })];
  const m = new FakeMarket(stocks);
  const st = stateWith({ stakeMode: 'budget_cap', budgetAmount: 1000 }, fillerPicks([pick('u', 'A', 0, { entry_price: 494 }), pick('u', 'B', 0, { entry_price: 494 })]));
  const r = await chooseAutoPick(st, m, 7); // $12 left
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals([r.gated.symbol, r.gated.price], ['CHEAP', 11]);
  assertNeverIllegal(r, st, m, 'u', 'budget');
  // $1 left: nothing in the market costs <= $1, so the hard budget leaves nothing legal.
  const broke = stateWith({ stakeMode: 'budget_cap', budgetAmount: 1000 }, fillerPicks([pick('u', 'A', 0, { entry_price: 494 }), pick('u', 'B', 0, { entry_price: 505 })]));
  const r2 = await chooseAutoPick(broke, new FakeMarket(stocks), 7);
  assertEquals(r2.kind, 'stalled');
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

// LIVENESS repro (Orchestrator, 2026-10-05): the 30 largest look legal on their
// cached prices and are refused live; the legal stock is 31st by market cap.
// The old top-15 window stalled here ("attempts_exhausted") with a legal pick on
// the book. The walk must take it. Since 2026-10-13 one call may make at most
// LIVE_MAX_ATTEMPTS (20) fill calls, so it takes TWO ticks: the first prices 20
// and writes their live prices back (fresh, so judged free next time), the
// second prices the other 10 and REAL. Nothing is priced twice.
Deno.test('LIVENESS: the top 30 are refused live but a deeper legal stock exists -> auto-pick takes it (2 ticks, nothing re-priced)', async () => {
  const stale = Array.from({ length: 30 }, (_, i) => stock(`S${String(i).padStart(2, '0')}`, 50, { live: 900, marketCap: 1000 - i }));
  const m = new FakeMarket([...stale, stock('REAL', 50, { marketCap: 1 })], [slot('s1', 10, 100)]);
  const st = stateWith({}, fillerPicks([]));
  assertEquals((await chooseAutoPick(st, m, 7)).kind, 'retry_later');
  assertEquals(m.priceCalls.length, LIVE_MAX_ATTEMPTS);
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals(r.gated.symbol, 'REAL');
  assertEquals(new Set(m.priceCalls).size, m.priceCalls.length, 'a symbol was fill-priced twice');
  assertNeverIllegal(r, st, m, 'u', 'liveness');
});

// Mutation: isFresh always false -> the refused 20 are re-priced every tick and
// the walk never reaches REAL.
Deno.test('LIVENESS: more refusals than one call may price -> retry_later, and each NEXT tick moves on (fresh write-backs), until it picks', async () => {
  const stale = Array.from({ length: 70 }, (_, i) => stock(`S${String(i).padStart(2, '0')}`, 50, { live: 900, marketCap: 1000 - i }));
  const m = new FakeMarket([...stale, stock('REAL', 50, { marketCap: 1 })], [slot('s1', 10, 100)]);
  const st = stateWith({}, fillerPicks([]));
  let r: AutoPickChoice = { kind: 'conflict' };
  const perTick: number[] = [];
  for (let tick = 0; tick < 5 && r.kind !== 'pick'; tick++) {
    const before = m.priceCalls.length;
    r = await chooseAutoPick(st, m, 7);
    perTick.push(m.priceCalls.length - before);
  }
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals(r.gated.symbol, 'REAL');
  assertEquals(perTick, [20, 20, 20, 11]);
  assertEquals(new Set(m.priceCalls).size, m.priceCalls.length, 'a symbol was fill-priced twice');
});

// LIVENESS (review H2): the cache says $49, the bracket floor is $50, the stock
// trades at $55. The stock is legal live. The search is widened by the 10% margin
// and a near-boundary cached price is priced live, so it is found. Mutation-checked:
// with bandOutside forced false, the free check refuses it and the turn stalls.
Deno.test('LIVENESS: a cached price just below the bracket (stale cache) is priced live and taken', async () => {
  const m = new FakeMarket([stock('NEAR', 49, { live: 55, marketCap: 5 })], [slot('s1', 50, 100)]);
  const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals(r.gated.symbol, 'NEAR');
  assertEquals(r.gated.price, 55);
});

Deno.test('LIVENESS: a stock with NO cached price (allow_undraftable) is still priced live, not skipped', async () => {
  const m = new FakeMarket([stock('NOCACHE', null, { live: 50, marketCap: 9 })], [slot('s1', 10, 100)]);
  const st = stateWith({ allowUndraftable: true }, fillerPicks([]));
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals(r.gated.symbol, 'NOCACHE');
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

function generate(seed: number, staleness: boolean, bounded = false) {
  const rnd = mulberry32(seed);
  const pickOne = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const nStocks = 20 + Math.floor(rnd() * 60);
  const stocks: Stock[] = Array.from({ length: nStocks }, (_, i) => {
    const cached = rnd() < 0.05 ? null : Math.round((1 + rnd() ** 2 * 600) * 100) / 100;
    let live: number | null = cached;
    if (bounded) {
      // Every cached price is stale by at most 30% (live = cached x [0.7, 1.3]) and
      // every stock prices: well inside NEAR_MISS_MARGIN, so no legal stock may hide.
      live = cached == null ? Math.round((1 + rnd() * 300) * 100) / 100 : Math.round(cached * (0.7 + rnd() * 0.6) * 100) / 100;
    } else if (staleness) {
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
    assert(market.priceCalls.length <= QUEUE_MAX_ATTEMPTS + LIVE_MAX_ATTEMPTS, `seed ${seed}: ${market.priceCalls.length} price calls`);
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

// ===========================================================================
// PROPERTY (Orchestrator, 2026-10-05): 16 managers, slot and budget modes,
// adversarial market caps. Every league whose START check passes is drafted
// turn by turn through the REAL chooseAutoPick: every turn must be a 'pick'
// (never 'stalled', never a skip). Market caps alternate between "expensive
// first" (budget-hostile) and "cheap first".
// ===========================================================================
function rngP(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

Deno.test('PROPERTY: 16 managers, slot + budget, adversarial caps: a start-feasible league never stalls or skips', async () => {
  const cats = ['c0', 'c1', 'c2'];
  let completed = 0;
  let turns = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const r = rngP(seed * 7919);
    const managers = 16;
    const numRounds = 2 + Math.floor(r() * 3); // 2..4 -> 32..64 picks per league
    const budgetLeague = seed % 2 === 0;
    const slots: Slot[] = [];
    let left = numRounds;
    let idx = 0;
    while (left > 0) {
      const c = Math.min(left, 1 + Math.floor(r() * 2));
      const lo = Math.floor(r() * 150);
      const hi = r() < 0.4 ? null : lo + 20 + Math.floor(r() * 150);
      const cat = r() < 0.4 ? cats[Math.floor(r() * cats.length)] : null;
      slots.push(slot(`s${idx}`, lo, hi, { slotCount: c, categoryId: cat }));
      left -= c;
      idx++;
    }
    const poolSize = 150 + Math.floor(r() * 250);
    const stocks: Stock[] = [];
    for (let i = 0; i < poolSize; i++) {
      const price = Math.round(r() * 30000) / 100 + 0.01;
      const cap = seed % 4 < 2 ? price * 10 : 100000 - price * 10; // expensive-first vs cheap-first
      stocks.push(stock(`P${seed}_${i}`, price, { marketCap: cap, cats: cats.filter(() => r() < 0.35) }));
    }
    const budget = budgetLeague ? 400 + Math.floor(r() * 1600) : null;
    const rules: LeagueRules = {
      stakeMode: budget != null ? 'budget_cap' : 'price_tiers',
      budgetAmount: budget,
      notionalPerSlot: null,
      numRounds,
      allowUndraftable: false,
    };
    const groups0 = buildPoolGroups(slots, stocks.map((s) => ({ symbol: s.symbol, cachedPrice: s.cached, eligibility: new Set(s.cats), isDraftable: s.draftable })), {
      exclude: [],
      draftableOnly: true,
      depth: managers * numRounds + 2,
    });
    if (!checkStartFeasibility({ types: slots, managers, numRounds, budget, groups: groups0 }).ok) continue;

    const order = Array.from({ length: managers }, (_, i) => `m${i}`);
    const picks: PickRow[] = [];
    for (let t = 0; t < managers * numRounds; t++) {
      assert(currentTurn(picks.length, order, numRounds) !== null);
      const state: AutoPickState = { leagueId: 'L', rules, order, numRounds, picks, trades: [] };
      const market = new FakeMarket(stocks, slots, []);
      const choice = await chooseAutoPick(state, market, picks.length + 1);
      assertEquals(choice.kind, 'pick', `seed ${seed} turn ${t} (budget=${budget}): ${JSON.stringify(choice)}`);
      if (choice.kind !== 'pick') break;
      const g = choice.gated;
      picks.push({ user_id: g.pickerId, symbol: g.symbol, entry_price: g.price, quantity: g.quantity, pick_number: picks.length + 1, slot_id: g.slotId });
      turns++;
    }
    if (picks.length === managers * numRounds) completed++;
  }
  assert(completed >= 10, `property must exercise real drafts (completed=${completed} of 30)`);
  assert(turns > 500, `turns=${turns}`);
});

// ===========================================================================
// OUTAGE (Orchestrator, 2026-10-05): a dead symbol is negative-cached for the
// cooldown, so the walk moves past it to a priced legal candidate; a turn with
// only outages is retry_later with outage=true (escalated by draft-write.ts).
// ===========================================================================

Deno.test('OUTAGE: one dead top symbol + a legal second -> picks the second; the dead one is not re-priced', async () => {
  const m = new FakeMarket([stock('DEAD', 50, { live: null, marketCap: 100 }), stock('OK', 50, { marketCap: 1 })], [slot('s1', 10, 100)]);
  const st = stateWith({}, fillerPicks([]));
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals(r.gated.symbol, 'OK');
  const again = await chooseAutoPick(st, m, 7);
  assert(again.kind === 'pick', JSON.stringify(again));
  assertEquals(m.priceCalls.filter((x) => x === 'DEAD').length, 1); // cooling: no second live call
});

Deno.test('OUTAGE: every candidate dead -> retry_later with outage=true, on every call (never stalled)', async () => {
  const m = new FakeMarket([stock('A1', 50, { live: null }), stock('A2', 50, { live: null })], [slot('s1', 10, 100)]);
  const st = stateWith({}, fillerPicks([]));
  for (let i = 0; i < 3; i++) {
    const r = await chooseAutoPick(st, m, 7);
    assertEquals(r.kind === 'retry_later' && r.outage, true, `call ${i}: ${JSON.stringify(r)}`);
  }
  assertEquals(m.priceCalls.length, 2); // the two dead symbols were priced once, then cooled
});

Deno.test('OUTAGE: recovery — after the cooldown a dead symbol that prices again is taken and its failure clears', async () => {
  const m = new FakeMarket([stock('BACK', 50, { live: null })], [slot('s1', 10, 100)]);
  const st = stateWith({}, fillerPicks([]));
  assertEquals((await chooseAutoPick(st, m, 7)).kind, 'retry_later');
  m.failures.set('BACK', 0); // the cooldown has long expired
  m.stocks[0].live = 50;
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals(r.gated.symbol, 'BACK');
  assertEquals(m.failures.has('BACK'), false);
});

Deno.test('OUTAGE escalation: waits under the threshold, escalates once, then done', () => {
  const t0 = 1_000_000;
  assertEquals(outageEscalation(t0, t0 + OUTAGE_ESCALATE_MS - 1, false), 'wait');
  assertEquals(outageEscalation(t0, t0 + OUTAGE_ESCALATE_MS, false), 'escalate');
  assertEquals(outageEscalation(t0, t0 + OUTAGE_ESCALATE_MS * 3, true), 'done');
});

// ===========================================================================
// NEVER STALLS ON A STALE CACHE (Giorgio, 2026-10-13: after a clock expires only
// the auto-pick fills the turn; "the auto pick has to work"). Each test below is
// one way the auto-pick used to report 'nothing_legal' (or retry forever) while a
// stock was legal at its LIVE price. Mutation notes name the line each guards.
// ===========================================================================

// Cause 1: the cached price is MORE than 10% outside the bracket, so the first
// search (brackets +-10%) never offers it. Mutation: drop the near-miss pass
// (`passes = [specs]`) -> stalled.
Deno.test('STALE CACHE: cache 20% below the floor, live inside -> picked by the near-miss search', async () => {
  const m = new FakeMarket([stock('LOW', 40, { live: 60, marketCap: 5 })], [slot('s1', 50, 100)]);
  const st = stateWith({}, fillerPicks([]));
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals([r.gated.symbol, r.gated.price, r.source], ['LOW', 60, 'auto_best']);
  assertEquals(m.priceCalls, ['LOW'], 'one fill call, after the screen admitted it');
  assertNeverIllegal(r, st, m, 'u', 'stale-low');
});

Deno.test('STALE CACHE: cache 30% above the ceiling, live inside -> picked', async () => {
  const m = new FakeMarket([stock('HIGH', 130, { live: 90, marketCap: 5 })], [slot('s1', 50, 100)]);
  const st = stateWith({}, fillerPicks([]));
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals([r.gated.symbol, r.gated.price], ['HIGH', 90]);
  assertNeverIllegal(r, st, m, 'u', 'stale-high');
});

// Cause 2: the search clamps the top to the budget / reserve EXACTLY on the cached
// price, so a stock cached above what is left, but live within it, was never
// offered. Mutation: NEAR_MISS_MARGINS.cap = 0 -> stalled.
Deno.test('STALE CACHE: cached price above the budget left, live within it -> picked', async () => {
  // u: two earlier picks ($425 each) fill s2 x2; only s1 [$100, $200] is open, $150 left.
  const slots = [slot('s1', 100, 200), slot('s2', 1, 1000, { slotCount: 2, slotIndex: 2 })];
  const uPicks = [pick('u', 'A', 0, { entry_price: 425, slot_id: 's2' }), pick('u', 'B', 0, { entry_price: 425, slot_id: 's2' })];
  const m = new FakeMarket([stock('DIP', 160, { live: 140, marketCap: 5 })], slots);
  const st = stateWith({ stakeMode: 'budget_cap', budgetAmount: 1000, numRounds: 3 }, fillerPicks(uPicks));
  const r = await chooseAutoPick({ ...st, numRounds: 3 }, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals([r.gated.symbol, r.gated.price, r.gated.slotId], ['DIP', 140, 's1']);
});

// Cause 3 (liveness): a near-miss inside the 10% band used to be priced by a FILL
// call every time, and the write-back kept it in the band, so 60+ of them ranked
// above the legal stock meant retry_later on EVERY tick, forever. Now one screen
// request settles the whole page. Mutation: plan near-misses as 'live' instead of
// 'screen' -> retry_later.
Deno.test('LIVENESS: 70 near-misses in the 10% band outrank the legal stock -> picked on the FIRST call, one screen request', async () => {
  const near = Array.from({ length: 70 }, (_, i) => stock(`N${String(i).padStart(2, '0')}`, 48, { live: 47, marketCap: 1000 - i }));
  const m = new FakeMarket([...near, stock('REAL', 60, { marketCap: 1 })], [slot('s1', 50, 100)]);
  const st = stateWith({}, fillerPicks([]));
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals(r.gated.symbol, 'REAL');
  assertEquals(m.priceCalls, ['REAL'], 'no fill call is spent on a screened-out near-miss');
  assertEquals(m.screenCalls.length, 1);
  assertEquals(m.screenCalls[0].length, 70);
});

// H2 (review, 2026-10-13): a budget_reserve refusal is screened ONLY when a live
// price could close it. A lower price changes only the pick's cost, never the
// cached-pool reserve, so the refusal is reachable only if its excess is at most
// NEAR_MISS_MARGIN of the cost. A HostileMarket (returns everything) puts A45 in
// front of the walk: refused by the reserve with a $25 excess on a $45 cost
// (> 50%), so it is skipped for free. Mutation: reserveNearMiss returns true for
// every budget_reserve refusal (the old blanket shortcut) -> A45 is screened.
Deno.test('H2: a budget_reserve refusal no live price could close is skipped free, never screened', async () => {
  // u: $100 left, slots A [$1-$50] and B [$100-$140] open, C filled; y has one
  // open A. Reserve before: A at its 2nd-cheapest ($21) + B ($115) = $136, so u is
  // already $36 short. A45 would leave $45 + $115 = $60 short: worse by $24, more
  // than 50% of its $45 cost, and its cached price is no near-miss on any window.
  // A21 does not worsen the shortfall: it is the legal pick.
  const slots = [slot('A', 1, 50, { slotIndex: 1 }), slot('B', 100, 140, { slotIndex: 2 }), slot('C', 0, 1000, { slotIndex: 3 })];
  const stocks = [stock('A45', 45, { marketCap: 100 }), stock('B115', 115, { marketCap: 90 }), stock('A21', 21, { marketCap: 15 }), stock('A20', 20, { marketCap: 10 })];
  const m = new HostileMarket(stocks, slots);
  const picks = [
    pick('u', 'UC', 1, { entry_price: 900, slot_id: 'C' }),
    // x full (A, B, C); y holds B and C, so y's one open instance is A.
    ...([['x', 'A'], ['x', 'B'], ['x', 'C'], ['y', 'B'], ['y', 'C']] as const).map(([u, sl], i) => pick(u, `F${i}`, i + 2, { entry_price: 1, slot_id: sl })),
  ];
  const st: AutoPickState = { leagueId: 'L', rules: { ...rules, stakeMode: 'budget_cap', budgetAmount: 1000, numRounds: 3 }, order: ORDER, numRounds: 3, picks, trades: [] };
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertNeverIllegal(r, st, m, 'u', 'h2');
  assertEquals([r.gated.pickerId, r.gated.symbol], ['u', 'A21']);
  assertEquals(m.screenCalls.flat().includes('A45'), false, `A45 was screened: ${JSON.stringify(m.screenCalls)}`);
  assertEquals(m.priceCalls.includes('A45'), false);
});

// ...and the other side of H2: a reserve refusal a live price CAN close is
// screened, even when the cached price is past every window (only a search wider
// than the windows offers such a stock; HostileMarket models that). D95 is cached
// at $95 against a $60 slot cap (the $40 reserve), $35 too dear: 37% of its cost,
// inside the margin. Live it is $55, and legal. Mutation: drop
// `reserveNearMiss(g, c.lastPrice) ||` from planOf -> C40A is taken instead.
Deno.test('H2: a budget_reserve refusal a live price can close is screened and taken', async () => {
  const stocks = [stock('D95', 95, { live: 55, marketCap: 100 }), stock('C40A', 40, { marketCap: 10 }), stock('C40B', 40, { marketCap: 9 })];
  const m = new HostileMarket(stocks);
  // Two managers; x is full, u has two turns and $100 left.
  const picks = [pick('u', 'U1', 1, { entry_price: 900 }), pick('x', 'X1', 2), pick('x', 'X2', 3), pick('x', 'X3', 4)];
  const st: AutoPickState = { leagueId: 'L', rules: { ...rules, stakeMode: 'budget_cap', budgetAmount: 1000, numRounds: 3 }, order: ['u', 'x'], numRounds: 3, picks, trades: [] };
  const r = await chooseAutoPick(st, m, 5);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals([r.gated.symbol, r.gated.price], ['D95', 55]);
  assertNeverIllegal(r, st, m, 'u', 'h2-reachable');
});

Deno.test('reserveNearMiss: reachable only when the excess is at most NEAR_MISS_MARGIN of the cost', () => {
  const refused = (budgetExcess?: number) => ({ ok: false, reason: 'budget_reserve', budgetExcess });
  assertEquals(reserveNearMiss(refused(20), 40), true); // exactly 50%
  assertEquals(reserveNearMiss(refused(20.01), 40), false);
  assertEquals(reserveNearMiss(refused(Infinity), 40), false, 'an infinite reserve is not a price problem');
  assertEquals(reserveNearMiss(refused(undefined), 40), false);
  assertEquals(reserveNearMiss({ ok: false, reason: 'would_strand_slot', budgetExcess: 1 }, 40), false);
  assertEquals(reserveNearMiss({ ok: true }, 40), false);
});

Deno.test('slotCap: loosened by the existing shortfall; Infinity-safe, never NaN', () => {
  assertEquals(slotCap(1000, 900, 60, 0), 40); // healthy: exactly what is left after the reserve
  assertEquals(slotCap(1000, 900, 60, 15), 55); // never-worsen admits the existing shortfall
  assertEquals(slotCap(1000, 900, Infinity, 15), -1); // finite before, infinite after: refuse
  assertEquals(slotCap(1000, 900, Infinity, Infinity), Infinity); // already infinite: the reserve no longer binds
  assertEquals(slotCap(1000, 900, 60, Infinity), Infinity);
});

// R1 (Giorgio, 2026-10-13): "safety cushion? when did i ever say there should be
// a safety cushion?" — no cushion, never stuck. The league that froze under the
// 1.1 reserve inflate now picks. Mutation: re-adding the 1.1 in reserveFor -> stalled.
Deno.test('R1: the frozen league ($57.20 left, 2 turns, every stock $28.60) picks: no cushion', async () => {
  const stocks = Array.from({ length: 12 }, (_, i) => stock(`P${i}`, 28.6, { marketCap: 100 - i }));
  const picks = [pick('u', 'A', 1, { entry_price: 942.8 }), ...['x', 'x', 'y', 'y', 'y'].map((u, i) => pick(u, `F${i}`, i + 2, { entry_price: 1 }))];
  const st: AutoPickState = { leagueId: 'L', rules: { ...rules, stakeMode: 'budget_cap', budgetAmount: 1000, numRounds: 3 }, order: ORDER, numRounds: 3, picks, trades: [] };
  const m = new FakeMarket(stocks);
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals([r.gated.symbol, r.gated.price], ['P0', 28.6]);
  assertNeverIllegal(r, st, m, 'u', 'r1');
});

// Never stuck: the same league after prices drifted to $30 is $2.80 short before
// the pick. Never-worsen takes a $30 stock (the shortfall stays $2.80), and the
// search cap is loosened by the shortfall, or the window would close. Mutations:
// pre-shortfall forced to 0 in evaluateFeasiblePick -> stalled; slotCap without
// the + shortfallBefore -> stalled.
Deno.test('R1: prices drifted, the roster is already short -> never stuck, a pick that does not worsen it is taken', async () => {
  const stocks = Array.from({ length: 12 }, (_, i) => stock(`P${i}`, 30, { marketCap: 100 - i }));
  const picks = [pick('u', 'A', 1, { entry_price: 942.8 }), ...['x', 'x', 'y', 'y', 'y'].map((u, i) => pick(u, `F${i}`, i + 2, { entry_price: 1 }))];
  const st: AutoPickState = { leagueId: 'L', rules: { ...rules, stakeMode: 'budget_cap', budgetAmount: 1000, numRounds: 3 }, order: ORDER, numRounds: 3, picks, trades: [] };
  const m = new FakeMarket(stocks);
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals([r.gated.symbol, r.gated.price], ['P0', 30]);
  assertNeverIllegal(r, st, m, 'u', 'r1-drift');
});

// Queue fidelity: "the queue first, the first still-legal symbol". A queued stock
// whose cached price is stale used to be dropped from the queue plan, so a bigger
// best-available stock was taken instead. Mutation: plan the queue with margin 0
// -> MEGA (auto_best).
Deno.test('QUEUE: a queued stock with a stale cache (live legal) is taken from the queue, before best available', async () => {
  const m = new FakeMarket(
    [stock('MEGA', 70, { marketCap: 9999 }), stock('WANTED', 40, { live: 55, marketCap: 1 })],
    [slot('s1', 50, 100)],
    ['WANTED'],
  );
  const st = stateWith({}, fillerPicks([]));
  const r = await chooseAutoPick(st, m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals([r.gated.symbol, r.source, r.gated.price], ['WANTED', 'auto_queue', 55]);
  assertNeverIllegal(r, st, m, 'u', 'queue-stale');
});

Deno.test('QUEUE: a queued near-miss that is still outside live is screened out without a fill call', async () => {
  const m = new FakeMarket(
    [stock('MEGA', 70, { marketCap: 9999 }), stock('GONE', 40, { live: 41, marketCap: 1 })],
    [slot('s1', 50, 100)],
    ['GONE'],
  );
  const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals([r.gated.symbol, r.source], ['MEGA', 'auto_best']);
  assertEquals(m.priceCalls, ['MEGA']);
});

// A truly empty legal set still stalls — and cheaply.
Deno.test('nothing legal at ANY live price -> stalled; near-misses settled by the screen, zero fill calls', async () => {
  const m = new FakeMarket([stock('OUT1', 40, { live: 42, marketCap: 9 }), stock('OUT2', 130, { live: 120 })], [slot('s1', 50, 100)]);
  const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
  assertEquals(r, { kind: 'stalled', pickerId: 'u', why: 'nothing_legal', attempts: 0 });
  assertEquals(m.priceCalls, []);
  assert(m.screenCalls.length >= 1 && m.screenCalls.length <= SCREEN_MAX_REQUESTS);
});

// Vendor outages ("Paused") keep retrying, and recover on their own.
Deno.test('OUTAGE: screen AND fill down -> retry_later (outage), never stalled; recovers once Alpaca answers', async () => {
  const m = new FakeMarket([stock('LOW', 40, { live: null, marketCap: 5 })], [slot('s1', 50, 100)]);
  m.screenDown = true;
  const st = stateWith({}, fillerPicks([]));
  const r1 = await chooseAutoPick(st, m, 7);
  assertEquals(r1.kind === 'retry_later' && r1.outage, true, JSON.stringify(r1));
  // Alpaca answers again; the 5-minute cooldown on LOW has run out.
  m.screenDown = false;
  m.stocks[0].live = 60;
  m.failures.set('LOW', 0);
  const r2 = await chooseAutoPick(st, m, 7);
  assert(r2.kind === 'pick', JSON.stringify(r2));
  assertEquals([r2.gated.symbol, r2.gated.price], ['LOW', 60]);
});

Deno.test('OUTAGE: the screen alone is down -> every candidate falls back to its fill call (the screen only saves calls)', async () => {
  const m = new FakeMarket([stock('LOW', 40, { live: 60, marketCap: 5 })], [slot('s1', 50, 100)]);
  m.screenDown = true;
  const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals(r.gated.symbol, 'LOW');
});

// Bounds: screen requests and fill calls stay capped however many near-misses exist.
Deno.test('BOUND: 2000 near-misses -> at most SCREEN_MAX_REQUESTS screens and LIVE_MAX_ATTEMPTS fills; retry_later, never stalled', async () => {
  const near = Array.from({ length: 2000 }, (_, i) => stock(`N${String(i).padStart(4, '0')}`, 48, { live: 47, marketCap: 100000 - i }));
  const m = new FakeMarket(near, [slot('s1', 50, 100)]);
  const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
  assertEquals(r.kind, 'retry_later', JSON.stringify(r));
  assert(m.screenCalls.length <= SCREEN_MAX_REQUESTS, `screens=${m.screenCalls.length}`);
  assert(m.priceCalls.length <= LIVE_MAX_ATTEMPTS, `fills=${m.priceCalls.length}`);
  assert(m.screenCalls.every((x) => x.length <= 100));
});

Deno.test('BOUND: 500 near-misses then the legal stock -> picked with 5 screen requests and ONE fill call', async () => {
  const near = Array.from({ length: 500 }, (_, i) => stock(`N${String(i).padStart(4, '0')}`, 48, { live: 47, marketCap: 100000 - i }));
  const m = new FakeMarket([...near, stock('REAL', 60, { marketCap: 1 })], [slot('s1', 50, 100)]);
  const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals(r.gated.symbol, 'REAL');
  assertEquals(m.screenCalls.length, 5);
  assertEquals(m.priceCalls, ['REAL']);
});

// The headline property: with every cached price stale by up to 30% (inside the
// near-miss margin) and every stock priceable, a stall means NO stock passes the
// full gate at its live price. Mutation: either pass, either screen rule, or the
// cap margin removed -> a seed stalls with a legal stock on the book.
Deno.test('SWEEP (stale by <= 30%, all priceable): stalled ONLY when no stock passes the full gate at its LIVE price', async () => {
  let picks = 0, stalls = 0;
  for (let seed = 3001; seed <= 3400; seed++) {
    const g = generate(seed, true, true);
    // The oracle judges on the market as it was when the turn started (the walk
    // writes fill prices back to the cache).
    const before = new FakeMarket(g.market.stocks.map((x) => ({ ...x })), g.market.slots, g.market.queue);
    const r = await chooseAutoPick(g.state, g.market, 7);
    assertNeverIllegal(r, g.state, g.market, g.pickerId, `seed ${seed}`);
    assert(g.market.screenCalls.length <= SCREEN_MAX_REQUESTS, `seed ${seed}: screens`);
    if (r.kind === 'pick') picks++;
    else if (r.kind === 'stalled') {
      stalls++;
      for (const st of before.stocks) {
        assert(!(await gateLegal(g.state, before, g.pickerId, st)), `seed ${seed}: STALLED although ${st.symbol} (cached ${st.cached}, live ${st.live}) passes the full gate`);
      }
    }
  }
  assert(picks > 100 && stalls > 10, `sweep must exercise both outcomes (picks=${picks}, stalls=${stalls})`);
});

// ---------------------------------------------------------------------------
// The pure pieces
// ---------------------------------------------------------------------------

Deno.test('openSlotWindows: exact brackets, the budget top, category; full slots and SKIPs as before', () => {
  const r: LeagueRules = { ...rules, stakeMode: 'budget_cap', budgetAmount: 300 };
  const slots = [slot('s1', 0, 50), slot('s2', 100, null, { categoryId: 'tech' }), slot('s3', 250, 500)];
  const picks = [pick('u', 'AAA', 1, { entry_price: 120, slot_id: 's1' })];
  assertEquals(openSlotWindows(r, slots, picks, [], 'u'), [
    { key: 's2', min: 100, max: null, top: 180, categoryId: 'tech' },
    { key: 's3', min: 250, max: 500, top: 180, categoryId: null },
  ]);
  assertEquals(openSlotWindows(rules, [], [], [], 'u'), [{ key: '__flex__', min: null, max: null, top: null, categoryId: null }]);
});

Deno.test('openSlotSpecs: the near-miss search widens every bracket AND the budget top by the margin', () => {
  const r: LeagueRules = { ...rules, stakeMode: 'budget_cap', budgetAmount: 300 };
  const slots = [slot('s1', 0, 50), slot('s2', 100, null), slot('s3', 250, 500)];
  const picks = [pick('u', 'AAA', 1, { entry_price: 120, slot_id: 'sX' })];
  assertEquals(openSlotSpecs(r, slots, picks, [], 'u', undefined, NEAR_MISS_MARGINS), [
    { min: 0, max: 75, categoryId: null },
    { min: 50, max: 270, categoryId: null },
    { min: 125, max: 270, categoryId: null }, // $250 floor reachable from a $125 cache; $180 top x 1.5
  ]);
  // A top that is gone stays gone however wide the search.
  assertEquals(openSlotSpecs({ ...r, budgetAmount: 100 }, [], [pick('u', 'AAA', 1)], [], 'u', undefined, NEAR_MISS_MARGINS), []);
  assertEquals(openSlotSpecs(rules, [slot('s1', 10, 20)], [], [], 'u', () => -1, NEAR_MISS_MARGINS), []);
});

Deno.test('isNearMiss: outside the exact window but within the margin, on an eligible open window', () => {
  const w = [{ key: 's1', min: 50, max: 100, top: null, categoryId: null }];
  assertEquals(isNearMiss(w, 75, new Set()), false, 'inside: not a near-miss');
  assertEquals(isNearMiss(w, 49.99, new Set()), true);
  assertEquals(isNearMiss(w, 25, new Set()), true, 'exactly 50% below the floor');
  assertEquals(isNearMiss(w, 24.99, new Set()), false, 'beyond the margin');
  assertEquals(isNearMiss(w, 150, new Set()), true);
  assertEquals(isNearMiss(w, 150.01, new Set()), false);
  assertEquals(isNearMiss(w, 100.004, new Set()), false, 'tier price $100.00 is inside (inclusive, cents)');
  // Budget top: over it but within the margin.
  const b = [{ key: '__flex__', min: null, max: null, top: 100, categoryId: null }];
  assertEquals([isNearMiss(b, 120, new Set()), isNearMiss(b, 151, new Set()), isNearMiss(b, 90, new Set())], [true, false, false]);
  // No price fixes a category, and a dead window (top <= 0) takes nothing.
  const cat = [{ key: 's1', min: 50, max: 100, top: null, categoryId: 'tech' }];
  assertEquals([isNearMiss(cat, 45, new Set(['tech'])), isNearMiss(cat, 45, new Set(['fin']))], [true, false]);
  assertEquals(isNearMiss([{ key: 's1', min: 50, max: 100, top: -1, categoryId: null }], 45, new Set()), false);
  assertEquals(isNearMiss(w, 45, new Set(), 0.05), false, 'margin is a parameter');
  assertEquals(NEAR_MISS_MARGIN, 0.5);
});

Deno.test('queue plan with a margin keeps a stale-cached row (near-miss), still drops what no price fixes', () => {
  const inputs = {
    rules: { ...rules, stakeMode: 'budget_cap' as const, budgetAmount: 1000 },
    slots: [slot('s1', 50, 500)],
    picks: [pick('x', 'TAKEN', 1)],
    trades: [],
    pickerId: 'u',
    queue: ['TAKEN', 'JUNK', 'STALE', 'FAR', 'PRICEY', 'OK'],
    queueMeta: [c('TAKEN'), c('JUNK', { isDraftable: false }), c('STALE', { lastPrice: 30 }), c('FAR', { lastPrice: 20 }), c('PRICEY', { lastPrice: 1600 }), c('OK')],
    eligibility: new Map<string, Set<string>>(),
    max: QUEUE_PLAN_MAX,
  };
  assertEquals(planQueueCandidates(inputs).map((x) => x.symbol), ['OK']);
  assertEquals(planQueueCandidates({ ...inputs, margin: NEAR_MISS_MARGIN }).map((x) => x.symbol), ['STALE', 'OK']);
});

// ---------------------------------------------------------------------------
// M3 (review, 2026-10-13): the screen's circuit breaker and the wall clock
// ---------------------------------------------------------------------------

// Mutation: drop `if (r.unavailable) screenDown = true;` -> the page's second
// chunk is still sent to a vendor that just failed.
Deno.test('M3: one failed screen request trips the breaker; no more screening this call (fills judge the rest)', async () => {
  // Two open slots, 100 near-misses each: one page, two screen chunks.
  const lo = Array.from({ length: 100 }, (_, i) => stock(`L${String(i).padStart(3, '0')}`, 48, { live: 47, marketCap: 100000 - i }));
  const hi = Array.from({ length: 100 }, (_, i) => stock(`H${String(i).padStart(3, '0')}`, 190, { live: 190, marketCap: 50000 - i }));
  const m = new FakeMarket([...lo, ...hi], [slot('s1', 50, 100), slot('s2', 200, 300, { slotIndex: 2 })]);
  m.screenDown = true;
  const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
  assertEquals(m.screenCalls.length, 1, `screens after the vendor failed: ${m.screenCalls.length}`);
  assertEquals(r.kind, 'retry_later'); // the fill bound, honestly: never a stall
  assert(m.priceCalls.length <= LIVE_MAX_ATTEMPTS);
});

/** Run fn with Date.now under test control. */
async function withClock<T>(fn: (advance: (ms: number) => void) => Promise<T>): Promise<T> {
  const real = Date.now;
  let t = real();
  Date.now = () => t;
  try {
    return await fn((ms) => (t += ms));
  } finally {
    Date.now = real;
  }
}

// Mutation: drop the deadline check in the queue loop -> Q2 is priced too.
Deno.test('M3: the wall clock is checked in the QUEUE phase: past the budget, the turn is left open (retry_later), nothing more priced', async () => {
  await withClock(async (advance) => {
    const m = new FakeMarket([stock('Q1', 50, { live: 900 }), stock('Q2', 50, { live: 900 }), stock('BIG', 50, { marketCap: 9 })], [slot('s1', 10, 100)], ['Q1', 'Q2']);
    m.onFill = () => advance(WALL_BUDGET_MS + 1);
    const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
    assertEquals(r.kind, 'retry_later');
    assertEquals(m.priceCalls, ['Q1']);
  });
});

// Mutation: drop the deadline check in screen() -> the second chunk is requested.
Deno.test('M3: the wall clock is checked between screen requests', async () => {
  await withClock(async (advance) => {
    // Two open slots, 100 near-misses each: one page, two screen chunks.
    const lo = Array.from({ length: 100 }, (_, i) => stock(`L${String(i).padStart(3, '0')}`, 48, { live: 47, marketCap: 100000 - i }));
    const hi = Array.from({ length: 100 }, (_, i) => stock(`H${String(i).padStart(3, '0')}`, 190, { live: 190, marketCap: 50000 - i }));
    const m = new FakeMarket([...lo, ...hi], [slot('s1', 50, 100), slot('s2', 200, 300, { slotIndex: 2 })]);
    m.onScreen = () => advance(WALL_BUDGET_MS + 1);
    const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
    assertEquals(r.kind, 'retry_later');
    assertEquals(m.screenCalls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// H1 (review, 2026-10-13): a TRUE stall must reach 'stalled', never loop.
// Before the fix a near-miss was judged on its cached price alone, fresh or not,
// and screen prices were never written back, so a fringe bigger than one call's
// budget was re-screened from the top on every tick: retry_later forever, with
// no record, no cooldown and no alert. Now every live price is written back
// (stamping last_price_at) and a FRESH cached price is judged as live, so each
// tick starts where the last one stopped.
// ---------------------------------------------------------------------------

// Mutation: isFresh always false -> tick 2 re-screens the same 500 and never stalls.
Deno.test('H1: a fringe bigger than one call\'s budget with NO legal stock reaches stalled, and the per-tick requests drop', async () => {
  const near = Array.from({ length: 700 }, (_, i) => stock(`N${String(i).padStart(4, '0')}`, 48, { live: 47, marketCap: 100000 - i }));
  const m = new FakeMarket(near, [slot('s1', 50, 100)]);
  const st = stateWith({}, fillerPicks([]));
  const screens: number[] = [];
  const fills: number[] = [];
  let r: AutoPickChoice = { kind: 'conflict' };
  for (let tick = 0; tick < 4 && r.kind !== 'stalled'; tick++) {
    const s0 = m.screenCalls.length, f0 = m.priceCalls.length;
    r = await chooseAutoPick(st, m, 7);
    screens.push(m.screenCalls.length - s0);
    fills.push(m.priceCalls.length - f0);
  }
  assertEquals(r.kind, 'stalled', JSON.stringify(r));
  // Tick 1: the 5-request screen budget (500 symbols) + 20 fallback fills, all written
  // back; tick 2: only the 180 not yet judged, 2 requests, no fills -> stalled.
  assertEquals(screens, [SCREEN_MAX_REQUESTS, 2]);
  assertEquals(fills, [LIVE_MAX_ATTEMPTS, 0]);
  const screened = m.screenCalls.flat();
  assertEquals(new Set(screened).size, screened.length, 'a symbol was screened twice');
  assert(m.writes.every((n) => n <= 100), 'one batched write per screen chunk');
});

Deno.test('H1: a large fringe (2,500) still stalls within ceil(2500 / 520) + 1 ticks, never more than the per-call bound per tick', async () => {
  const near = Array.from({ length: 2500 }, (_, i) => stock(`N${String(i).padStart(4, '0')}`, 48, { live: 47, marketCap: 100000 - i }));
  const m = new FakeMarket(near, [slot('s1', 50, 100)]);
  const st = stateWith({}, fillerPicks([]));
  let r: AutoPickChoice = { kind: 'conflict' };
  let ticks = 0;
  while (r.kind !== 'stalled' && ticks < 10) {
    const s0 = m.screenCalls.length, f0 = m.priceCalls.length;
    r = await chooseAutoPick(st, m, 7);
    ticks++;
    assert(m.screenCalls.length - s0 <= SCREEN_MAX_REQUESTS && m.priceCalls.length - f0 <= LIVE_MAX_ATTEMPTS, `tick ${ticks} over the bound`);
  }
  assertEquals(r.kind, 'stalled');
  assert(ticks <= Math.ceil(2500 / (SCREEN_MAX_REQUESTS * 100 + LIVE_MAX_ATTEMPTS)) + 1, `took ${ticks} ticks`);
});

// Mutation: drop the isFresh 'skip' in planOf -> FRESHN is screened.
Deno.test('H1: a FRESH cached near-miss is judged as live (no screen, no fill); a stale one is screened', async () => {
  const m = new FakeMarket([stock('FRESHN', 48, { live: 47, marketCap: 9 }), stock('STALEN', 48, { live: 47, marketCap: 8 })], [slot('s1', 50, 100)]);
  m.priceAt.set('FRESHN', Date.now() - 60_000);
  m.priceAt.set('STALEN', Date.now() - FRESH_MS - 1);
  const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
  assertEquals(r.kind, 'stalled');
  assertEquals(m.screenCalls.flat(), ['STALEN']);
  assertEquals(m.priceCalls, []);
});

// Mutation: drop the queue's isFresh branch -> QFRESH costs a fill call.
Deno.test('H1: a FRESH queued near-miss is judged on its cached price, not screened', async () => {
  const m = new FakeMarket([stock('MEGA', 70, { marketCap: 9999 }), stock('QFRESH', 40, { live: 41, marketCap: 1 })], [slot('s1', 50, 100)], ['QFRESH']);
  m.priceAt.set('QFRESH', Date.now());
  const r = await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
  assert(r.kind === 'pick', JSON.stringify(r));
  assertEquals(r.gated.symbol, 'MEGA');
  assertEquals(m.screenCalls.flat().includes('QFRESH'), false);
  assertEquals(m.priceCalls, ['MEGA'], 'no fill call on a fresh queued refusal');
});

Deno.test('H1: every screen price is written back in one batch per chunk', async () => {
  const near = Array.from({ length: 150 }, (_, i) => stock(`N${String(i).padStart(3, '0')}`, 48, { live: 47, marketCap: 1000 - i }));
  const m = new FakeMarket(near, [slot('s1', 50, 100)]);
  await chooseAutoPick(stateWith({}, fillerPicks([])), m, 7);
  assertEquals(m.writes, [100, 50]);
  assert(near.every((x) => m.priceAt.has(x.symbol) && x.cached === 47));
});

Deno.test('stallCooldownVerdict: legality stalls answer stalled; a bound answers retry until escalated; outages and old rows search', () => {
  const now = 1_000_000, cd = 60_000;
  const row = (reason: string, attempts: number, ago: number) => ({ reason, attempts, lastSeenMs: now - ago });
  assertEquals(stallCooldownVerdict(null, now, cd), 'search');
  assertEquals(stallCooldownVerdict(row('vendor_outage', 0, 1), now, cd), 'search');
  assertEquals(stallCooldownVerdict(row('nothing_legal', 1, 1), now, cd), 'stalled');
  assertEquals(stallCooldownVerdict(row('nothing_legal', 1, cd), now, cd), 'search');
  assertEquals(stallCooldownVerdict(row('search_bounded', 1, 1), now, cd), 'retry');
  assertEquals(stallCooldownVerdict(row('search_bounded', BOUNDED_STALL_AFTER, 1), now, cd), 'stalled');
  assertEquals(stallCooldownVerdict(row('search_bounded', BOUNDED_STALL_AFTER, cd + 1), now, cd), 'search');
  assertEquals(stallCooldownVerdict({ reason: 'nothing_legal', attempts: 1, lastSeenMs: NaN }, now, cd), 'search');
});
