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
  type TurnPushPorts,
} from './draft-write.ts';
import type { AutoPickPorts } from './auto-pick.ts';
import type { GatedPick } from './pick-gate.ts';
import type { PushMessage } from './push.ts';
import { draftTurnMessage } from './push-copy.ts';
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
  assertEquals(push.sent[0].msg, draftTurnMessage(LEAGUE_NAME));
  assertEquals(push.sent[0].msg, {
    title: "It's Your Turn! 🏈",
    body: 'Time to make your pick in Moon League',
    data: { type: 'draft_turn', screen: 'draft' },
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
    recordLivePrice: () => Promise.resolve(),
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
  assertEquals(push.sent[0].msg, draftTurnMessage(LEAGUE_NAME));
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
