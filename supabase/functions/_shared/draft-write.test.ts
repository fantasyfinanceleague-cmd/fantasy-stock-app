/**
 * Hermetic tests for the post-pick step in draft-write.ts: after a recorded
 * pick, push "your turn" to the NEXT picker (commitGatedPick ->
 * notifyNextPicker), on the manual route and the auto-pick route alike.
 * No DB, no Expo, no Alpaca: the admin client is an in-memory fake and the
 * push sender is injected. Run:
 *
 *   deno test supabase/functions/_shared/draft-write.test.ts
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  autoPickTurn,
  commitGatedPick,
  type DraftContext,
  nextTurnAfter,
  notifyNextPicker,
  noteOutage,
  recordStall,
  STALL_COOLDOWN_MS,
  supabaseAutoPickPorts,
  type TurnPushPorts,
} from './draft-write.ts';
import { type AutoPickPorts, BOUNDED_STALL_AFTER, boundedReportsStalled, OUTAGE_ESCALATE_MS } from './auto-pick.ts';
import type { GatedPick } from './pick-gate.ts';
import type { PushMessage } from './push.ts';
import { DRAFT_OUTAGE_PUSH, draftOutageMessage, draftTurnMessage } from './push-copy.ts';
import { fetchFillPrice } from './alpaca-price.ts';
import { buildPoolGroups } from './draft-feasibility.ts';
import type { PickRow, Slot } from './draft-validation.ts';

const LEAGUE_NAME = 'Moon League';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Just enough of supabase-js for insertGatedPick / finalizeDraft / recentStall:
 * every chain is awaitable and resolves { data, error } (never throws). */
// deno-lint-ignore no-explicit-any
function fakeAdmin(opts: { insertError?: { code: string } } = {}): any {
  const calls: string[] = [];
  const from = (table: string) => {
    let op = 'select';
    // deno-lint-ignore no-explicit-any
    let row: any = null;
    // deno-lint-ignore no-explicit-any
    const b: any = {
      insert(r: unknown) {
        op = 'insert';
        row = r;
        calls.push(`${table}.insert`);
        return b;
      },
      delete() {
        op = 'delete';
        calls.push(`${table}.delete`);
        return b;
      },
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      single: () => b,
      maybeSingle: () => b,
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        const out = table === 'drafts' && op === 'insert'
          ? (opts.insertError ? { data: null, error: opts.insertError } : { data: { id: 'row-1', ...row }, error: null })
          : { data: null, error: null };
        return Promise.resolve(out).then(res, rej);
      },
    };
    return b;
  };
  const rpc = (name: string) => {
    calls.push(`rpc.${name}`);
    return Promise.resolve({ data: { status: 'finalized' }, error: null });
  };
  return { calls, from, rpc };
}

interface Sent {
  token: string;
  msg: PushMessage;
}

/** Injected push I/O. `tokens` maps user id -> device token. */
function fakePush(o: {
  tokens?: Record<string, string>;
  disabled?: string[];
  lookupFailed?: boolean;
  lookupThrows?: boolean;
  sendFails?: boolean;
  sendThrows?: boolean;
} = {}) {
  const lookups: string[] = [];
  const sent: Sent[] = [];
  const ports: TurnPushPorts = {
    getTargetToken: (_admin, userId) => {
      lookups.push(userId);
      if (o.lookupThrows) return Promise.reject(new Error('boom'));
      if (o.lookupFailed) return Promise.resolve({ token: null, enabled: false, lookupFailed: true });
      return Promise.resolve({
        token: o.tokens?.[userId] ?? null,
        enabled: !(o.disabled ?? []).includes(userId),
        lookupFailed: false,
      });
    },
    sendExpoPush: (token, msg) => {
      if (o.sendThrows) return Promise.reject(new Error('network down'));
      sent.push({ token, msg });
      return Promise.resolve(o.sendFails ? { sent: false, reason: 'expo_ticket_error' } : { sent: true });
    },
  };
  return { ports, lookups, sent };
}

const TOKENS = { A: 'tok-A', B: 'tok-B', C: 'tok-C' };

const pickRow = (user_id: string, n: number): PickRow => ({
  user_id,
  symbol: `S${n}`,
  entry_price: 100,
  quantity: 1,
  pick_number: n,
});

/** A context where `made` picks already exist, picked by whoever's turn it was. */
function ctxWith(order: string[], numRounds: number, made: number): DraftContext {
  const picks: PickRow[] = [];
  for (let n = 1; n <= made; n++) picks.push(pickRow(nextTurnAfter(n - 1, order, numRounds)!.pickerId, n));
  return {
    league: {
      id: 'L1',
      name: LEAGUE_NAME,
      commissioner_id: order[0],
      num_rounds: numRounds,
      draft_status: 'in_progress',
      stake_mode: null,
      league_type: 'duration',
      duration_days: 28,
    },
    memberIds: [...order],
    order,
    numRounds,
    picks,
    trades: [],
  };
}

