/**
 * Hermetic tests for deleted-seat.ts and the gate's new `seatDeleted` option.
 *   deno test supabase/functions/_shared/deleted-seat.test.ts
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { decideAutoPickGate, type DraftClock } from './auto-pick.ts';
import { decideDeletedSeatPick, listUnclockedDeletedSeatTurns, seatReader, selectSeatTurns } from './deleted-seat.ts';
import type { PickRow } from './draft-validation.ts';

const ORDER = ['u1', 'u2', 'u3'];
const picks = (n: number): PickRow[] =>
  Array.from({ length: n }, (_, i) => ({ user_id: ORDER[i % 3], symbol: `S${i}`, entry_price: 1, quantity: 1, pick_number: i + 1, slot_id: null }) as unknown as PickRow);

const NOW = '2026-10-21T12:00:00Z';
const unclocked = (picksMade: number): DraftClock => ({
  draftStatus: 'in_progress', clockRunning: false, pickSeconds: 60, picksMade, turnStartedAt: null, deadlineAt: null, serverNow: NOW,
});
const clocked = (picksMade: number, deadlineAt: string): DraftClock => ({
  draftStatus: 'in_progress', clockRunning: true, pickSeconds: 60, picksMade, turnStartedAt: '2026-10-21T11:59:00Z', deadlineAt, serverNow: NOW,
});
const reader = (deleted: Record<string, boolean>, broken = false) => (u: string) =>
  Promise.resolve({ deleted: deleted[u] === true, error: broken });

// ---- the gate ----------------------------------------------------------------------

Deno.test('gate: an unclocked draft is NEVER auto-picked without the deleted-seat flag (a live seat is theirs)', () => {
  assertEquals(decideAutoPickGate(1, unclocked(0)), { kind: 'clock_not_running' });
  assertEquals(decideAutoPickGate(1, unclocked(0), {}), { kind: 'clock_not_running' });
  assertEquals(decideAutoPickGate(1, unclocked(0), { seatDeleted: false }), { kind: 'clock_not_running' });
});

Deno.test('gate: an unclocked draft with a DELETED seat goes', () => {
  assertEquals(decideAutoPickGate(1, unclocked(0), { seatDeleted: true }), { kind: 'go' });
  assertEquals(decideAutoPickGate(4, unclocked(3), { seatDeleted: true }), { kind: 'go' });
});

Deno.test('gate: the deleted-seat flag changes nothing else (status, pick number, already recorded)', () => {
  const o = { seatDeleted: true };
  assertEquals(decideAutoPickGate(1, { ...unclocked(0), draftStatus: 'not_started' }, o), { kind: 'draft_not_in_progress' });
  assertEquals(decideAutoPickGate(1, { ...unclocked(0), draftStatus: 'completed' }, o), { kind: 'draft_not_in_progress' });
  assertEquals(decideAutoPickGate(5, unclocked(2), o), { kind: 'stale_pick_number' });
  assertEquals(decideAutoPickGate(2, unclocked(2), o), { kind: 'already_recorded' });
  assertEquals(decideAutoPickGate(0, unclocked(0), o), { kind: 'stale_pick_number' });
});

Deno.test('gate: a CLOCKED draft is unchanged by the flag (the clock expiry still decides)', () => {
  const o = { seatDeleted: true };
  assertEquals(decideAutoPickGate(1, clocked(0, '2026-10-21T12:00:30Z'), o).kind, 'not_overdue');
  assertEquals(decideAutoPickGate(1, clocked(0, '2026-10-21T11:59:59Z'), o), { kind: 'go' });
  // and without the flag exactly as before
  assertEquals(decideAutoPickGate(1, clocked(0, '2026-10-21T12:00:30Z')).kind, 'not_overdue');
  // a running clock with no deadline is still malformed, flag or not
  assertEquals(decideAutoPickGate(1, { ...clocked(0, 'x'), deadlineAt: null }, o), { kind: 'clock_not_running' });
});

// ---- the sweep's per-league decision ----------------------------------------------------

Deno.test('an unclocked draft whose CURRENT picker is a deleted seat advances', async () => {
  const d = await decideDeletedSeatPick({ picks: picks(0), order: ORDER, numRounds: 2 }, unclocked(0), reader({ u1: true }));
  assertEquals(d, { kind: 'go', pickerId: 'u1' });
  // mid-draft, snake order: pick 4 is round 2, reversed: u3 picks first
  const d2 = await decideDeletedSeatPick({ picks: picks(3), order: ORDER, numRounds: 2 }, unclocked(3), reader({ u3: true }));
  assertEquals(d2, { kind: 'go', pickerId: 'u3' });
});

Deno.test('a LIVE manager in an unclocked draft is never auto-picked', async () => {
  const d = await decideDeletedSeatPick({ picks: picks(0), order: ORDER, numRounds: 2 }, unclocked(0), reader({}));
  assertEquals(d, { kind: 'skip', why: 'seat_live' });
});

Deno.test("only THIS turn's picker counts: a deleted seat elsewhere in the order does not trigger a pick for someone else", async () => {
  const d = await decideDeletedSeatPick({ picks: picks(0), order: ORDER, numRounds: 2 }, unclocked(0), reader({ u2: true, u3: true }));
  assertEquals(d, { kind: 'skip', why: 'seat_live' }, "it is u1's turn, and u1 is live");
});

Deno.test('the seat read fails CLOSED: an unreadable deleted_at is never a pick', async () => {
  const d = await decideDeletedSeatPick({ picks: picks(0), order: ORDER, numRounds: 2 }, unclocked(0), reader({ u1: true }, true));
  assertEquals(d, { kind: 'skip', why: 'seat_read_failed' });
});

Deno.test('a full draft has no turn; a pick that landed between the two reads is stale, never a wrong-picker pick', async () => {
  assertEquals(
    await decideDeletedSeatPick({ picks: picks(6), order: ORDER, numRounds: 2 }, unclocked(6), reader({ u1: true })),
    { kind: 'skip', why: 'no_turn' },
  );
  // the context says 0 picks, the clock (read later) says 1: the picker computed from the context is not that turn
  assertEquals(
    await decideDeletedSeatPick({ picks: picks(0), order: ORDER, numRounds: 2 }, unclocked(1), reader({ u1: true })),
    { kind: 'skip', why: 'stale_pick_number' },
  );
});

Deno.test("a deleted seat in a CLOCKED draft waits for the clock, exactly as before", async () => {
  const state = { picks: picks(0), order: ORDER, numRounds: 2 };
  assertEquals(
    await decideDeletedSeatPick(state, clocked(0, '2026-10-21T12:00:30Z'), reader({ u1: true })),
    { kind: 'skip', why: 'not_overdue' },
  );
});

Deno.test('a draft that is not in progress is never picked for', async () => {
  const d = await decideDeletedSeatPick(
    { picks: picks(0), order: ORDER, numRounds: 2 }, { ...unclocked(0), draftStatus: 'completed' }, reader({ u1: true }));
  assertEquals(d, { kind: 'skip', why: 'draft_not_in_progress' });
});

// ---- the I/O adapters ------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
const fakeAdmin = (rows: any, error: any = null, rpcData: any = null): any => ({
  from: (_t: string) => {
    const q = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve({ data: rows, error }) };
    return q;
  },
  rpc: () => Promise.resolve({ data: rpcData, error }),
});

Deno.test('seatReader: deleted_at set → deleted; null/absent → live; an error → error:true, NOT deleted', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    assertEquals(await seatReader(fakeAdmin({ deleted_at: '2026-10-21T00:00:00Z' }), 'L')('u1'), { deleted: true, error: false });
    assertEquals(await seatReader(fakeAdmin({ deleted_at: null }), 'L')('u1'), { deleted: false, error: false });
    assertEquals(await seatReader(fakeAdmin(null), 'L')('u1'), { deleted: false, error: false });
    assertEquals(await seatReader(fakeAdmin(null, { code: 'XX000' }), 'L')('u1'), { deleted: false, error: true });
    const throwing = { from: () => { throw new Error('x'); } };
    assertEquals(await seatReader(throwing, 'L')('u1'), { deleted: false, error: true });
  } finally { console.error = quiet; }
});

Deno.test('listUnclockedDeletedSeatTurns: well-formed rows pass; a dropped row FLAGS the result (valid rows still returned)', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    const good = '11111111-1111-4111-8111-111111111111';
    assertEquals(
      await listUnclockedDeletedSeatTurns(fakeAdmin(null, null, [
        { league_id: good, pick_number: 3 },
        { league_id: good, pick_number: '4' }, // a numeric string is a number to PostgREST bigint
      ])),
      { turns: [{ leagueId: good, pickNumber: 3 }, { leagueId: good, pickNumber: 4 }], error: false },
    );
    for (const bad of [
      { league_id: 'junk', pick_number: 1 }, { league_id: good, pick_number: 0 }, { league_id: good, pick_number: 1.5 },
      { league_id: good }, { league_id: 5, pick_number: 1 }, null,
    ]) {
      // one good row and one bad: the good one survives, the result is flagged (a renamed column would otherwise stall silently)
      assertEquals(
        await listUnclockedDeletedSeatTurns(fakeAdmin(null, null, [{ league_id: good, pick_number: 3 }, bad])),
        { turns: [{ leagueId: good, pickNumber: 3 }], error: true },
        JSON.stringify(bad),
      );
    }
    assertEquals(await listUnclockedDeletedSeatTurns(fakeAdmin(null, null, [])), { turns: [], error: false });
  } finally { console.error = quiet; }
});

Deno.test('listUnclockedDeletedSeatTurns: a non-array body or an rpc error is an ERROR, never "none"', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    for (const body of [null, {}, 'x', 5]) {
      assertEquals(await listUnclockedDeletedSeatTurns(fakeAdmin(null, null, body)), { turns: [], error: true }, JSON.stringify(body));
    }
    const failed = await listUnclockedDeletedSeatTurns(fakeAdmin(null, { code: '42883' }));
    assertEquals(failed, { turns: [], error: true });
    assert(failed.error, 'a failed list must be distinguishable from an empty one');
  } finally { console.error = quiet; }
});

Deno.test('listUnclockedDeletedSeatTurns calls W2\'s rpc by name', async () => {
  const seen: string[] = [];
  // deno-lint-ignore no-explicit-any
  const admin: any = { rpc: (fn: string) => { seen.push(fn); return Promise.resolve({ data: [], error: null }); } };
  await listUnclockedDeletedSeatTurns(admin);
  assertEquals(seen, ['unclocked_deleted_seat_turns']);
});

// ---- the sweep's per-tick selection (liveness) ---------------------------------------------

const turnsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ leagueId: `L${i}`, pickNumber: 1 }));

Deno.test('selectSeatTurns: capped, no duplicates, and the overdue pass\'s leagues are left out', () => {
  const out = selectSeatTurns(turnsOf(15), new Set(['L0', 'L1']), 10, () => 0.3);
  assertEquals(out.length, 10);
  assertEquals(new Set(out.map((t) => t.leagueId)).size, 10);
  assert(!out.some((t) => t.leagueId === 'L0' || t.leagueId === 'L1'));
  assertEquals(selectSeatTurns(turnsOf(3), new Set(), 10).length, 3);
  assertEquals(selectSeatTurns(turnsOf(3), new Set(), 0), []);
  assertEquals(selectSeatTurns([], new Set(), 10), []);
});

Deno.test('selectSeatTurns does not mutate its input (the list is shared with the response count)', () => {
  const input = turnsOf(12);
  const before = JSON.stringify(input);
  selectSeatTurns(input, new Set(), 5, () => 0.9);
  assertEquals(JSON.stringify(input), before);
});

Deno.test('selectSeatTurns: NO STARVATION. With more leagues than the cap, every league is reached over time', () => {
  // 25 listed leagues, cap 10: a fixed "first 10" would never reach L10..L24, including the one
  // that genuinely waits on a deleted seat. Over many ticks every league must be taken.
  const seen = new Set<string>();
  let seed = 12345;
  const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let tick = 0; tick < 200; tick++) {
    for (const t of selectSeatTurns(turnsOf(25), new Set(), 10, rng)) seen.add(t.leagueId);
  }
  assertEquals(seen.size, 25);
});

Deno.test('selectSeatTurns: a fixed order would starve (the property above is not vacuous)', () => {
  const fixed = selectSeatTurns(turnsOf(25), new Set(), 10, () => 0.999999); // rng that never swaps
  assertEquals(fixed.map((t) => t.leagueId), turnsOf(10).map((t) => t.leagueId));
});
