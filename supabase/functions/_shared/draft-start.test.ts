/**
 * Hermetic tests for draft-start.ts's startDraftIfDue over a fake supabase
 * client (no DB, no network):
 *   deno test supabase/functions/_shared/draft-start.test.ts
 *
 * The SQL side (start_league_draft's lock, window, floor and CAS, and that the
 * expectation built here equals its rebuild) runs on real Postgres in
 * supabase/tests/draft_auto_start.pglite.test.ts.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { buildStartExpect, startDraftIfDue } from './draft-start.ts';
import { START_GRACE_SECONDS } from './draft-start-policy.ts';

const NOW = new Date('2026-11-10T17:00:30Z');
const L = '00000000-0000-4000-8000-000000000001';
const SLOT_A = 'aaaaaaaa-0000-4000-8000-000000000000';
const SLOT_B = 'bbbbbbbb-0000-4000-8000-000000000000';

interface World {
  league: Record<string, unknown> | null;
  members: string[];
  slots: Array<Record<string, unknown>> | 'error';
  pool: 'error' | Array<{ ordinals: number[]; n: number; prices: number[] }>;
  startResult: unknown;
  startError?: unknown;
  reconfirm?: Record<string, unknown> | null | 'error';
}

function world(o: Partial<World> = {}): World {
  return {
    league: {
      id: L, commissioner_id: 'c', draft_status: 'not_started', stake_mode: 'price_tiers',
      draft_date: '2026-11-10T17:00:00Z', num_participants: 8, league_type: 'matchup', playoff_teams: 4,
      num_rounds: 6, budget_amount: null, allow_undraftable: false,
    },
    members: ['c', 'm1', 'm2', 'm3'],
    // Deliberately out of slot_index order: the expectation must sort.
    slots: [
      { id: SLOT_B, slot_index: 1, slot_count: 3, price_min: 50.5, price_max: null, category_id: null },
      { id: SLOT_A, slot_index: 0, slot_count: 3, price_min: null, price_max: 50.5, category_id: null },
    ],
    pool: [{ ordinals: [0], n: 100, prices: [] }, { ordinals: [1], n: 100, prices: [] }],
    startResult: { status: 'started' },
    ...o,
  };
}

/** Just enough of supabase-js for draft-start.ts + draft-write.ts's loadSlots/poolGroups. */
function fakeAdmin(w: World) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpcs,
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => {
          if (table !== 'league_draft_slots') throw new Error(`unexpected order on ${table}`);
          return Promise.resolve(w.slots === 'error' ? { data: null, error: { message: 'boom' } } : { data: w.slots, error: null });
        },
        maybeSingle: () => {
          if (table === 'league_roster_reconfirm') {
            return Promise.resolve(
              w.reconfirm === 'error' ? { data: null, error: { message: 'boom' } } : { data: w.reconfirm ?? null, error: null },
            );
          }
          if (table !== 'leagues') throw new Error(`unexpected maybeSingle on ${table}`);
          return Promise.resolve({ data: w.league, error: null });
        },
        then: (res: (v: unknown) => unknown) => {
          if (table !== 'league_members') throw new Error(`unexpected await on ${table}`);
          return Promise.resolve({ data: w.members.map((user_id) => ({ user_id })), error: null }).then(res);
        },
      };
      return chain;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      if (name === 'draft_feasibility_pool') {
        return Promise.resolve(w.pool === 'error' ? { data: null, error: { message: 'pool down' } } : { data: w.pool, error: null });
      }
      if (name === 'start_league_draft') return Promise.resolve({ data: w.startResult, error: w.startError ?? null });
      if (name === 'note_draft_start_blocked') return Promise.resolve({ data: null, error: null });
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return admin;
}

const names = (a: ReturnType<typeof fakeAdmin>) => a.rpcs.map((r) => r.name);

Deno.test('started: evaluates, then flips through start_league_draft with the exact expectation', async () => {
  const a = fakeAdmin(world());
  assertEquals(await startDraftIfDue(a, L, NOW), { outcome: 'started' });
  assertEquals(names(a), ['draft_feasibility_pool', 'start_league_draft']);
  const call = a.rpcs.find((r) => r.name === 'start_league_draft')!;
  assertEquals(call.args.p_league_id, L);
  assertEquals(call.args.p_expect, {
    members: 4, stake_mode: 'price_tiers', budget_amount: null, num_rounds: 6, allow_undraftable: false,
    league_type: 'matchup', playoff_teams: 4,
    slots: [
      { id: SLOT_A, slot_index: 0, slot_count: 3, price_min: null, price_max: 50.5, category_id: null },
      { id: SLOT_B, slot_index: 1, slot_count: 3, price_min: 50.5, price_max: null, category_id: null },
    ],
  });
});

Deno.test('never auto-starts a TBD date, before draft_date, or past the grace (no flip attempted)', async () => {
  for (const [draft_date, outcome] of [
    [null, 'not_due'],
    ['2026-11-10T17:01:00Z', 'not_due'],
    [new Date(NOW.getTime() - START_GRACE_SECONDS * 1000).toISOString(), 'missed'],
  ] as const) {
    const w = world();
    w.league!.draft_date = draft_date;
    const a = fakeAdmin(w);
    assertEquals((await startDraftIfDue(a, L, NOW)).outcome, outcome, String(draft_date));
    assertEquals(names(a), [], 'no pool read, no flip, no note');
  }
});