/** The gated pick for the CURRENT turn of ctx (tests only: pick-gate.ts is the
 * one producer in function code, enforced by draft_insert_sites.test.ts). */
function gatedFor(ctx: DraftContext): GatedPick {
  const turn = nextTurnAfter(ctx.picks.length, ctx.order, ctx.numRounds)!;
  return {
    leagueId: String(ctx.league.id),
    pickerId: turn.pickerId,
    symbol: `S${turn.pickNumber}`,
    price: 100,
    quantity: 1,
    round: turn.round,
    pickNumber: turn.pickNumber,
    slotId: null,
  } as unknown as GatedPick;
}

// ---------------------------------------------------------------------------
// Next-picker math (snake)
// ---------------------------------------------------------------------------

Deno.test('nextTurnAfter: snake order, odd rounds forward, even rounds reversed, null when complete', () => {
  const order = ['A', 'B', 'C'];
  const who = (n: number) => nextTurnAfter(n, order, 3)?.pickerId ?? null;
  // Round 1 (odd, forward): after pick 1 -> B, after pick 2 -> C.
  assertEquals([who(1), who(2)], ['B', 'C']);
  // Snake turnaround: after pick 3 the round-2 opener is C again.
  assertEquals(who(3), 'C');
  // Round 2 (even, reversed): C, B, A.
  assertEquals([who(4), who(5)], ['B', 'A']);
  // Round 3 (odd, forward) opens with A again.
  assertEquals([who(6), who(7), who(8)], ['A', 'B', 'C']);
  // After the final pick (9 = 3 x 3) nobody is next.
  assertEquals(who(9), null);
  assertEquals(nextTurnAfter(5, order, 3), { round: 2, pickNumber: 6, pickerId: 'A' });
});

// ---------------------------------------------------------------------------
// commitGatedPick: the manual route
// ---------------------------------------------------------------------------

Deno.test('manual pick in an ODD round pushes the next picker the draft_turn copy', async () => {
  const ctx = ctxWith(['A', 'B', 'C'], 3, 0); // A is up with pick 1
  const admin = fakeAdmin();
  const push = fakePush({ tokens: TOKENS });
  const res = await commitGatedPick(admin, ctx, gatedFor(ctx), 'manual', push.ports);
  assert(res.ok);
  assertEquals(res.complete, false);
  assertEquals(res.turnPush, 'sent');
  assertEquals(push.lookups, ['B']);
  assertEquals(push.sent.length, 1);
  assertEquals(push.sent[0].token, 'tok-B');
  // The copy is the shared builder's, with the league name from the leagues row.
  assertEquals(push.sent[0].msg, draftTurnMessage(LEAGUE_NAME, 'L1', 2));
  // The data carries the app's once-per-turn key: the league and the turn's pick (B's pick 2).
  assertEquals(push.sent[0].msg, {
    title: "It's Your Turn! 🏈",
    body: 'Time to make your pick in Moon League',
    data: { type: 'draft_turn', screen: 'draft', league_id: 'L1', pick_number: 2 },
  });
  assertEquals(admin.calls.includes('rpc.finalize_league_draft'), false);
});

Deno.test('manual pick in an EVEN round (reversed) pushes the right next picker', async () => {
  const ctx = ctxWith(['A', 'B', 'C'], 3, 4); // round 2, pick 5 is B's (C, B, A)
  assertEquals(gatedFor(ctx).pickerId, 'B');
  const push = fakePush({ tokens: TOKENS });
  const res = await commitGatedPick(fakeAdmin(), ctx, gatedFor(ctx), 'manual', push.ports);
  assert(res.ok);
  assertEquals(push.sent.map((s) => s.token), ['tok-A']); // pick 6, end of round 2
});

Deno.test('the FINAL pick finalizes and pushes nobody', async () => {
  const ctx = ctxWith(['A', 'B', 'C'], 3, 8); // pick 9 of 9
  const admin = fakeAdmin();
  const push = fakePush({ tokens: TOKENS });
  const res = await commitGatedPick(admin, ctx, gatedFor(ctx), 'manual', push.ports);
  assert(res.ok);
  assertEquals(res.complete, true);
  assertEquals(res.turnPush, null);
  assertEquals(push.lookups, []);
  assertEquals(push.sent, []);
  assert(admin.calls.includes('rpc.finalize_league_draft'));
});

Deno.test('a lost race (pick_conflict) wrote nothing and pushes nobody', async () => {
  const ctx = ctxWith(['A', 'B', 'C'], 3, 0);
  const push = fakePush({ tokens: TOKENS });
  const res = await commitGatedPick(fakeAdmin({ insertError: { code: '23505' } }), ctx, gatedFor(ctx), 'manual', push.ports);
  assertEquals(res, { ok: false, reason: 'pick_conflict' });
  assertEquals(push.lookups, []);
});

