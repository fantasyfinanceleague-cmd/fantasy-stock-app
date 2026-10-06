/**
 * Hermetic tests for draft-start.ts (startDraftIfDue, watchLeague) over a fake
 * supabase client (no DB, no network):
 *   deno test supabase/functions/_shared/draft-start.test.ts
 *
 * The SQL side (locks, the gate, postponement, the CAS, the notices, and that
 * the expectation built here equals _draft_start_inputs) runs on real Postgres
 * in supabase/tests/draft_auto_start.pglite.test.ts.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { buildStartExpect, startDraftIfDue, watchLeague } from './draft-start.ts';
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
  rpc: Record<string, unknown>; // name -> data (or { __error })
}

function world(o: Partial<World> = {}): World {
  return {
    league: {
      id: L, commissioner_id: 'c', draft_status: 'not_started', stake_mode: 'price_tiers', draft_date: T,
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
          if (table !== 'league_draft_slots') throw new Error(`unexpected order on ${table}`);
          return w.slots === 'error' ? res(null, { message: 'boom' }) : res(w.slots);
        },
        maybeSingle: () => {
          if (table === 'leagues') return res(w.league);
          if (table === 'league_roster_reconfirm') return w.reconfirm === 'error' ? res(null, { message: 'boom' }) : res(w.reconfirm ?? null);
          if (table === 'draft_postponements') return res(w.postponed ? { league_id: L } : null);
          throw new Error(`unexpected maybeSingle on ${table}`);
        },
        then: (ok: (v: unknown) => unknown) => {
          if (table !== 'league_members') throw new Error(`unexpected await on ${table}`);
          return res(w.members.map((user_id) => ({ user_id }))).then(ok);
        },
      };
      return chain;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      if (name === 'draft_feasibility_pool') return w.pool === 'error' ? res(null, { message: 'pool down' }) : res(w.pool);
      if (name in w.rpc) {
        const v = w.rpc[name] as Record<string, unknown> | null;
        return v && '__error' in v ? res(null, v.__error) : res(v);
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}
const names = (a: ReturnType<typeof fakeAdmin>) => a.rpcs.map((r) => r.name);
const call = (a: ReturnType<typeof fakeAdmin>, n: string) => a.rpcs.find((r) => r.name === n)!.args;

// ---- START ----------------------------------------------------------------

Deno.test('start: evaluates, then flips through start_league_draft with the exact expectation', async () => {
  const a = fakeAdmin(world());
  assertEquals(await startDraftIfDue(a, L, at(5)), { outcome: 'started' });
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
