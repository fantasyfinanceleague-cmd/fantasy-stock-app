// Hermetic tests for record-trade's write path (commit.ts): the paginated
// reader, the CAS expectation, and the attempt loop's refusal mapping.
// The same loop against real Postgres: supabase/tests/record_trade_atomic.pglite.test.ts.
//   deno test supabase/functions/record-trade/commit.test.ts
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  type CommitDeps,
  commitWithRetry,
  decideTrade,
  type Expectation,
  expectationFor,
  type LedgerState,
  MAX_ATTEMPTS,
  MAX_PAGES,
  readAllPages,
  type Reply,
  slotPreview,
  type TradePlan,
} from './commit.ts';

// ---------------------------------------------------------------------------
// readAllPages
// ---------------------------------------------------------------------------

/** A fake PostgREST endpoint over `total` rows: honours the requested range
 * but never returns more than `cap` rows (its max_rows), like PostgREST. */
function fakeEndpoint(total: number, opts: { cap?: number; withCount?: boolean } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ n: i }));
  const calls: Array<[number, number]> = [];
  const cap = opts.cap ?? 1000;
  const fetchPage = (from: number, to: number) => {
    calls.push([from, to]);
    const data = rows.slice(from, Math.min(to + 1, from + cap));
    return Promise.resolve({ data, error: null, count: opts.withCount === false ? null : total });
  };
  return { fetchPage, calls };
}