// ---------------------------------------------------------------------------
// A push failure never fails the pick
// ---------------------------------------------------------------------------

Deno.test('push failures never throw out of the record path; the pick stays recorded', async () => {
  const cases: [Parameters<typeof fakePush>[0], string][] = [
    [{ tokens: TOKENS, lookupThrows: true }, 'error'],
    [{ tokens: TOKENS, lookupFailed: true }, 'lookup_failed'],
    [{ tokens: TOKENS, sendFails: true }, 'send_failed'],
    [{ tokens: TOKENS, sendThrows: true }, 'error'],
    [{ tokens: {} }, 'no_token'],
    [{ tokens: TOKENS, disabled: ['B'] }, 'disabled'],
  ];
  for (const [opts, outcome] of cases) {
    const ctx = ctxWith(['A', 'B', 'C'], 3, 0);
    const admin = fakeAdmin();
    const push = fakePush(opts);
    const res = await commitGatedPick(admin, ctx, gatedFor(ctx), 'manual', push.ports);
    assert(res.ok, outcome);
    assertEquals(res.row.pick_number, 1, outcome);
    assertEquals(res.turnPush, outcome, outcome);
    assert(admin.calls.includes('drafts.insert'), outcome);
  }
});

Deno.test('a disabled-notifications or token-less target is never sent to', async () => {
  const ctx = ctxWith(['A', 'B', 'C'], 3, 0);
  const off = fakePush({ tokens: TOKENS, disabled: ['B'] });
  await commitGatedPick(fakeAdmin(), ctx, gatedFor(ctx), 'manual', off.ports);
  assertEquals(off.sent, []);
});

// ---------------------------------------------------------------------------
// Skips: bots only (a snake turnaround still pushes)
// ---------------------------------------------------------------------------

Deno.test('a bot next picker is skipped without a token lookup', async () => {
  const ctx = ctxWith(['A', 'bot-1', 'C'], 3, 0);
  const push = fakePush({ tokens: TOKENS });
  const res = await commitGatedPick(fakeAdmin(), ctx, gatedFor(ctx), 'manual', push.ports);
  assert(res.ok);
  assertEquals(res.turnPush, 'bot');
  assertEquals(push.lookups, []);
});

Deno.test('snake turnaround: the manager who just picked is pushed for their back-to-back turn (manual AND auto)', async () => {
  // order [A, B]: pick 2 is B's, and pick 3 (round 2 opener) is B's again.
  for (const source of ['manual', 'auto_best'] as const) {
    const push = fakePush({ tokens: TOKENS });
    const ctx = ctxWith(['A', 'B'], 3, 1);
    assertEquals(gatedFor(ctx).pickerId, 'B');
    const res = await commitGatedPick(fakeAdmin(), ctx, gatedFor(ctx), source, push.ports);
    assert(res.ok, source);
    assertEquals(res.turnPush, 'sent', source);
    assertEquals(push.sent.map((s) => s.token), ['tok-B'], source);
  }
});

Deno.test('notifyNextPicker reports draft_complete after the last pick without any I/O', async () => {
  const ctx = ctxWith(['A', 'B'], 2, 4);
  const push = fakePush({ tokens: TOKENS });
  assertEquals(await notifyNextPicker(fakeAdmin(), ctx, { pickNumber: 4, pickerId: 'A' }, 'auto_best', push.ports), 'draft_complete');
  assertEquals(push.lookups, []);
});

// ---------------------------------------------------------------------------
// The auto-pick route (autoPickTurn: bots, expired clocks, the sweep)
// ---------------------------------------------------------------------------

/** In-memory search ports: a deep flex pool of liquid, draftable stocks. */
function marketPorts(): AutoPickPorts {
  const stocks = Array.from({ length: 40 }, (_, i) => ({
    symbol: `M${i}`,
    cachedPrice: 50 + i,
    eligibility: new Set<string>(),
    isDraftable: true,
    marketCap: 10_000 - i,
  }));
  return {
    loadSlots: () => Promise.resolve([] as Slot[]),
    loadQueue: () => Promise.resolve({ queue: [], meta: [] }),
    searchCandidates: (_spec, exclude, _d, limit) => {
      const ex = new Set(exclude.map((x) => x.toUpperCase()));
      return Promise.resolve(
        stocks.filter((s) => !ex.has(s.symbol)).slice(0, limit).map((s) => ({
          symbol: s.symbol,
          lastPrice: s.cachedPrice,
          isDraftable: true,
          marketCap: s.marketCap,
        })),
      );
    },
    eligibility: (symbols) => Promise.resolve(new Map(symbols.map((x) => [x, new Set<string>()]))),
    livePrice: (symbol) => Promise.resolve({ price: stocks.find((s) => s.symbol === symbol)?.cachedPrice ?? null, source: 'trade.p' }),
    screenPrices: (symbols) =>
      Promise.resolve({
        prices: new Map(symbols.flatMap((x) => {
          const p = stocks.find((s) => s.symbol === x)?.cachedPrice;
          return p == null ? [] : [[x, p] as [string, number]];
        })),
        requests: 1,
      }),
    recordLivePrices: () => Promise.resolve(),
    priceAges: () => Promise.resolve(new Map<string, number>()),
    coolingSymbols: () => Promise.resolve(new Set<string>()),
    recordPriceFailure: () => Promise.resolve(),
    clearPriceFailure: () => Promise.resolve(),
    feasibilityPool: (types, exclude, draftableOnly, depth) =>
      Promise.resolve(buildPoolGroups(types, stocks, { exclude, draftableOnly, depth })),
  };
}

