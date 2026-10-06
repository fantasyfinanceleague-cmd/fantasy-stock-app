/**
 * Hermetic unit tests for draft-start-policy.ts. No DB, no Deno runtime APIs:
 *   deno test supabase/functions/_shared/draft-start-policy.test.ts
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  checkDraftTime,
  computeStartState,
  GATE_LEAD_SECONDS,
  isInGate,
  isPastStartRetry,
  isRoomTime,
  isTransientBlocker,
  MIN_LEAD_SECONDS,
  REMINDER_LEAD_SECONDS,
  ROOM_OPEN_LEAD_SECONDS,
  SQL_POLICY,
  START_RETRY_SECONDS,
} from './draft-start-policy.ts';

const T = '2026-11-10T17:00:00Z'; // noon ET
const at = (secondsFromT: number) => new Date(new Date(T).getTime() + secondsFromT * 1000);
const state = (now: Date, o: Partial<{ draftStatus: string | null; draftDate: string | null; postponed: boolean; blocked: boolean }> = {}) =>
  computeStartState({ draftStatus: 'not_started', draftDate: T, postponed: false, blocked: false, ...o }, now);

Deno.test("the policy numbers: Giorgio's decisions (room at T-1h, reminder at T-2h, 55-min floor)", () => {
  assertEquals(ROOM_OPEN_LEAD_SECONDS, 3600);
  assertEquals(REMINDER_LEAD_SECONDS, 7200);
  assertEquals(GATE_LEAD_SECONDS, 30);
  assertEquals(MIN_LEAD_SECONDS, 55 * 60);
  assertEquals(START_RETRY_SECONDS, 300);
  assertEquals(SQL_POLICY.step_minutes, 15);
});

Deno.test('computeStartState: scheduled/at_risk -> room_open -> due; no grace, no "missed"', () => {
  assertEquals(state(at(-ROOM_OPEN_LEAD_SECONDS - 1)), 'scheduled');
  assertEquals(state(at(-ROOM_OPEN_LEAD_SECONDS - 1), { blocked: true }), 'at_risk');
  assertEquals(state(at(-REMINDER_LEAD_SECONDS * 10), { blocked: true }), 'at_risk');
  assertEquals(state(at(-ROOM_OPEN_LEAD_SECONDS)), 'room_open'); // 11:00:00 sharp
  assertEquals(state(at(-1), { blocked: true }), 'room_open'); // the gate already decided
  assertEquals(state(at(0)), 'due'); // noon sharp
  assertEquals(state(at(START_RETRY_SECONDS * 10)), 'due'); // never "missed": the server postpones it
});

Deno.test('computeStartState: started > postponed > no_date, whatever the clock', () => {
  for (const s of ['in_progress', 'completed']) assertEquals(state(at(0), { draftStatus: s, postponed: true }), 'started');
  assertEquals(state(at(0), { postponed: true, draftDate: null }), 'postponed');
  assertEquals(state(at(-99999), { postponed: true }), 'postponed'); // the explicit row wins over any date
  assertEquals(state(at(0), { draftDate: null }), 'no_date');
  assertEquals(state(at(0), { draftDate: null, blocked: true }), 'no_date');
  assertEquals(state(at(0), { draftStatus: null }), 'due'); // NULL reads as not_started (the column default)
});

Deno.test('gate window [T-1h-30s, T), room time, start retry', () => {
  const gateOpen = -(ROOM_OPEN_LEAD_SECONDS + GATE_LEAD_SECONDS);
  assert(!isInGate(T, at(gateOpen - 1)) && isInGate(T, at(gateOpen)) && isInGate(T, at(-1)) && !isInGate(T, at(0)));
  assert(!isRoomTime(null, at(0)));
  assert(!isRoomTime(T, at(-ROOM_OPEN_LEAD_SECONDS - 1)) && isRoomTime(T, at(-ROOM_OPEN_LEAD_SECONDS)) && isRoomTime(T, at(60)));
  assert(!isPastStartRetry(T, at(START_RETRY_SECONDS - 1)) && isPastStartRetry(T, at(START_RETRY_SECONDS)));
  assert(isTransientBlocker('feasibility_unavailable') && !isTransientBlocker('slots_infeasible'));
});

Deno.test('checkDraftTime: quarter hours only, at least 55 minutes out', () => {
  const now = new Date('2026-11-10T15:02:10Z');
  assertEquals(checkDraftTime('2026-11-10T16:00:00Z', now), 'ok'); // 57m50s out
  assertEquals(checkDraftTime('2026-11-10T15:45:00Z', now), 'too_soon'); // 42m50s out
  assertEquals(checkDraftTime('2026-11-10T15:57:10Z', now), 'not_quarter_hour');
  for (const m of ['16:15', '16:30', '16:45', '17:00']) assertEquals(checkDraftTime(`2026-11-10T${m}:00Z`, now), 'ok');
  for (const m of ['16:05', '16:20', '16:59']) assertEquals(checkDraftTime(`2026-11-10T${m}:00Z`, now), 'not_quarter_hour');
  assertEquals(checkDraftTime('2026-11-10T16:00:30Z', now), 'not_quarter_hour'); // seconds
  assertEquals(checkDraftTime('2026-11-10T16:00:00.500Z', now), 'not_quarter_hour'); // milliseconds
  // Exactly the 55-minute floor passes; a second under does not.
  assertEquals(checkDraftTime('2026-11-10T16:00:00Z', new Date('2026-11-10T15:05:00Z')), 'ok');
  assertEquals(checkDraftTime('2026-11-10T16:00:00Z', new Date('2026-11-10T15:05:01Z')), 'too_soon');
});

Deno.test('DST is irrelevant: instants, and the quarter-hour grid is the same in UTC and ET', () => {
  // 2026-11-01 06:00Z = 1:00 AM EST, just after the fall-back repeat of 1:00-1:59 EDT.
  const dst = '2026-11-01T06:00:00Z';
  const s = (now: string) => computeStartState({ draftStatus: 'not_started', draftDate: dst, postponed: false, blocked: false }, new Date(now));
  assertEquals(s('2026-11-01T05:00:00Z'), 'room_open');
  assertEquals(s('2026-11-01T04:59:59Z'), 'scheduled');
  // America/New_York's offsets are whole hours either side of both 2026 switches.
  assertEquals(checkDraftTime('2026-03-08T07:15:00Z', new Date('2026-03-01T00:00:00Z')), 'ok');
});