Deno.test('already started / left not_started otherwise: no flip', async () => {
  const w = world();
  w.league!.draft_status = 'in_progress';
  assertEquals(await startDraftIfDue(fakeAdmin(w), L, NOW), { outcome: 'already_started' });
  w.league!.draft_status = 'completed';
  assertEquals(await startDraftIfDue(fakeAdmin(w), L, NOW), { outcome: 'not_startable', draftStatus: 'completed' });
});

Deno.test('blocked by a rule: noted for the back-off, never flipped, no pool read', async () => {
  const a = fakeAdmin(world({ members: ['c', 'm1', 'm2'] }));
  const r = await startDraftIfDue(a, L, NOW);
  assertEquals(r.outcome, 'blocked');
  assert(r.outcome === 'blocked' && r.reason === 'not_enough_members');
  assertEquals(names(a), ['note_draft_start_blocked']);
  assertEquals(a.rpcs[0].args.p_reason, 'not_enough_members');
});

Deno.test('feasibility fails CLOSED: an unreadable pool or slot set blocks (and is noted)', async () => {
  for (const w of [world({ pool: 'error' }), world({ slots: 'error' })]) {
    const a = fakeAdmin(w);
    const r = await startDraftIfDue(a, L, NOW);
    assert(r.outcome === 'blocked' && r.reason === 'feasibility_unavailable', JSON.stringify(r));
    assert(!names(a).includes('start_league_draft'));
    assert(names(a).includes('note_draft_start_blocked'));
  }
});

Deno.test('the flip\'s answers map through; a gate refusal is noted; an rpc error is an error, never a success', async () => {
  assertEquals((await startDraftIfDue(fakeAdmin(world({ startResult: { status: 'changed', actual: {} } })), L, NOW)).outcome, 'changed');
  assertEquals((await startDraftIfDue(fakeAdmin(world({ startResult: { status: 'missed' } })), L, NOW)).outcome, 'missed');
  assertEquals(
    await startDraftIfDue(fakeAdmin(world({ startResult: { status: 'already_started', draft_status: 'in_progress' } })), L, NOW),
    { outcome: 'already_started' },
  );
  const g = fakeAdmin(world({ startResult: { status: 'blocked', reason: 'roster_reconfirm_required' } }));
  const r = await startDraftIfDue(g, L, NOW);
  assert(r.outcome === 'blocked' && r.reason === 'roster_reconfirm_required');
  assertEquals(names(g), ['draft_feasibility_pool', 'start_league_draft', 'note_draft_start_blocked']);
  const e = fakeAdmin(world({ startResult: null, startError: { message: 'x' } }));
  assertEquals(await startDraftIfDue(e, L, NOW), { outcome: 'error', reason: 'start_rpc_failed' });
  assertEquals((await startDraftIfDue(fakeAdmin(world({ startResult: { status: 'weird' } })), L, NOW)).outcome, 'error');
  // Review M1: error and changed back off too, or they would re-list every tick.
  assertEquals(names(e), ['draft_feasibility_pool', 'start_league_draft', 'note_draft_start_blocked']);
  assertEquals(e.rpcs[2].args.p_reason, 'error:start_rpc_failed');
  const c = fakeAdmin(world({ startResult: { status: 'changed', actual: {} } }));
  await startDraftIfDue(c, L, NOW);
  assertEquals(c.rpcs.at(-1)!.args.p_reason, 'changed');
});

Deno.test('a pending roster reconfirmation (#126) blocks before the pool read; an unreadable one fails CLOSED', async () => {
  const a = fakeAdmin(world({ reconfirm: { departed: [{ user_id: 'u', name: 'Sam' }], members_before: 5, choice: 'pending' } }));
  const r = await startDraftIfDue(a, L, NOW);
  assert(r.outcome === 'blocked' && r.reason === 'roster_reconfirm_required', JSON.stringify(r));
  assertEquals(names(a), ['note_draft_start_blocked']);
  const b = fakeAdmin(world({ reconfirm: 'error' }));
  assertEquals(await startDraftIfDue(b, L, NOW), { outcome: 'error', reason: 'reconfirm_read_failed' });
  assertEquals(names(b), ['note_draft_start_blocked']);
});

Deno.test('buildStartExpect: ties on slot_index sort by id; absent columns are explicit nulls', () => {
  const e = buildStartExpect({}, 0, [
    { id: 'b', slotIndex: 0, slotCount: 1, priceMin: null, priceMax: null, categoryId: null },
    { id: 'a', slotIndex: 0, slotCount: 1, priceMin: null, priceMax: null, categoryId: null },
  ]);
  assertEquals(e.slots.map((s) => s.id), ['a', 'b']);
  assertEquals([e.stake_mode, e.budget_amount, e.num_rounds, e.allow_undraftable, e.league_type, e.playoff_teams],
    [null, null, null, null, null, null]);
});