Deno.test('an AUTO-pick (expired clock) also pushes the next picker', async () => {
  const ctx = ctxWith(['A', 'B', 'C'], 3, 1); // pick 2 is B's; B's clock ran out
  const admin = fakeAdmin();
  const push = fakePush({ tokens: TOKENS });
  const res = await autoPickTurn(
    admin,
    { alpacaKey: 'k', alpacaSecret: 's', ports: marketPorts(), turnPush: push.ports },
    ctx,
    2,
  );
  assert(res.ok, JSON.stringify(res));
  assertEquals(res.pickSource, 'auto_best');
  assertEquals(res.pick.user_id, 'B');
  assertEquals(res.complete, false);
  assertEquals(push.lookups, ['C']);
  assertEquals(push.sent.map((s) => s.token), ['tok-C']);
  assertEquals(push.sent[0].msg, draftTurnMessage(LEAGUE_NAME, 'L1', 3));
});

Deno.test('an AUTO-pick that ends the draft pushes nobody', async () => {
  const ctx = ctxWith(['A', 'B'], 1, 1); // pick 2 of 2
  const push = fakePush({ tokens: TOKENS });
  const res = await autoPickTurn(
    fakeAdmin(),
    { alpacaKey: 'k', alpacaSecret: 's', ports: marketPorts(), turnPush: push.ports },
    ctx,
    2,
  );
  assert(res.ok, JSON.stringify(res));
  assertEquals(res.complete, true);
  assertEquals(push.lookups, []);
});

Deno.test('an AUTO-pick whose push throws still returns the recorded pick', async () => {
  const ctx = ctxWith(['A', 'B', 'C'], 3, 1);
  const push = fakePush({ tokens: TOKENS, sendThrows: true });
  const res = await autoPickTurn(
    fakeAdmin(),
    { alpacaKey: 'k', alpacaSecret: 's', ports: marketPorts(), turnPush: push.ports },
    ctx,
    2,
  );
  assert(res.ok, JSON.stringify(res));
  assertEquals(res.pick.pick_number, 2);
});

// ---------------------------------------------------------------------------
// The auto-pick SCREEN port (2026-10-13): Alpaca /v2/stocks/snapshots, bisected
// on a 400, abandoned (never thrown) on anything else. fetch is stubbed.
// ---------------------------------------------------------------------------

async function withFetch<T>(handler: (url: string) => Response, fn: (urls: string[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  try {
    return await fn(urls);
  } finally {
    globalThis.fetch = real;
  }
}
const snapshotsOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get('symbols') ?? '').split(',');
const screenPorts = () => supabaseAutoPickPorts({}, 'L', { alpacaKey: 'k', alpacaSecret: 's' });

Deno.test('screen port: one 200 request prices the chunk from latestTrade, then minuteBar; a quote-only symbol is left out', async () => {
  await withFetch((url) =>
    new Response(JSON.stringify(Object.fromEntries(snapshotsOf(url).map((x) => [x,
      x === 'BAR' ? { minuteBar: { c: 12.5 } } : x === 'QUOTE' ? { latestQuote: { bp: 9 } } : { latestTrade: { p: 20 }, minuteBar: { c: 19 } }]))), { status: 200 }), async (urls) => {
    const r = await screenPorts().screenPrices(['aaa', 'BAR', 'QUOTE'], 10);
    assertEquals([...r.prices.entries()].sort(), [['AAA', 20], ['BAR', 12.5]]);
    assertEquals(r.requests, 1);
    assertEquals(urls.length, 1);
    assert(urls[0].startsWith('https://data.alpaca.markets/v2/stocks/snapshots?symbols=AAA,BAR,QUOTE') && urls[0].includes('feed=iex'));
  });
});

Deno.test('screen port: a 400 from one bad symbol is bisected so the good ones still price', async () => {
  await withFetch((url) => {
    const syms = snapshotsOf(url);
    if (syms.includes('BAD')) return new Response('{"message":"invalid symbol: BAD"}', { status: 400 });
    return new Response(JSON.stringify(Object.fromEntries(syms.map((x) => [x, { latestTrade: { p: 5 } }]))), { status: 200 });
  }, async () => {
    const r = await screenPorts().screenPrices(['A', 'B', 'BAD', 'C'], 10);
    assertEquals([...r.prices.keys()].sort(), ['A', 'B', 'C']);
    assert(r.requests > 1 && r.requests <= 10);
  });
});

Deno.test('screen port: a vendor outage (503 / 401 / network) returns NOTHING after one request, never throws, never bisects', async () => {
  for (const status of [503, 401, 429]) {
    await withFetch(() => new Response('down', { status }), async (urls) => {
      const r = await screenPorts().screenPrices(['A', 'B', 'C', 'D'], 10);
      assertEquals([r.prices.size, r.requests, urls.length, r.unavailable], [0, 1, 1, true], `status ${status}`);
    });
  }
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error('ECONNRESET'))) as typeof fetch;
  try {
    const r = await screenPorts().screenPrices(['A'], 10);
    assertEquals([r.prices.size, r.requests], [0, 1]);
  } finally {
    globalThis.fetch = real;
  }
});