Deno.test('readAllPages: 2500 rows come back whole, in order, over 3 ranged requests', async () => {
  const ep = fakeEndpoint(2500);
  const r = await readAllPages(ep.fetchPage);
  assert(r.ok);
  assertEquals(r.rows.length, 2500);
  assertEquals(r.rows.map((x) => x.n), Array.from({ length: 2500 }, (_, i) => i));
  assertEquals(ep.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

Deno.test('readAllPages: exactly 1000 rows with a count is ONE request (no trailing empty page)', async () => {
  const ep = fakeEndpoint(1000);
  const r = await readAllPages(ep.fetchPage);
  assert(r.ok);
  assertEquals(r.rows.length, 1000);
  assertEquals(ep.calls.length, 1);
});

Deno.test('readAllPages: a server max_rows BELOW the page size is not mistaken for the end', async () => {
  // The un-paginated pre-fix read stopped at the cap; so would a naive
  // "short page = last page" loop. The exact count keeps it going.
  const ep = fakeEndpoint(1234, { cap: 500 });
  const r = await readAllPages(ep.fetchPage);
  assert(r.ok);
  assertEquals(r.rows.length, 1234);
  assertEquals(ep.calls.map(([f]) => f), [0, 500, 1000]);
});

Deno.test('readAllPages: without a count, a short page ends the read', async () => {
  const ep = fakeEndpoint(1500, { withCount: false });
  const r = await readAllPages(ep.fetchPage);
  assert(r.ok);
  assertEquals(r.rows.length, 1500);
  assertEquals(ep.calls.length, 2);
});

Deno.test('readAllPages: zero rows; an error on page 2 is an error, never a partial success', async () => {
  const empty = await readAllPages(fakeEndpoint(0).fetchPage);
  assert(empty.ok);
  assertEquals(empty.rows, []);

  let n = 0;
  const r = await readAllPages((_f, _t) => {
    n++;
    return Promise.resolve(
      n === 1
        ? { data: Array.from({ length: 1000 }, () => ({})), error: null, count: 1500 }
        : { data: null, error: { message: 'boom' }, count: null },
    );
  });
  assertEquals(r.ok, false);
});

Deno.test('readAllPages: a count that never completes stops at MAX_PAGES with an error', async () => {
  let n = 0;
  const r = await readAllPages((_f, _t) => {
    n++;
    return Promise.resolve({ data: [{}], error: null, count: 1e9 });
  }, 1);
  assertEquals(r.ok, false);
  assertEquals(n, MAX_PAGES);
});

// ---------------------------------------------------------------------------
// Fixtures for the loop
// ---------------------------------------------------------------------------

const ME = '11111111-1111-1111-1111-111111111111';

function state(over: Partial<LedgerState> = {}): LedgerState {
  return {
    league: {
      draft_status: 'completed',
      stake_mode: 'budget_cap',
      budget_amount: 1000,
      notional_per_slot: 1000,
      num_rounds: 3,
      allow_undraftable: false,
    },
    picks: [{ id: 'd1', user_id: ME, symbol: 'AAPL', entry_price: 100, quantity: 1, pick_number: 1, slot_id: null }],
    trades: [],
    slots: [],
    eligibleCategories: new Set(),
    ...over,
  };
}

const ok = (plan: TradePlan = { quantity: 1, fundedByTradeId: null, slotId: null }) => ({ ok: true as const, value: plan });

interface Harness {
  deps: CommitDeps;
  commits: Array<{ plan: TradePlan; expect: Expectation }>;
  reads: number;
}

/** commit() answers come from `answers` in order; readState returns `reread`. */
function harness(
  answers: Array<{ data: unknown; error: { code?: string; message?: string } | null }>,
  over: Partial<CommitDeps> = {},
  reread: () => LedgerState = () => state(),
): Harness {
  const h: Harness = { commits: [], reads: 0, deps: {} as CommitDeps };
  h.deps = {
    readState: () => {
      h.reads++;
      return Promise.resolve({ ok: true, value: reread() });
    },
    decide: () => ok(),
    marketRecheck: () => null,
    commit: (plan, expect) => {
      h.commits.push({ plan, expect });
      return Promise.resolve(answers.shift() ?? { data: null, error: { message: 'no more answers' } });
    },
    ...over,
  };
  return h;
}

const CHANGED = { data: { ok: false, reason: 'ledger_changed', changed: 'trades' }, error: null };
const COMMITTED = { data: { ok: true, trade: { id: 't-new' } }, error: null };

// ---------------------------------------------------------------------------
// expectationFor
// ---------------------------------------------------------------------------

Deno.test('expectationFor: a buy sends the exact id sets plus RAW rules and slot rows', () => {
  const s = state({
    trades: [{ id: 't1', user_id: ME, symbol: 'X', action: 'buy', quantity: 1, price: 5 }],
    slots: [{ id: 's1', slot_index: 0, slot_count: 1, price_min: '10.50', price_max: null, category_id: null }],
  });
  assertEquals(expectationFor(s), {
    seenTradeIds: ['t1'],
    seenDraftIds: ['d1'],
    rules: { stake_mode: 'budget_cap', budget_amount: 1000, notional_per_slot: 1000, num_rounds: 3, allow_undraftable: false },
    slots: [{ id: 's1', slot_index: 0, slot_count: 1, price_min: '10.50', price_max: null, category_id: null }],
  });
});

Deno.test('expectationFor: a sell sends NO rules/slots (validateTradeDrop reads neither)', () => {
  const e = expectationFor(state({ slots: null }));
  assertEquals(e.rules, null);
  assertEquals(e.slots, null);
  assertEquals(e.seenDraftIds, ['d1']);
});

// ---------------------------------------------------------------------------
// commitWithRetry
// ---------------------------------------------------------------------------

Deno.test('commit: first attempt commits; firstState is used without a re-read', async () => {
  const h = harness([COMMITTED]);
  const r = await commitWithRetry(h.deps, { firstState: state() });
  assertEquals(r, { status: 200, body: { ok: true, trade: { id: 't-new' } } });
  assertEquals(h.reads, 0);
  assertEquals(h.commits.length, 1);
  assertEquals(h.commits[0].expect.seenDraftIds, ['d1']);
});

Deno.test('commit: ledger_changed -> re-read -> the loser gets the GAME refusal (not_owned), not a conflict', async () => {
  // A double sell: attempt 1 saw the position; the re-read sees the winner's
  // sell, and the real validator refuses.
  const held = state({ slots: null });
  const afterWinner = state({
    slots: null,
    trades: [{ id: 'w', user_id: ME, symbol: 'AAPL', action: 'sell', quantity: 1, price: 100 }],
  });
  const req = { action: 'sell' as const, userId: ME, symbol: 'AAPL', price: 100, isDraftable: true };
  const h = harness([CHANGED], { decide: (s) => decideTrade(req, s) }, () => afterWinner);
  const r = await commitWithRetry(h.deps, { firstState: held });
  assertEquals(r, { status: 200, body: { ok: false, reason: 'not_owned' } });
  assertEquals(h.reads, 1);
  assertEquals(h.commits.length, 1);
});

Deno.test('commit: the re-read state is what the next commit expects', async () => {
  const fresh = state({ trades: [{ id: 'w', user_id: 'other', symbol: 'Z', action: 'buy', quantity: 1, price: 1 }] });
  const h = harness([CHANGED, COMMITTED], {}, () => fresh);
  const r = await commitWithRetry(h.deps, { firstState: state() });
  assertEquals(r.body.ok, true);
  assertEquals(h.commits.map((c) => c.expect.seenTradeIds), [[], ['w']]);
});

Deno.test(`commit: ${MAX_ATTEMPTS} straight conflicts -> trade_conflict (200), never a success`, async () => {
  const h = harness([CHANGED, CHANGED, CHANGED, COMMITTED]);
  const r = await commitWithRetry(h.deps, { firstState: state() });
  assertEquals(r, { status: 200, body: { ok: false, reason: 'trade_conflict' } });
  assertEquals(h.commits.length, MAX_ATTEMPTS);
  assertEquals(h.reads, MAX_ATTEMPTS - 1);
});

Deno.test('commit: trade_conflict ONLY when EVERY attempt got ledger_changed — any other outcome on the last attempt maps elsewhere', async () => {
  const funded23505 = {
    data: null,
    error: { code: '23505', message: 'duplicate key value violates unique constraint "trades_funded_by_trade_id_unique"' },
  };
  const cases: Array<[string, Array<{ data: unknown; error: { code?: string; message?: string } | null }>, Reply]> = [
    ['all ledger_changed', [CHANGED, CHANGED, CHANGED], { status: 200, body: { ok: false, reason: 'trade_conflict' } }],
    ['rpc { error } last', [CHANGED, CHANGED, { data: null, error: { code: 'XX000', message: 'boom' } }], {
      status: 500,
      body: { ok: false, reason: 'unhandled' },
    }],
    ['timeout-shaped { error } last', [CHANGED, CHANGED, { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }], {
      status: 500,
      body: { ok: false, reason: 'unhandled' },
    }],
    ['funded 23505 last', [CHANGED, CHANGED, funded23505], { status: 200, body: { ok: false, reason: 'proceeds_unavailable' } }],
    ['other 23505 first', [{ data: null, error: { code: '23505', message: 'dup "x"' } }], { status: 500, body: { ok: false, reason: 'unhandled' } }],
    ['null data last', [CHANGED, CHANGED, { data: null, error: null }], { status: 500, body: { ok: false, reason: 'unhandled' } }],
    ['bad_request last', [CHANGED, CHANGED, { data: { ok: false, reason: 'bad_request' }, error: null }], {
      status: 500,
      body: { ok: false, reason: 'unhandled' },
    }],
    ['success last', [CHANGED, CHANGED, COMMITTED], { status: 200, body: { ok: true, trade: { id: 't-new' } } }],
  ];
  for (const [name, answers, want] of cases) {
    const h = harness([...answers]);
    const r = await commitWithRetry(h.deps, { firstState: state() });
    assertEquals(r, want, name);
    if (want.body.reason !== 'trade_conflict') assert(r.body.reason !== 'trade_conflict', name);
  }
});

Deno.test('commit: a THROWN commit (transport failure / timeout) propagates — never trade_conflict, never success', async () => {
  // index.ts's outer try/catch turns this into 500 'unhandled'.
  let n = 0;
  const h = harness([], {
    commit: () => {
      n++;
      return n < 3 ? Promise.resolve(CHANGED) : Promise.reject(new Error('fetch timeout'));
    },
  });
  let threw = false;
  try {
    await commitWithRetry(h.deps, { firstState: state() });
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message, 'fetch timeout');
  }
  assert(threw, 'a thrown commit must not resolve to any reply');
});

Deno.test('commit: no firstState -> reads before the first attempt', async () => {
  const h = harness([COMMITTED]);
  await commitWithRetry(h.deps);
  assertEquals(h.reads, 1);
});

Deno.test('commit: an rpc { error } is 500 unhandled — never success, never retried', async () => {
  const h = harness([{ data: null, error: { code: 'XX000', message: 'boom' } }, COMMITTED]);
  const r = await commitWithRetry(h.deps, { firstState: state() });
  assertEquals(r, { status: 500, body: { ok: false, reason: 'unhandled' } });
  assertEquals(h.commits.length, 1);
});

Deno.test('commit: a raw 23505 on trades_funded_by_trade_id_unique is proceeds_unavailable; any other 23505 is 500', async () => {
  const funded = harness([{
    data: null,
    error: { code: '23505', message: 'duplicate key value violates unique constraint "trades_funded_by_trade_id_unique"' },
  }]);
  assertEquals(await commitWithRetry(funded.deps, { firstState: state() }), {
    status: 200,
    body: { ok: false, reason: 'proceeds_unavailable' },
  });
  const other = harness([{ data: null, error: { code: '23505', message: 'duplicate key "some_future_index"' } }]);
  assertEquals((await commitWithRetry(other.deps, { firstState: state() })).status, 500);
});

Deno.test('commit: RPC refusals map to the statuses record-trade has always used', async () => {
  const cases: Array<[string, number]> = [
    ['draft_not_completed', 200],
    ['proceeds_unavailable', 200],
    ['not_a_member', 403],
    ['league_not_found', 404],
  ];
  for (const [reason, status] of cases) {
    const h = harness([{ data: { ok: false, reason }, error: null }]);
    assertEquals(await commitWithRetry(h.deps, { firstState: state() }), { status, body: { ok: false, reason } }, reason);
    assertEquals(h.commits.length, 1, reason);
  }
});

Deno.test('commit: bad_request, null data and unknown shapes are 500 — never read as success', async () => {
  for (
    const data of [{ ok: false, reason: 'bad_request' }, null, { ok: 'yes' }, { reason: 42 }, 'ok', { ok: false, reason: 'constructor' }, {
      ok: false,
      reason: 'toString',
    }]
  ) {
    const h = harness([{ data, error: null }]);
    assertEquals(await commitWithRetry(h.deps, { firstState: state() }), {
      status: 500,
      body: { ok: false, reason: 'unhandled' },
    }, JSON.stringify(data));
  }
});

Deno.test('commit: the market re-check runs before EVERY write; closing between attempts stops the retry', async () => {
  let checks = 0;
  const closed: Reply = { status: 200, body: { ok: false, reason: 'market_closed' } };
  const h = harness([CHANGED, COMMITTED], { marketRecheck: () => (++checks === 1 ? null : closed) });
  const r = await commitWithRetry(h.deps, { firstState: state() });
  assertEquals(r, closed);
  assertEquals(checks, 2);
  assertEquals(h.commits.length, 1);
});

Deno.test('commit: a refusal from the re-read (draft reset, league gone) ends the loop with it', async () => {
  const reset: Reply = { status: 200, body: { ok: false, reason: 'draft_not_completed' } };
  const h = harness([CHANGED, COMMITTED], { readState: () => Promise.resolve({ ok: false, reply: reset }) });
  assertEquals(await commitWithRetry(h.deps, { firstState: state() }), reset);
  assertEquals(h.commits.length, 1);
});

// ---------------------------------------------------------------------------
// decideTrade (thin wrapper — the rules themselves are in draft-validation.test.ts)
// ---------------------------------------------------------------------------

Deno.test('decideTrade: buy of an owned symbol -> 200 symbol_owned; legal buy -> one share, no funding', () => {
  const buy = { action: 'buy' as const, userId: ME, symbol: 'AAPL', price: 100, isDraftable: true };
  assertEquals(decideTrade(buy, state()), {
    ok: false,
    reply: { status: 200, body: { ok: false, reason: 'symbol_owned' } },
  });
  assertEquals(decideTrade({ ...buy, symbol: 'MSFT' }, state()), ok({ quantity: 1, fundedByTradeId: null, slotId: null }));
});

Deno.test('decideTrade: rules come from the RAW league row (string numerics from PostgREST)', () => {
  const s = state({ league: { ...state().league, budget_amount: '150.00' } });
  const buy = { action: 'buy' as const, userId: ME, symbol: 'MSFT', price: 60, isDraftable: true };
  // spent 100 on the draft pick; 100 + 60 > 150
  assertEquals(decideTrade(buy, s), { ok: false, reply: { status: 200, body: { ok: false, reason: 'over_budget' } } });
});

// ---------------------------------------------------------------------------
// Tier slots (tier-trade-slots, 2026-10-06): the plan carries the slot, a refusal
// carries what the client needs for its sentence, a success names the slot filled.
// ---------------------------------------------------------------------------

const LO = { id: 's-lo', slot_index: 0, slot_count: 1, price_min: '0', price_max: '200', category_id: null };
const HI = { id: 's-hi', slot_index: 1, slot_count: 1, price_min: '200', price_max: null, category_id: null };
const tierState = (over: Partial<LedgerState> = {}) =>
  state({
    league: { ...state().league, stake_mode: 'price_tiers', num_rounds: 4 },
    picks: [{ id: 'd1', user_id: ME, symbol: 'NVDA', entry_price: 900, quantity: 1, pick_number: 1, slot_id: HI.id }],
    slots: [LO, HI],
    ...over,
  });
const buyReq = (symbol: string, price: number) =>
  ({ action: 'buy' as const, userId: ME, symbol, price, isDraftable: true });

Deno.test('decideTrade (tiers): a legal buy plans the slot it takes; a sell plans none', () => {
  const d = decideTrade(buyReq('MSFT', 100), tierState());
  assertEquals(d, ok({ quantity: 1, fundedByTradeId: null, slotId: LO.id }));
  const sell = decideTrade({ action: 'sell', userId: ME, symbol: 'NVDA', price: 900, isDraftable: true }, tierState());
  assertEquals(sell, ok({ quantity: 1, fundedByTradeId: null, slotId: null }));
});

Deno.test('decideTrade (tiers): THE REPRO — after a trade fills lo, the next buy is refused with price + open_slots', () => {
  const s = tierState({
    trades: [{ id: 't1', user_id: ME, symbol: 'MSFT', action: 'buy', quantity: 1, price: 100, slot_id: LO.id, created_at: '2026-10-01T15:00:00Z' }],
  });
  assertEquals(decideTrade(buyReq('GOOG', 150), s), {
    ok: false,
    reply: { status: 200, body: { ok: false, reason: 'no_eligible_slot', price: 150, open_slots: [] } },
  });
});

Deno.test('decideTrade (tiers): the refusal names the OPEN slots (ranges as numbers) so the client can write its sentence', () => {
  // lo is held by a drafted stock, hi is open; $50 fits only lo -> refused, hi is what is open
  const s = tierState({
    picks: [{ id: 'd1', user_id: ME, symbol: 'CHEAP', entry_price: 20, quantity: 1, pick_number: 1, slot_id: LO.id }],
  });
  const r = decideTrade(buyReq('PENNY', 50), s);
  assert(!r.ok);
  assertEquals(r.reply.body, {
    ok: false,
    reason: 'no_eligible_slot',
    price: 50,
    open_slots: [{ slot_id: HI.id, slot_index: 1, slot_count: 1, price_min: 200, price_max: null, category_id: null }],
  });
});

Deno.test('decideTrade: other refusals carry NO slot fields', () => {
  const d = decideTrade(buyReq('NVDA', 100), tierState());
  assertEquals(d, { ok: false, reply: { status: 200, body: { ok: false, reason: 'symbol_owned' } } });
});

Deno.test('commitWithRetry: a committed slotted buy returns the slot it filled', async () => {
  const s = tierState();
  const h = harness([COMMITTED], {
    decide: (st) => decideTrade(buyReq('MSFT', 100), st),
  });
  const r = await commitWithRetry(h.deps, { firstState: s });
  assertEquals(h.commits[0].plan.slotId, LO.id);
  assertEquals(r.body, {
    ok: true,
    trade: { id: 't-new' },
    slot: { slot_id: LO.id, slot_index: 0, slot_count: 1, price_min: 0, price_max: 200, category_id: null },
  });
});

Deno.test('commitWithRetry: a slot-less league (or a sell) returns no slot field', async () => {
  const h = harness([COMMITTED]);
  const r = await commitWithRetry(h.deps, { firstState: state() });
  assertEquals(r.body, { ok: true, trade: { id: 't-new' } });
});

Deno.test('commitWithRetry: after a lost race the buy re-validates and is refused no_eligible_slot (not trade_conflict)', async () => {
  const winner = tierState({
    trades: [{ id: 't1', user_id: ME, symbol: 'MSFT', action: 'buy', quantity: 1, price: 100, slot_id: LO.id, created_at: '2026-10-01T15:00:00Z' }],
  });
  const h = harness([CHANGED], { decide: (st) => decideTrade(buyReq('GOOG', 150), st) }, () => winner);
  const r = await commitWithRetry(h.deps, { firstState: tierState() });
  assertEquals(r.body.reason, 'no_eligible_slot');
  assertEquals(h.commits.length, 1, 'the second attempt was refused before any write');
});

Deno.test('slotPreview: slot-less league -> empty map; slotted -> held symbols + open capacity, no would_fill without a price', () => {
  assertEquals(slotPreview(state(), ME), { slots: [], unplaced: [] });
  const s = tierState({
    trades: [{ id: 't1', user_id: ME, symbol: 'MSFT', action: 'buy', quantity: 1, price: 100, slot_id: LO.id, created_at: '2026-10-01T15:00:00Z' }],
  });
  const p = slotPreview(s, ME);
  assertEquals(p, {
    slots: [
      { slot_id: LO.id, slot_index: 0, slot_count: 1, price_min: 0, price_max: 200, category_id: null, held: ['MSFT'], open: 0 },
      { slot_id: HI.id, slot_index: 1, slot_count: 1, price_min: 200, price_max: null, category_id: null, held: ['NVDA'], open: 0 },
    ],
    unplaced: [],
  });
});

Deno.test('slotPreview: would_fill is the slot a buy at that price takes; null + open_slots when none', () => {
  const free = slotPreview(tierState(), ME, 150);
  assertEquals((free.would_fill as { slot_id: string }).slot_id, LO.id);
  assertEquals(free.open_slots, undefined);
  const held = tierState({
    trades: [{ id: 't1', user_id: ME, symbol: 'MSFT', action: 'buy', quantity: 1, price: 100, slot_id: LO.id, created_at: '2026-10-01T15:00:00Z' }],
  });
  const none = slotPreview(held, ME, 150);
  assertEquals(none.would_fill, null);
  assertEquals(none.open_slots, []);
  // garbage price hints are ignored, never throw
  for (const bad of [0, -5, NaN, Infinity]) assertEquals('would_fill' in slotPreview(tierState(), ME, bad), false);
});

Deno.test('slotPreview: only the CALLER\'s positions count (a neighbour\'s buy does not fill my tier)', () => {
  const s = tierState({
    trades: [{ id: 't1', user_id: 'someone-else', symbol: 'MSFT', action: 'buy', quantity: 1, price: 100, slot_id: LO.id, created_at: '2026-10-01T15:00:00Z' }],
  });
  assertEquals((slotPreview(s, ME, 150).would_fill as { slot_id: string }).slot_id, LO.id);
});
