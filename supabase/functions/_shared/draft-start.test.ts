/**
 * Hermetic tests for draft-start.ts (startDraftIfDue, watchLeague) over a fake
 * supabase client (no DB, no network):
 *   deno test supabase/functions/_shared/draft-start.test.ts
 *
 * The SQL side (locks, the gate, postponement, the CAS, the notices, and that
 * the expectation built here equals _draft_start_inputs) runs on real Postgres
 * in supabase/tests/draft_auto_start.pglite.test.ts.
 *
 * Also: the first picker's "It's your turn" push after a COMMITTED start
 * (notifyFirstPicker, Giorgio 2026-10-11), with the push I/O injected.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { buildStartExpect, startDraftIfDue, watchLeague } from './draft-start.ts';
import type { TurnPushOutcome, TurnPushPorts } from './draft-write.ts';
import type { PushMessage } from './push.ts';
import { draftTurnMessage } from './push-copy.ts';
import { GATE_LEAD_SECONDS, ROOM_OPEN_LEAD_SECONDS, START_RETRY_SECONDS } from './draft-start-policy.ts';

const L = '00000000-0000-4000-8000-000000000001';
const SLOT_A = 'aaaaaaaa-0000-4000-8000-000000000000';
const SLOT_B = 'bbbbbbbb-0000-4000-8000-000000000000';
const T = '2026-11-10T17:00:00Z';
const at = (s: number) => new Date(new Date(T).getTime() + s * 1000);

interface World {
  league: Record<string, unknown> | null;
  members: string[];
  slots: Array<Record<string, unknown>> | 'error';
  pool: 'error' | Array<{ ordinals: number[]; n: number; prices: number[] }>;
  reconfirm?: Record<string, unknown> | null | 'error';
  postponed?: boolean;
  // Run it back: pending renewal replies. undefined/0 = none (every test here
  // is an ordinary league unless it says otherwise).
  renewalPending?: number | 'error';
  // The stored draft order (league_draft_order), read after the start for the
  // first-pick push. undefined = the members in member order; 'error' = the read fails.
  order?: string[] | 'error';
  rpc: Record<string, unknown>; // name -> data (or { __error })
}

function world(o: Partial<World> = {}): World {
  return {
    league: {
      id: L, name: 'Moon League', commissioner_id: 'c', draft_status: 'not_started', stake_mode: 'price_tiers', draft_date: T,
      num_participants: 8, league_type: 'matchup', playoff_teams: 4, num_rounds: 6, budget_amount: null,
      allow_undraftable: false,
    },
    members: ['c', 'm1', 'm2', 'm3'],
    // Deliberately out of slot_index order: the expectation must sort.
    slots: [
      { id: SLOT_B, slot_index: 1, slot_count: 3, price_min: 50.5, price_max: null, category_id: null },
      { id: SLOT_A, slot_index: 0, slot_count: 3, price_min: null, price_max: 50.5, category_id: null },
    ],
    pool: [{ ordinals: [0], n: 100, prices: [] }, { ordinals: [1], n: 100, prices: [] }],
    rpc: {
      start_league_draft: { status: 'started' },
      postpone_league_draft: { status: 'postponed' },
      record_draft_watch: { status: 'recorded', blocked: false, notified: null, gate_cleared: false },
    },
    ...o,
  };
}

/** Just enough of supabase-js for draft-start.ts + draft-write.ts's loadSlots/poolGroups. */
function fakeAdmin(w: World) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const res = (data: unknown, error: unknown = null) => Promise.resolve({ data, error });
  return {
    rpcs,
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => {
          if (table === 'league_draft_slots') return w.slots === 'error' ? res(null, { message: 'boom' }) : res(w.slots);
          // loadDraftContext (the first-pick push, after the start):
          if (table === 'league_draft_order') {
            if (w.order === 'error') return res(null, { message: 'boom' });
            return res((w.order ?? w.members).map((user_id, i) => ({ position: i + 1, user_id })));
          }
          if (table === 'drafts') return res([]);
          throw new Error(`unexpected order on ${table}`);
        },
        maybeSingle: () => {
          if (table === 'leagues') return res(w.league);
          if (table === 'league_roster_reconfirm') return w.reconfirm === 'error' ? res(null, { message: 'boom' }) : res(w.reconfirm ?? null);
          if (table === 'draft_postponements') return res(w.postponed ? { league_id: L } : null);
          throw new Error(`unexpected maybeSingle on ${table}`);
        },
        then: (ok: (v: unknown) => unknown) => {
          if (table === 'league_members') return res(w.members.map((user_id) => ({ user_id }))).then(ok);
          if (table === 'trades') return res([]).then(ok);
          if (table === 'league_renewal_responses') {
            return (w.renewalPending === 'error'
              ? Promise.resolve({ data: null, error: { message: 'boom' }, count: null })
              : Promise.resolve({ data: null, error: null, count: w.renewalPending ?? 0 })
            ).then(ok);
          }
          throw new Error(`unexpected await on ${table}`);
        },
      };
      return chain;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      if (name === 'draft_feasibility_pool') return w.pool === 'error' ? res(null, { message: 'pool down' }) : res(w.pool);
      if (name in w.rpc) {
        const v = w.rpc[name] as Record<string, unknown> | null;
        // A committed start flips the row, as the real function does (the
        // post-start context read then sees in_progress and checks the order).
        if (name === 'start_league_draft' && v?.status === 'started' && w.league) w.league.draft_status = 'in_progress';
        return v && '__error' in v ? res(null, v.__error) : res(v);
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}
const names = (a: ReturnType<typeof fakeAdmin>) => a.rpcs.map((r) => r.name);
const call = (a: ReturnType<typeof fakeAdmin>, n: string) => a.rpcs.find((r) => r.name === n)!.args;