Deno.test('screen port: the request bound holds even when every symbol 400s', async () => {
  await withFetch(() => new Response('bad', { status: 400 }), async (urls) => {
    const syms = Array.from({ length: 100 }, (_, i) => `S${i}`);
    const r = await screenPorts().screenPrices(syms, 4);
    assertEquals(r.prices.size, 0);
    assert(urls.length <= 4, `requests=${urls.length}`);
  });
});

// M3: every Alpaca request carries a timeout, and a failed fill request is an
// outage (price null), never an exception out of the auto-pick.
Deno.test('Alpaca requests carry an abort timeout (screen and fill)', async () => {
  const real = globalThis.fetch;
  const signals: unknown[] = [];
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    signals.push(init?.signal);
    return Promise.resolve(new Response(JSON.stringify({ trade: { p: 10 }, A: { latestTrade: { p: 10 } } }), { status: 200 }));
  }) as typeof fetch;
  try {
    await screenPorts().screenPrices(['A'], 10);
    await screenPorts().livePrice('A');
  } finally {
    globalThis.fetch = real;
  }
  assertEquals(signals.length, 2);
  assert(signals.every((x) => x instanceof AbortSignal), 'every request has an AbortSignal');
});

Deno.test('livePrice port: a network error or timeout is price null (an outage), never a throw', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new DOMException('timed out', 'TimeoutError'))) as typeof fetch;
  try {
    assertEquals(await screenPorts().livePrice('A'), { price: null, source: null });
  } finally {
    globalThis.fetch = real;
  }
});

// ---------------------------------------------------------------------------
// H1 (review, 2026-10-13): a BOUNDED search is recorded, cooled and escalated
// ---------------------------------------------------------------------------

/** A supabase-js fake that KEEPS draft_stalls rows (keyed league:pick), so the
 * bounded-search record, its cooldown and its escalation are exercised end to
 * end through autoPickTurn. It emulates public.note_draft_bounded (the PGlite
 * test proves the SQL), filtered updates (.eq / .gte, returning the rows they
 * changed when .select()ed), and a commissioner push token. */
// deno-lint-ignore no-explicit-any
function stallsAdmin(): any {
  // deno-lint-ignore no-explicit-any
  const stalls = new Map<string, any>();
  const key = (lg: unknown, pn: unknown) => `${lg}:${pn}`;
  const from = (table: string) => {
    let op = 'select';
    let selected = false;
    // deno-lint-ignore no-explicit-any
    let payload: any = null;
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const eqs: Record<string, unknown> = {};
    // deno-lint-ignore no-explicit-any
    const b: any = {
      select: () => { selected = true; return b; },
      insert(r: unknown) { op = 'insert'; payload = r; return b; },
      update(r: unknown) { op = 'update'; payload = r; return b; },
      delete() { op = 'delete'; return b; },
      eq(k: string, v: unknown) { eqs[k] = v; filters.push((r) => r[k] === v); return b; },
      gte(k: string, v: number) { filters.push((r) => Number(r[k]) >= v); return b; },
      in: () => b, order: () => b, single: () => b, maybeSingle: () => b,
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        // deno-lint-ignore no-explicit-any
        let out: any = { data: null, error: null };
        if (table === 'push_tokens') out = { data: { token: 'tok-commish' }, error: null };
        if (table === 'draft_stalls') {
          const k = key(eqs.league_id, eqs.pick_number);
          const row = stalls.get(k);
          const match = row && filters.every((f) => f(row));
          if (op === 'insert') {
            if (stalls.has(key(payload.league_id, payload.pick_number))) out = { data: null, error: { code: '23505' } };
            else stalls.set(key(payload.league_id, payload.pick_number), { attempts: 0, ...payload, last_seen_at: new Date().toISOString() });
          } else if (op === 'update') {
            if (match) stalls.set(k, { ...row, ...payload });
            out = { data: selected ? (match ? [stalls.get(k)] : []) : null, error: null };
          } else if (op === 'delete') stalls.delete(k);
          else out = { data: row ?? null, error: null };
        }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return b;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    if (name !== 'note_draft_bounded') return Promise.resolve({ data: null, error: null });
    const k = key(args.p_league_id, args.p_pick_number);
    const prior = stalls.get(k);
    const bounded = prior && prior.reason === 'search_bounded';
    const next = {
      league_id: args.p_league_id,
      pick_number: args.p_pick_number,
      picker_id: args.p_picker_id,
      reason: 'search_bounded',
      attempts: bounded ? prior.attempts + 1 : 1,
      last_seen_at: new Date().toISOString(),
    };
    stalls.set(k, next);
    return Promise.resolve({ data: [{ attempts: next.attempts, reason: next.reason }], error: null });
  };
  return { stalls, from, rpc };
}

/** Expo stubbed: `ok` decides whether each push is accepted; `sent` counts them. */
async function withExpo<T>(ok: () => boolean, fn: (sent: { n: number; bodies: unknown[] }) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const sent = { n: 0, bodies: [] as unknown[] };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://exp.host/')) return Promise.reject(new Error(`unexpected fetch ${url}`));
    sent.n++;
    sent.bodies.push(JSON.parse(String(init?.body ?? '{}')));
    return Promise.resolve(new Response(JSON.stringify({ data: { status: ok() ? 'ok' : 'error', details: { error: 'X' } } }), { status: 200 }));
  }) as typeof fetch;
  try {
    return await fn(sent);
  } finally {
    globalThis.fetch = real;
  }
}

