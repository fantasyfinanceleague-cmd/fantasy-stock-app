/**
 * Tests for ./week-select.ts (S8 week selection, instant comparison) and
 * ./job-status.ts (the same-day status overwrite rule).
 *
 * The S8 invariant under test: a refused or unscored week N must NOT stop week
 * N+1 from being a target. Hermetic: no DB, no network.
 */
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert';
import {
  instantAtOrBefore,
  instantBefore,
  selectTargetWeeks,
  type WeekMatchupRow,
} from './week-select.ts';
import { shouldWriteJobStatus, successMessage, workFromMessage } from './job-status.ts';

const row = (week: number, over: Partial<WeekMatchupRow> = {}): WeekMatchupRow => ({
  week_number: week,
  team1_user_id: 'u1',
  week_start: `2026-10-0${week}T13:30:00.000Z`,
  week_end: `2026-10-0${week + 1}T20:00:00.000Z`,
  created_at: '2026-09-01T00:00:00.000Z',
  ...over,
});

// A plan stub: weeks <= `openThrough` are proceed/refuse per `refusedWeek`, later ones not_due.
const planThrough = (openThrough: number, refusedWeek?: number) =>
  (anchor: Date) => {
    const week = Number(anchor.toISOString().slice(9, 10));
    if (week > openThrough) return { action: 'not_due' as const };
    return { action: week === refusedWeek ? ('refuse' as const) : ('proceed' as const) };
  };

Deno.test('S8: week N refused/unscored does NOT stop week N+1 from being a target (the Monday baseline)', () => {
  // Week 1 is refused (a stale calendar), week 2 is due and proceeds. The old
  // current_week keying never reached week 2 once week 1 stalled.
  const rows = [row(1), row(2)];
  assertEquals(selectTargetWeeks(rows, planThrough(2, 1)), [1, 2]);
});

Deno.test('S8: a week whose window is not yet open is excluded (never snapshot a future round)', () => {
  const rows = [row(1), row(2), row(3)];
  assertEquals(selectTargetWeeks(rows, planThrough(2)), [1, 2]);
});

Deno.test('S8: a placeholder row (NULL team1, unfilled playoff slot) never makes its round a target', () => {
  const rows = [row(1), row(2, { team1_user_id: null, team2_user_id: null } as any)];
  assertEquals(selectTargetWeeks(rows, planThrough(2)), [1]);
});

Deno.test('S8: a round whose only rows are placeholders is absent entirely', () => {
  assertEquals(selectTargetWeeks([row(1, { team1_user_id: null })], planThrough(5)), []);
});

Deno.test('S8: targets are ascending regardless of row order', () => {
  assertEquals(selectTargetWeeks([row(3), row(1), row(2)], planThrough(3)), [1, 2, 3]);
});

Deno.test('S8: the plan is called with the week\'s own anchor and its earliest created_at as floor', () => {
  const seen: Array<{ anchor: string; floor: string | null }> = [];
  selectTargetWeeks(
    [row(1, { created_at: '2026-09-03T15:00:00.000Z' }), row(1, { created_at: '2026-09-02T15:00:00.000Z' })],
    (anchor, floor) => {
      seen.push({ anchor: anchor.toISOString(), floor: floor?.toISOString() ?? null });
      return { action: 'proceed' };
    },
  );
  assertEquals(seen, [{ anchor: '2026-10-01T13:30:00.000Z', floor: '2026-09-02T15:00:00.000Z' }]);
});

Deno.test('instant compare: mixed PostgREST and toISOString formats compare by instant, not text', () => {
  // '+00:00' sorts before 'Z' as text, so string compare can misorder these.
  const cut = Date.parse('2026-10-01T13:30:00.000Z');
  assert(instantBefore('2026-10-01T13:29:59.999+00:00', cut));
  assert(!instantBefore('2026-10-01T13:30:00+00:00', cut));
  assert(instantAtOrBefore('2026-10-01T13:30:00+00:00', cut));
  assert(!instantAtOrBefore('2026-10-01T13:30:00.001+00:00', cut));
});

Deno.test('instant compare: an unparseable created_at THROWS (fail closed), never silently excluded', () => {
  assertThrows(() => instantBefore('not-a-date', 0));
  assertThrows(() => instantAtOrBefore('', 0));
});

// ── job status rule ──────────────────────────────────────────────────────────

Deno.test('status: a no-op success never overwrites a same-day success that recorded work (Friday evidence kept)', () => {
  const friday = { status: 'success' as const, error_message: 'work=3 processed 3 snapshot rows' };
  assertEquals(shouldWriteJobStatus(friday, { status: 'success', work: 0 }), false);
});

Deno.test('status: a no-op success never overwrites a same-day FAILURE', () => {
  assertEquals(shouldWriteJobStatus({ status: 'failed', error_message: 'boom' }, { status: 'success', work: 0 }), false);
  assertEquals(shouldWriteJobStatus({ status: 'retrying', error_message: 'x' }, { status: 'success', work: 0 }), false);
});

Deno.test('status: a legacy success with no work= marker is NOT trivial, so a no-op cannot replace it', () => {
  assertEquals(shouldWriteJobStatus({ status: 'success', error_message: null }, { status: 'success', work: 0 }), false);
});

Deno.test('status: a no-op success CAN write over no row, or over a trivial success (work=0)', () => {
  assertEquals(shouldWriteJobStatus(null, { status: 'success', work: 0 }), true);
  assertEquals(shouldWriteJobStatus({ status: 'success', error_message: successMessage(0) }, { status: 'success', work: 0 }), true);
});

Deno.test('status: real work always writes, over anything', () => {
  assertEquals(shouldWriteJobStatus({ status: 'success', error_message: successMessage(5) }, { status: 'success', work: 2 }), true);
  assertEquals(shouldWriteJobStatus({ status: 'failed', error_message: 'x' }, { status: 'success', work: 1 }), true);
});

Deno.test('status: failure and retrying are always written', () => {
  assertEquals(shouldWriteJobStatus({ status: 'success', error_message: successMessage(9) }, { status: 'failed' }), true);
  assertEquals(shouldWriteJobStatus({ status: 'success', error_message: successMessage(9) }, { status: 'retrying' }), true);
});

Deno.test('status: running writes only over a trivial row, so it cannot strand Friday\'s evidence', () => {
  assertEquals(shouldWriteJobStatus({ status: 'success', error_message: successMessage(4) }, { status: 'running' }), false);
  assertEquals(shouldWriteJobStatus({ status: 'running', error_message: null }, { status: 'running' }), true);
});

Deno.test('status: workFromMessage parses only a leading work= marker', () => {
  assertEquals(workFromMessage('work=0'), 0);
  assertEquals(workFromMessage('work=12 processed 12'), 12);
  assertEquals(workFromMessage('processed 3 work=3'), null);
  assertEquals(workFromMessage(null), null);
});