/** Injected push I/O for the first-pick push. Every member has a token unless listed. */
function fakePush(o: {
  noToken?: string[];
  disabled?: string[];
  lookupFailed?: boolean;
  lookupThrows?: boolean;
  sendFails?: boolean;
  sendThrows?: boolean;
} = {}) {
  const lookups: string[] = [];
  const sent: Array<{ token: string; msg: PushMessage }> = [];
  const ports: TurnPushPorts = {
    getTargetToken: (_admin, userId) => {
      lookups.push(userId);
      if (o.lookupThrows) return Promise.reject(new Error('boom'));
      if (o.lookupFailed) return Promise.resolve({ token: null, enabled: false, lookupFailed: true });
      return Promise.resolve({
        token: (o.noToken ?? []).includes(userId) ? null : `tok-${userId}`,
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

// ---- START ----------------------------------------------------------------

Deno.test('start: evaluates, then flips through start_league_draft with the exact expectation', async () => {
  const a = fakeAdmin(world());
  assertEquals(await startDraftIfDue(a, L, at(5), fakePush().ports), { outcome: 'started', turnPush: 'sent' });
  assertEquals(names(a), ['draft_feasibility_pool', 'start_league_draft']);
  assertEquals(call(a, 'start_league_draft').p_expect, {
    members: 4, stake_mode: 'price_tiers', budget_amount: null, num_rounds: 6, allow_undraftable: false,
    league_type: 'matchup', playoff_teams: 4, reconfirm_owed: false,
    slots: [
      { id: SLOT_A, slot_index: 0, slot_count: 3, price_min: null, price_max: 50.5, category_id: null },
      { id: SLOT_B, slot_index: 1, slot_count: 3, price_min: 50.5, price_max: null, category_id: null },
    ],
  });
});

Deno.test('start: never before T, never a TBD date, never a postponed league (no write)', async () => {
  for (const [draft_date, outcome] of [[null, 'not_due'], ['2026-11-10T17:15:00Z', 'not_due']] as const) {
    const w = world();
    w.league!.draft_date = draft_date;
    const a = fakeAdmin(w);
    assertEquals((await startDraftIfDue(a, L, at(5))).outcome, outcome);
    assertEquals(names(a), []);
  }
  const p = fakeAdmin(world({ postponed: true }));
  assertEquals((await startDraftIfDue(p, L, at(5))).outcome, 'already_postponed');
  assertEquals(names(p), []);
});

Deno.test('start: blocked at T -> POSTPONED at once (stage start), never a late start', async () => {
  const a = fakeAdmin(world({ members: ['c', 'm1', 'm2'] }));
  const r = await startDraftIfDue(a, L, at(5));
  assert(r.outcome === 'postponed' && r.reason === 'not_enough_members', JSON.stringify(r));
  assertEquals(names(a), ['postpone_league_draft']);
  assertEquals([call(a, 'postpone_league_draft').p_stage, call(a, 'postpone_league_draft').p_draft_date], ['start', T]);
  // #126: a pending roster confirmation postpones too (read into the evaluation).
  const rc = fakeAdmin(world({ reconfirm: { departed: [{ user_id: 'u', name: 'Sofia F.' }], members_before: 5, choice: 'pending' } }));
  const r2 = await startDraftIfDue(rc, L, at(5));
  assert(r2.outcome === 'postponed' && r2.reason === 'roster_reconfirm_required');
});

Deno.test('start: the room never opened -> postponed (room_did_not_open); a gate under the lock -> postponed', async () => {
  const a = fakeAdmin(world({ rpc: { ...world().rpc, start_league_draft: { status: 'room_not_open' } } }));
  const r = await startDraftIfDue(a, L, at(5));
  assert(r.outcome === 'postponed' && r.reason === 'room_did_not_open');
  const g = fakeAdmin(world({ rpc: { ...world().rpc, start_league_draft: { status: 'blocked', reason: 'renewal_replies_pending' } } }));
  const r2 = await startDraftIfDue(g, L, at(5));
  assert(r2.outcome === 'postponed' && r2.reason === 'renewal_replies_pending');
});

Deno.test('start: a SYSTEM failure retries until T+5min, then postpones (start_failed)', async () => {
  for (const w of [
    world({ pool: 'error' }),
    world({ rpc: { ...world().rpc, start_league_draft: { status: 'changed', actual: {} } } }),
    world({ rpc: { ...world().rpc, start_league_draft: { __error: { message: 'x' } } } }),
  ]) {
    const early = fakeAdmin(w);
    assertEquals((await startDraftIfDue(early, L, at(START_RETRY_SECONDS - 1))).outcome, 'retry');
    assert(!names(early).includes('postpone_league_draft'));
    const late = fakeAdmin(w);
    const r = await startDraftIfDue(late, L, at(START_RETRY_SECONDS));
    assert(r.outcome === 'postponed' && r.reason === 'start_failed', JSON.stringify(r));
  }
});

Deno.test('start: a failed read is an error, never a guess (reconfirm fails CLOSED)', async () => {
  const a = fakeAdmin(world({ reconfirm: 'error' }));
  assertEquals(await startDraftIfDue(a, L, at(5)), { outcome: 'error', reason: 'reconfirm_read_failed' });
  assertEquals(names(a), []);
});

Deno.test('start: already started / completed: no write', async () => {
  const w = world();
  w.league!.draft_status = 'in_progress';
  assertEquals(await startDraftIfDue(fakeAdmin(w), L, at(5)), { outcome: 'already_started' });
  w.league!.draft_status = 'completed';
  assertEquals(await startDraftIfDue(fakeAdmin(w), L, at(5)), { outcome: 'not_startable', draftStatus: 'completed' });
});

// ---- START -> the first picker's turn push (Giorgio, 2026-10-11) ------------

Deno.test('start: the FIRST picker (by the stored order, not member order) is pushed the draft_turn copy, once', async () => {
  const a = fakeAdmin(world({ order: ['m2', 'c', 'm1', 'm3'] }));
  const push = fakePush();
  assertEquals(await startDraftIfDue(a, L, at(5), push.ports), { outcome: 'started', turnPush: 'sent' });
  assertEquals(push.lookups, ['m2']);
  assertEquals(push.sent, [{ token: 'tok-m2', msg: draftTurnMessage('Moon League', L, 1) }]);
});

Deno.test('start: a BOT first picker is skipped without a token lookup; the start stands', async () => {
  const push = fakePush();
  const w = world({ members: ['bot-1', 'c', 'm1', 'm2'] });
  assertEquals(await startDraftIfDue(fakeAdmin(w), L, at(5), push.ports), { outcome: 'started', turnPush: 'bot' });
  assertEquals([push.lookups, push.sent], [[], []]);
});

Deno.test('start: notifications off / no token / lookup failed -> skipped, never sent; the start stands', async () => {
  const cases: Array<[Parameters<typeof fakePush>[0], TurnPushOutcome]> = [
    [{ disabled: ['c'] }, 'disabled'],
    [{ noToken: ['c'] }, 'no_token'],
    [{ lookupFailed: true }, 'lookup_failed'],
  ];
  for (const [o, turnPush] of cases) {
    const push = fakePush(o);
    assertEquals(await startDraftIfDue(fakeAdmin(world()), L, at(5), push.ports), { outcome: 'started', turnPush });
    assertEquals(push.sent, []);
  }
});

Deno.test('start: a push that throws or is refused never turns a committed start into an error', async () => {
  const cases: Array<[Parameters<typeof fakePush>[0], TurnPushOutcome]> = [
    [{ lookupThrows: true }, 'error'],
    [{ sendThrows: true }, 'error'],
    [{ sendFails: true }, 'send_failed'],
  ];
  for (const [o, turnPush] of cases) {
    const a = fakeAdmin(world());
    assertEquals(await startDraftIfDue(a, L, at(5), fakePush(o).ports), { outcome: 'started', turnPush });
    assertEquals(names(a), ['draft_feasibility_pool', 'start_league_draft']); // no retry, no postpone
  }
});

Deno.test('start: the post-start context read fails (or the order is invalid) -> context_failed, nobody pushed, start stands', async () => {
  for (const order of ['error', ['c', 'm1', 'm2']] as const) {
    const push = fakePush();
    const r = await startDraftIfDue(fakeAdmin(world({ order: order as string[] | 'error' })), L, at(5), push.ports);
    assertEquals(r, { outcome: 'started', turnPush: 'context_failed' });
    assertEquals([push.lookups, push.sent], [[], []]);
  }
});

Deno.test('start: a refused, failed, postponed or already-started start pushes NOBODY', async () => {
  const rpc = world().rpc;
  const cases: Array<[World, Date]> = [
    [world({ members: ['c', 'm1', 'm2'] }), at(5)], // blocked -> postponed
    [world({ rpc: { ...rpc, start_league_draft: { status: 'room_not_open' } } }), at(5)],
    [world({ rpc: { ...rpc, start_league_draft: { status: 'blocked', reason: 'renewal_replies_pending' } } }), at(5)],
    [world({ rpc: { ...rpc, start_league_draft: { status: 'changed', actual: {} } } }), at(5)], // retry
    [world({ rpc: { ...rpc, start_league_draft: { __error: { message: 'x' } } } }), at(5)], // retry
    [world({ rpc: { ...rpc, start_league_draft: { __error: { message: 'x' } } } }), at(START_RETRY_SECONDS)], // start_failed
    // The race loser: another caller's start committed first, and that caller pushed.
    [world({ rpc: { ...rpc, start_league_draft: { status: 'already_started', draft_status: 'in_progress' } } }), at(5)],
    [world({ rpc: { ...rpc, start_league_draft: { status: 'postponed' } } }), at(5)],
    [world({ rpc: { ...rpc, start_league_draft: { status: 'not_due' } } }), at(5)],
    [world({ postponed: true }), at(5)],
    [world(), at(-5)], // before T
    [world({ reconfirm: 'error' }), at(5)], // a failed read
  ];
  for (const [w, now] of cases) {
    const push = fakePush();
    const r = await startDraftIfDue(fakeAdmin(w), L, now, push.ports);
    assert(r.outcome !== 'started', JSON.stringify(r));
    assertEquals([push.lookups, push.sent], [[], []], JSON.stringify(r));
  }
  // Already in progress on read: no rpc, no push.
  const w = world();
  w.league!.draft_status = 'in_progress';
  const push = fakePush();
  assertEquals(await startDraftIfDue(fakeAdmin(w), L, at(5), push.ports), { outcome: 'already_started' });
  assertEquals(push.lookups, []);
});

// ---- WATCH + GATE -----------------------------------------------------------

const BEFORE = at(-3 * 3600); // 3 h out: before the reminder and the gate
const IN_GATE_BEFORE_ROOM = at(-(ROOM_OPEN_LEAD_SECONDS + GATE_LEAD_SECONDS) + 5);
const IN_GATE_ROOM_TIME = at(-ROOM_OPEN_LEAD_SECONDS + 5);

Deno.test('watch: a clear league is recorded clear (not in the gate)', async () => {
  const a = fakeAdmin(world());
  const r = await watchLeague(a, L, BEFORE);
  assertEquals(r.outcome, 'recorded');
  const args = call(a, 'record_draft_watch');
  assertEquals([args.p_blocked, args.p_gate, args.p_draft_date], [false, false, T]);
  assertEquals((args.p_expect as Record<string, unknown>).members, 4);
});

Deno.test('watch: a blocked league is recorded blocked (SQL warns the commissioner), never postponed before the gate', async () => {
  const a = fakeAdmin(world({ members: ['c', 'm1', 'm2'] }));
  await watchLeague(a, L, BEFORE);
  assertEquals(names(a), ['record_draft_watch']);
  const args = call(a, 'record_draft_watch');
  assertEquals(args.p_blocked, true);
  assertEquals((args.p_blockers as Array<{ code: string }>).map((b) => b.code), ['not_enough_members']);
});

Deno.test('gate: blocked in the gate window -> POSTPONED (stage room_open); clear -> gate cleared', async () => {
  const a = fakeAdmin(world({ members: ['c', 'm1', 'm2'] }));
  const r = await watchLeague(a, L, IN_GATE_BEFORE_ROOM);
  assertEquals(r, { outcome: 'postponed', reason: 'not_enough_members' });
  assertEquals(call(a, 'postpone_league_draft').p_stage, 'room_open');
  const c = fakeAdmin(world());
  await watchLeague(c, L, IN_GATE_BEFORE_ROOM);
  assertEquals([call(c, 'record_draft_watch').p_blocked, call(c, 'record_draft_watch').p_gate], [false, true]);
});

Deno.test('fewer than 4 teams: postponed at the room-open gate, never left to T (2026-10-14: no joins once the room opens)', async () => {
  // Giorgio, 2026-10-14: "once the draft room opens (an hour before) the league is
  // considered started. no one can join and the share link cannot work". A league
  // short of managers when its room would open must not sit in a room nobody can
  // join: it is postponed then (draft_date cleared, so the code works again).
  const short = { members: ['c', 'm1', 'm2'] };
  const gateOpen = -(ROOM_OPEN_LEAD_SECONDS + GATE_LEAD_SECONDS);
  // A second before the gate: recorded blocked (the commissioner is warned), not postponed.
  const early = fakeAdmin(world(short));
  assertEquals((await watchLeague(early, L, at(gateOpen - 1))).outcome, 'recorded');
  assertEquals(names(early).includes('postpone_league_draft'), false);
  assertEquals(call(early, 'record_draft_watch').p_blocked, true);
  // The gate's first instant, the room's first instant and mid-room (a late tick):
  // postponed at stage room_open each time, never deferred to the start pass.
  for (const s of [gateOpen, -ROOM_OPEN_LEAD_SECONDS, -30 * 60, -1]) {
    const a = fakeAdmin(world(short));
    assertEquals(await watchLeague(a, L, at(s)), { outcome: 'postponed', reason: 'not_enough_members' }, `at T${s}s`);
    const args = call(a, 'postpone_league_draft');
    assertEquals([args.p_stage, args.p_draft_date], ['room_open', T]);
    assertEquals((args.p_blockers as unknown[])[0], { code: 'not_enough_members', have: 3, need: 4 });
  }
  // Partial cases at the gate: exactly 4 clears; 2 is short too; 4 with a leave
  // still unconfirmed is postponed for the reconfirm (the same gate, its own reason).
  const four = fakeAdmin(world());
  await watchLeague(four, L, at(gateOpen));
  assertEquals([call(four, 'record_draft_watch').p_blocked, call(four, 'record_draft_watch').p_gate], [false, true]);
  assertEquals((await watchLeague(fakeAdmin(world({ members: ['c', 'm1'] })), L, at(gateOpen))).outcome, 'postponed');
  const rc = fakeAdmin(world({ reconfirm: { departed: [{ user_id: 'u', name: 'Sofia F.' }], members_before: 5, choice: 'pending' } }));
  assertEquals(await watchLeague(rc, L, at(gateOpen)), { outcome: 'postponed', reason: 'roster_reconfirm_required' });
});

Deno.test('gate: an UNKNOWN verdict never warns or postpones; at the room time it clears the gate (fail open for the notice)', async () => {
  const before = fakeAdmin(world({ pool: 'error' }));
  assertEquals((await watchLeague(before, L, IN_GATE_BEFORE_ROOM)).outcome, 'skipped');
  assertEquals(names(before), ['draft_feasibility_pool']);
  const roomTime = fakeAdmin(world({ pool: 'error' }));
  await watchLeague(roomTime, L, IN_GATE_ROOM_TIME);
  const args = call(roomTime, 'record_draft_watch');
  assertEquals([args.p_blocked, args.p_gate], [null, true]);
  // Outside the gate, unknown is recorded as unknown (SQL keeps the old verdict).
  const out = fakeAdmin(world({ pool: 'error' }));
  await watchLeague(out, L, BEFORE);
  assertEquals(call(out, 'record_draft_watch').p_blocked, null);
});

Deno.test('watch: postponed / started / TBD / due leagues are skipped with no write', async () => {
  const cases: Array<[Partial<World>, (w: World) => void, string]> = [
    [{ postponed: true }, () => {}, 'postponed'],
    [{}, (w) => (w.league!.draft_status = 'in_progress'), 'started'],
    [{}, (w) => (w.league!.draft_date = null), 'no_draft_date'],
  ];
  for (const [o, mut, reason] of cases) {
    const w = world(o);
    mut(w);
    const a = fakeAdmin(w);
    assertEquals(await watchLeague(a, L, BEFORE), { outcome: 'skipped', reason });
    assertEquals(names(a), []);
  }
  const a = fakeAdmin(world());
  assertEquals(await watchLeague(a, L, at(1)), { outcome: 'skipped', reason: 'due' });
});

Deno.test('buildStartExpect: ties on slot_index sort by id; absent columns are explicit nulls', () => {
  const e = buildStartExpect({}, 0, [
    { id: 'b', slotIndex: 0, slotCount: 1, priceMin: null, priceMax: null, categoryId: null },
    { id: 'a', slotIndex: 0, slotCount: 1, priceMin: null, priceMax: null, categoryId: null },
  ], true);
  assertEquals(e.slots.map((s) => s.id), ['a', 'b']);
  assertEquals([e.stake_mode, e.budget_amount, e.num_rounds, e.allow_undraftable, e.league_type, e.playoff_teams, e.reconfirm_owed],
    [null, null, null, null, null, null, true]);
});