/** Ports whose every candidate passes on its cached price and is refused live,
 * more of them than one call may price: every search ends on the fill bound. */
function boundedPorts(): AutoPickPorts & { fills: number } {
  const stocks = Array.from({ length: 60 }, (_, i) => ({ symbol: `B${i}`, cachedPrice: 50, eligibility: new Set<string>(), isDraftable: true, marketCap: 1000 - i }));
  const p = {
    fills: 0,
    loadSlots: () => Promise.resolve([] as Slot[]),
    loadQueue: () => Promise.resolve({ queue: [], meta: [] }),
    searchCandidates: (_spec: unknown, exclude: string[], _d: boolean, limit: number) =>
      Promise.resolve(stocks.filter((s) => !exclude.includes(s.symbol)).slice(0, limit).map((s) => ({ symbol: s.symbol, lastPrice: 50, isDraftable: true, marketCap: s.marketCap }))),
    eligibility: (symbols: string[]) => Promise.resolve(new Map(symbols.map((x) => [x, new Set<string>()]))),
    livePrice: () => {
      p.fills++;
      return Promise.resolve({ price: 1e9, source: 'quote.bp' }); // refused live, never written back
    },
    screenPrices: () => Promise.resolve({ prices: new Map<string, number>(), requests: 1 }),
    recordLivePrices: () => Promise.resolve(),
    priceAges: () => Promise.resolve(new Map<string, number>()),
    coolingSymbols: () => Promise.resolve(new Set<string>()),
    recordPriceFailure: () => Promise.resolve(),
    clearPriceFailure: () => Promise.resolve(),
    feasibilityPool: (types: Slot[], exclude: string[], draftableOnly: boolean, depth: number) =>
      Promise.resolve(buildPoolGroups(types, stocks, { exclude, draftableOnly, depth })),
  };
  return p as AutoPickPorts & { fills: number };
}

const boundedCtx = () => {
  const base = ctxWith(['A', 'B', 'C'], 3, 1); // pick 2 is B's; A is the commissioner
  // A budget league, so the $1e9 live price is refused (a no-budget flex league takes anything).
  return { ...base, league: { ...base.league, stake_mode: 'budget_cap', budget_amount: 1000 } } as DraftContext;
};
// deno-lint-ignore no-explicit-any
const ageRow = (admin: any) =>
  admin.stalls.set('L1:2', { ...admin.stalls.get('L1:2'), last_seen_at: new Date(Date.now() - STALL_COOLDOWN_MS - 1).toISOString() });

