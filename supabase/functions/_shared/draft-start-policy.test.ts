/**
 * Hermetic unit tests for draft-start-policy.ts. No DB, no Deno runtime APIs:
 *   deno test supabase/functions/_shared/draft-start-policy.test.ts
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  computeStartState,
  isInStartWindow,
  isPastStartWindow,
  isRoomOpen,
  ROOM_OPEN_LEAD_SECONDS,
  START_GRACE_SECONDS,
} from './draft-start-policy.ts';

const T = '2026-11-10T17:00:00Z'; // noon ET
const at = (secondsFromT: number) => new Date(new Date(T).getTime() + secondsFromT * 1000);
const state = (now: Date, o: Partial<{ draftStatus: string | null; draftDate: string | null; blocked: boolean }> = {}) =>
  computeStartState({ draftStatus: 'not_started', draftDate: T, blocked: false, ...o }, now);

Deno.test('the policy numbers: ★A 15-minute grace, room opens an hour before', () => {
  assertEquals(START_GRACE_SECONDS, 900);
  assertEquals(ROOM_OPEN_LEAD_SECONDS, 3600);
});

Deno.test('computeStartState walks scheduled -> room_open -> due/delayed -> missed', () => {
  assertEquals(state(at(-ROOM_OPEN_LEAD_SECONDS - 1)), 'scheduled');
  assertEquals(state(at(-ROOM_OPEN_LEAD_SECONDS)), 'room_open'); // 11:00:00 sharp
  assertEquals(state(at(-1)), 'room_open');
  assertEquals(state(at(0)), 'due'); // noon sharp
  assertEquals(state(at(0), { blocked: true }), 'delayed');
  assertEquals(state(at(START_GRACE_SECONDS - 1), { blocked: true }), 'delayed');
  assertEquals(state(at(START_GRACE_SECONDS), { blocked: true }), 'missed'); // half-open, like SQL
  assertEquals(state(at(START_GRACE_SECONDS)), 'missed');
});

Deno.test('computeStartState: TBD and started win over the clock', () => {
  assertEquals(state(at(0), { draftDate: null }), 'no_date');
  assertEquals(state(at(0), { draftDate: null, blocked: true }), 'no_date');
  for (const s of ['in_progress', 'completed']) assertEquals(state(at(START_GRACE_SECONDS * 4), { draftStatus: s }), 'started');
  assertEquals(state(at(0), { draftStatus: null }), 'due'); // NULL reads as not_started (the column default)
});

Deno.test('the window helpers agree with computeStartState', () => {
  assert(!isInStartWindow(T, at(-1)) && !isPastStartWindow(T, at(-1)));
  assert(isInStartWindow(T, at(0)) && isInStartWindow(T, at(START_GRACE_SECONDS - 1)));
  assert(!isInStartWindow(T, at(START_GRACE_SECONDS)) && isPastStartWindow(T, at(START_GRACE_SECONDS)));
  assert(!isRoomOpen(null, at(0)));
  assert(!isRoomOpen(T, at(-ROOM_OPEN_LEAD_SECONDS - 1)) && isRoomOpen(T, at(-ROOM_OPEN_LEAD_SECONDS)) && isRoomOpen(T, at(60)));
});

Deno.test('DST is irrelevant to the policy: instants, not wall times', () => {
  // 2026-11-01 06:00Z is 1:00 AM EST, just after the fall-back repeat of 1:00-1:59 EDT.
  const dst = '2026-11-01T06:00:00Z';
  assertEquals(computeStartState({ draftStatus: 'not_started', draftDate: dst, blocked: false }, new Date('2026-11-01T05:00:00Z')), 'room_open');
  assertEquals(computeStartState({ draftStatus: 'not_started', draftDate: dst, blocked: false }, new Date('2026-11-01T04:59:59Z')), 'scheduled');
});