// NO commissioner push for a slow or stuck auto-pick (Giorgio, 2026-10-13: "Drop
// the wrong 'pick manually' notification and don't add a new one. The
// commissioner can't do anything about it anyway."). The draft_stalls row is the
// operator's signal: attempts climbing, last_seen_at moving.
// Mutations: autoPickTurn not calling noteBounded -> no row, no cooldown;
// boundedReportsStalled always false -> never 'stalled'; a push re-added -> red.
Deno.test('H1: a bounded search is recorded (attempts climbing, last_seen_at moving), cooled, reported stalled from BOUNDED_STALL_AFTER, and pushes NOBODY', async () => {
  const ctx = boundedCtx();
  const admin = stallsAdmin();
  const ports = boundedPorts();
  const deps = { alpacaKey: 'k', alpacaSecret: 's', ports };
  await withExpo(() => true, async (sent) => {
    const r1 = await autoPickTurn(admin, deps, ctx, 2);
    assertEquals(r1, { ok: false, reason: 'price_unavailable' });
    const row = admin.stalls.get('L1:2');
    assertEquals([row?.reason, row?.attempts], ['search_bounded', 1]);
    const fillsAfterFirst = ports.fills;
    assert(fillsAfterFirst > 0);

    // Inside the cooldown: answered without searching, and NOT reported as a stall.
    assertEquals(await autoPickTurn(admin, deps, ctx, 2), { ok: false, reason: 'price_unavailable' });
    assertEquals(ports.fills, fillsAfterFirst, 'the cooldown must not search again');

    const reasons: string[] = [];
    for (let i = 2; i <= BOUNDED_STALL_AFTER + 1; i++) {
      ageRow(admin);
      const aged = Date.parse(admin.stalls.get('L1:2').last_seen_at);
      const r = await autoPickTurn(admin, deps, ctx, 2);
      reasons.push(r.ok ? 'pick' : r.reason);
      assertEquals(admin.stalls.get('L1:2').attempts, i, 'attempts climb by one per bounded search');
      assert(Date.parse(admin.stalls.get('L1:2').last_seen_at) > aged, 'last_seen_at moves');
    }
    assertEquals(reasons.slice(0, BOUNDED_STALL_AFTER - 2), Array(BOUNDED_STALL_AFTER - 2).fill('price_unavailable'));
    assertEquals(reasons.slice(BOUNDED_STALL_AFTER - 2), ['stalled', 'stalled']);
    assertEquals(admin.stalls.get('L1:2').reason, 'search_bounded');
    // Stalled and inside the cooldown: stalled, no search.
    const f = ports.fills;
    assertEquals(await autoPickTurn(admin, deps, ctx, 2), { ok: false, reason: 'stalled' });
    assertEquals(ports.fills, f);
    assertEquals(sent.n, 0, 'no commissioner push for a bounded turn');
  });
});

// Mutation: recordStall pushing again (first stall or repeat) -> red.
Deno.test('a nothing_legal stall writes and refreshes its draft_stalls row, and pushes NOBODY', async () => {
  const ctx = boundedCtx();
  const admin = stallsAdmin();
  await withExpo(() => true, async (sent) => {
    await recordStall(admin, ctx, 2, 'B', 'nothing_legal', 3);
    assertEquals([admin.stalls.get('L1:2')?.reason, admin.stalls.get('L1:2')?.attempts], ['nothing_legal', 3]);
    ageRow(admin);
    const aged = Date.parse(admin.stalls.get('L1:2').last_seen_at);
    await recordStall(admin, ctx, 2, 'B', 'nothing_legal', 5);
    assertEquals(admin.stalls.get('L1:2').attempts, 5);
    assert(Date.parse(admin.stalls.get('L1:2').last_seen_at) > aged);
    // A bounded row overwritten by a legality stall: still no push.
    admin.stalls.set('L1:3', { league_id: 'L1', pick_number: 3, picker_id: 'C', reason: 'search_bounded', attempts: 4, last_seen_at: new Date().toISOString() });
    await recordStall(admin, ctx, 3, 'C', 'nothing_legal', 1);
    assertEquals(admin.stalls.get('L1:3').reason, 'nothing_legal');
    assertEquals(sent.n, 0);
  });
});

// The vendor_outage push stays EXACTLY as shipped, once per turn after
// OUTAGE_ESCALATE_MS. Mutation: any change to its strings -> red.
Deno.test('the vendor_outage push is unchanged: the shipped words, once, after the outage lasted OUTAGE_ESCALATE_MS', async () => {
  const ctx = boundedCtx();
  const old = new Date(Date.now() - OUTAGE_ESCALATE_MS - 1000).toISOString();
  // deno-lint-ignore no-explicit-any
  const outages = new Map<string, any>([['L1:2', { first_seen_at: old, escalated_at: null }]]);
  const base = stallsAdmin();
  const admin = {
    ...base,
    from: (table: string) => {
      if (table !== 'draft_turn_outages') return base.from(table);
      // deno-lint-ignore no-explicit-any
      const b: any = {
        insert: () => ({ then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '23505' } }).then(r) }),
        update: (patch: Record<string, unknown>) => {
          const row = outages.get('L1:2');
          if ('escalated_at' in patch) outages.set('L1:2', { ...row, ...patch });
          // deno-lint-ignore no-explicit-any
          const chain: any = { eq: () => chain, select: () => chain, maybeSingle: () => chain, then: (r: (v: unknown) => unknown) => Promise.resolve({ data: outages.get('L1:2'), error: null }).then(r) };
          return chain;
        },
      };
      return b;
    },
  };
  await withExpo(() => true, async (sent) => {
    await noteOutage(admin, ctx, 2, 'B');
    await noteOutage(admin, ctx, 2, 'B'); // escalated: not again
    assertEquals(sent.n, 1);
    assertEquals(sent.bodies[0], {
      to: 'tok-commish',
      sound: 'default',
      title: 'Auto-pick is waiting on prices',
      body: 'Live prices are unavailable for pick 2. The turn stays open and retries.',
      data: { type: 'draft_outage', league_id: 'L1', pick_number: 2 },
    });
  });
  assertEquals(draftOutageMessage('L1', 14).body, 'Live prices are unavailable for pick 14. The turn stays open and retries.');
  assertEquals(DRAFT_OUTAGE_PUSH.title, 'Auto-pick is waiting on prices');
});

Deno.test('boundedReportsStalled: from BOUNDED_STALL_AFTER consecutive bounded searches', () => {
  assertEquals([boundedReportsStalled(1), boundedReportsStalled(BOUNDED_STALL_AFTER - 1), boundedReportsStalled(BOUNDED_STALL_AFTER), boundedReportsStalled(99)], [false, false, true, true]);
});

// The false "Pick manually" copy is gone from every edge function (his ruling).
Deno.test('no edge function carries the dropped "Pick manually" stall copy', async () => {
  const hits: string[] = [];
  const walk = async (dir: URL, rel: string) => {
    for await (const e of Deno.readDir(dir)) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory) await walk(new URL(`${e.name}/`, dir), childRel);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && /Pick manually/.test(await Deno.readTextFile(new URL(e.name, dir)))) hits.push(childRel);
    }
  };
  await walk(new URL('../', import.meta.url), '');
  assertEquals(hits, []);
});

// The real write-back / age ports (H1): one RPC per batch; the age read fails soft.
Deno.test('real ports: recordLivePrices is ONE record_live_prices call with matched arrays; an RPC error never throws', async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const admin = { rpc: (name: string, args: unknown) => (calls.push({ name, args }), Promise.resolve({ data: 2, error: null })) };
  const ports = supabaseAutoPickPorts(admin, 'L', { alpacaKey: 'k', alpacaSecret: 's' });
  await ports.recordLivePrices(new Map([['aapl', 201.5], ['MSFT', 401]]));
  assertEquals(calls, [{ name: 'record_live_prices', args: { p_symbols: ['AAPL', 'MSFT'], p_prices: [201.5, 401] } }]);
  await ports.recordLivePrices(new Map()); // nothing to write: no call
  assertEquals(calls.length, 1);
  const failing = supabaseAutoPickPorts({ rpc: () => Promise.resolve({ data: null, error: { code: '42883' } }) }, 'L', { alpacaKey: 'k', alpacaSecret: 's' });
  await failing.recordLivePrices(new Map([['A', 1]])); // resolves: best effort
});

Deno.test('real ports: priceAges reads last_price_at in chunks; a failed read is "all stale", never a throw', async () => {
  const lists: string[][] = [];
  const ok = {
    from: () => ({
      select: () => ({
        in: (_c: string, syms: string[]) => {
          lists.push(syms);
          return Promise.resolve({ data: syms.map((s) => ({ symbol: s, last_price_at: s === 'S1' ? '2026-10-13T12:00:00Z' : null })), error: null });
        },
      }),
    }),
  };
  const syms = Array.from({ length: 450 }, (_, i) => `S${i}`);
  const ages = await supabaseAutoPickPorts(ok, 'L', { alpacaKey: 'k', alpacaSecret: 's' }).priceAges(syms);
  assertEquals(lists.map((x) => x.length), [200, 200, 50]);
  assertEquals([...ages.entries()], [['S1', Date.parse('2026-10-13T12:00:00Z')]]);
  const bad = { from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { code: '42703', message: 'column does not exist' } }) }) }) };
  assertEquals((await supabaseAutoPickPorts(bad, 'L', { alpacaKey: 'k', alpacaSecret: 's' }).priceAges(['A'])).size, 0);
});

// L5 (review): a stage that times out (or fails on the network) is that STAGE
// failing; the chain moves on, and if every stage fails the price is null, never a
// throw. Mutation: alpacaGet without the per-stage catch -> rejects.
Deno.test('fetchFillPrice: a timed-out stage falls through to the next; all failing -> price null, no throw', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/trades/latest')) return Promise.reject(new DOMException('timed out', 'TimeoutError'));
      return Promise.resolve(new Response(JSON.stringify({ bar: { c: 12.5 } }), { status: 200 }));
    }) as typeof fetch;
    assertEquals(await fetchFillPrice('A', 'k', 's'), { price: 12.5, source: 'bar.c' });
    globalThis.fetch = (() => Promise.reject(new DOMException('timed out', 'TimeoutError'))) as typeof fetch;
    const none = await fetchFillPrice('A', 'k', 's');
    assertEquals([none.price, none.error?.status], [null, 0]);
  } finally {
    globalThis.fetch = real;
  }
});
