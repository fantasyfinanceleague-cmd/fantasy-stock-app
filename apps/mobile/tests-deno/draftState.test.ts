/**
 * Hermetic unit tests for lib/draftState.ts. No RN, no Deno runtime APIs
 * beyond Date — run:
 *
 *   deno test apps/mobile/tests-deno/
 *
 * Kept outside apps/mobile's own tsconfig/eslint scope (tsconfig.json
 * excludes tests-deno/**) since `jsr:` specifiers are Deno-only.
 */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { computeDraftPhase, describeStartBlocker, msUntilStartRecheck, computeDraftHeaderState } from '../lib/draftState.ts';

Deno.test('computeDraftPhase: no stake mode wins regardless of draft_status', () => {
  assertEquals(
    computeDraftPhase({ draftStatus: 'completed', stakeMode: null, memberCount: 4, numRounds: 6, pickCount: 24 }),
    'no_stake_mode',
  );
});

Deno.test('computeDraftPhase: not_started', () => {
  assertEquals(
    computeDraftPhase({ draftStatus: 'not_started', stakeMode: 'budget_cap', memberCount: 4, numRounds: 6, pickCount: 0 }),
    'not_started',
  );
});

Deno.test('computeDraftPhase: completed is read only from draft_status, never inferred from pick count', () => {
  assertEquals(
    computeDraftPhase({ draftStatus: 'completed', stakeMode: 'budget_cap', memberCount: 4, numRounds: 6, pickCount: 0 }),
    'completed',
  );
});

Deno.test('computeDraftPhase: in_progress with picks remaining is drafting', () => {
  assertEquals(
    computeDraftPhase({ draftStatus: 'in_progress', stakeMode: 'budget_cap', memberCount: 4, numRounds: 6, pickCount: 10 }),
    'drafting',
  );
});

Deno.test('computeDraftPhase: every pick made but still in_progress is finalizing, not completed', () => {
  assertEquals(
    computeDraftPhase({ draftStatus: 'in_progress', stakeMode: 'budget_cap', memberCount: 4, numRounds: 6, pickCount: 24 }),
    'finalizing',
  );
});

Deno.test('computeDraftPhase: MORE picks than expected (defensive) is still finalizing', () => {
  assertEquals(
    computeDraftPhase({ draftStatus: 'in_progress', stakeMode: 'budget_cap', memberCount: 4, numRounds: 6, pickCount: 25 }),
    'finalizing',
  );
});

Deno.test('computeDraftPhase: zero members never reports finalizing (guards the multiplication)', () => {
  assertEquals(
    computeDraftPhase({ draftStatus: 'in_progress', stakeMode: 'budget_cap', memberCount: 0, numRounds: 6, pickCount: 0 }),
    'drafting',
  );
});

Deno.test('describeStartBlocker: not_started_state distinguishes completed from in_progress', () => {
  assertStringIncludes(describeStartBlocker({ code: 'not_started_state', draftStatus: 'completed' }), 'finished');
  assertStringIncludes(describeStartBlocker({ code: 'not_started_state', draftStatus: 'in_progress' }), 'started');
});

Deno.test('describeStartBlocker: not_enough_members computes the gap', () => {
  const msg = describeStartBlocker({ code: 'not_enough_members', have: 2, need: 4 });
  assertStringIncludes(msg, '2 more');
  assertStringIncludes(msg, 'have 2');
  assertStringIncludes(msg, 'need 4');
});

Deno.test('describeStartBlocker: not_enough_members singularizes "1 more member"', () => {
  const msg = describeStartBlocker({ code: 'not_enough_members', have: 3, need: 4 });
  assertStringIncludes(msg, '1 more member');
  assertEquals(msg.includes('1 more members'), false);
});

Deno.test('describeStartBlocker: draft_date_not_reached includes the date', () => {
  const msg = describeStartBlocker({ code: 'draft_date_not_reached', draftDate: '2026-10-05T18:00:00Z' });
  assertStringIncludes(msg, 'opens at');
});

Deno.test('describeStartBlocker: no_draft_date and no_stake_mode point at League Settings', () => {
  assertStringIncludes(describeStartBlocker({ code: 'no_draft_date' }), 'League Settings');
  assertStringIncludes(describeStartBlocker({ code: 'no_stake_mode' }), 'League Settings');
});

// ---------------------------------------------------------------------------
// msUntilStartRecheck — the draft screen's single-timer re-fetch schedule
// (bug #1: Start Draft stayed disabled past its own scheduled time because
// nothing re-asked the server after the initial fetch).
// ---------------------------------------------------------------------------

Deno.test('msUntilStartRecheck: no draft_date_not_reached blocker -> nothing to wait for', () => {
  assertEquals(msUntilStartRecheck([]), null);
  assertEquals(msUntilStartRecheck([{ code: 'no_stake_mode' }]), null);
  assertEquals(msUntilStartRecheck([{ code: 'not_enough_members', have: 2, need: 4 }]), null);
});

Deno.test('msUntilStartRecheck: schedules just after the draft time, with a grace period', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  const draftDate = '2026-09-25T12:05:00Z'; // 5 minutes out
  const delay = msUntilStartRecheck(
    [{ code: 'draft_date_not_reached', draftDate }],
    now,
  );
  // 5 minutes + the 1.5s grace period baked into the function.
  assertEquals(delay, 5 * 60_000 + 1_500);
});

Deno.test('msUntilStartRecheck: clock skew (local clock already past the draft time) floors at 15s, never negative or zero', () => {
  const now = new Date('2026-09-25T12:05:00Z');
  const draftDate = '2026-09-25T12:00:00Z'; // 5 minutes in the past per the local clock
  const delay = msUntilStartRecheck(
    [{ code: 'draft_date_not_reached', draftDate }],
    now,
  );
  assertEquals(delay, 15_000);
});

Deno.test('msUntilStartRecheck: a delay right at the floor boundary is not floored', () => {
  // draftTime - now + 1500 === 15000 exactly -> should pass through unchanged,
  // not get floored (floor only kicks in for values BELOW it).
  const now = new Date('2026-09-25T12:00:00.000Z');
  const draftDate = '2026-09-25T12:00:13.500Z'; // 13.5s out + 1.5s grace = 15000ms
  assertEquals(
    msUntilStartRecheck([{ code: 'draft_date_not_reached', draftDate }], now),
    15_000,
  );
});

Deno.test('msUntilStartRecheck: a delay beyond setTimeout\'s max signed 32-bit ms is not schedulable (returns null)', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  const farFuture = new Date(now.getTime() + 2 ** 31).toISOString(); // just over the limit
  assertEquals(
    msUntilStartRecheck([{ code: 'draft_date_not_reached', draftDate: farFuture }], now),
    null,
  );
});

Deno.test('msUntilStartRecheck: an unparseable draftDate is treated as nothing to wait for', () => {
  assertEquals(
    msUntilStartRecheck([{ code: 'draft_date_not_reached', draftDate: 'not-a-date' }]),
    null,
  );
});

Deno.test('msUntilStartRecheck: draft_date_not_reached without a draftDate is treated as nothing to wait for', () => {
  assertEquals(msUntilStartRecheck([{ code: 'draft_date_not_reached' }]), null);
});

Deno.test('msUntilStartRecheck: picks the draft_date_not_reached blocker out of a mixed list', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  const draftDate = '2026-09-25T12:10:00Z';
  const delay = msUntilStartRecheck(
    [
      { code: 'not_enough_members', have: 2, need: 4 },
      { code: 'draft_date_not_reached', draftDate },
    ],
    now,
  );
  assertEquals(delay, 10 * 60_000 + 1_500);
});

// ---------------------------------------------------------------------------
// computeDraftHeaderState — the not-started screen's headline/subline state
// (design review: after the timer above flips Start Draft to enabled, the
// screen must stop reading "Draft Not Started / Scheduled for <past time>").
// ---------------------------------------------------------------------------

Deno.test('computeDraftHeaderState: no blockers at all -> ready, regardless of hasDraftDate', () => {
  assertEquals(computeDraftHeaderState(true, true, []), 'ready');
});

Deno.test('computeDraftHeaderState: draft_date_not_reached is the ONLY blocker -> date_pending', () => {
  assertEquals(
    computeDraftHeaderState(true, false, [{ code: 'draft_date_not_reached', draftDate: '2026-10-05T18:00:00Z' }]),
    'date_pending',
  );
});

Deno.test('computeDraftHeaderState: canStart false with an empty blockers list still reads as blocked, not ready', () => {
  // Defensive: canStart and blockers.length are two different signals from
  // the same response; a not-yet-loaded/inconsistent state should never
  // read as 'ready' just because the blockers array happens to be empty.
  // hasDraftDate still decides which flavor of "blocked" this is.
  assertEquals(computeDraftHeaderState(true, false, []), 'blocked_with_date');
  assertEquals(computeDraftHeaderState(false, false, []), 'blocked_no_date');
});

Deno.test('computeDraftHeaderState: other blockers with a date set -> blocked_with_date, not date_pending', () => {
  assertEquals(
    computeDraftHeaderState(true, false, [{ code: 'not_enough_members', have: 1, need: 4 }]),
    'blocked_with_date',
  );
});

Deno.test('computeDraftHeaderState: other blockers with no date set -> blocked_no_date', () => {
  assertEquals(
    computeDraftHeaderState(false, false, [{ code: 'no_stake_mode' }]),
    'blocked_no_date',
  );
});

Deno.test('computeDraftHeaderState: date blocker takes priority in the returned state even alongside other blockers', () => {
  assertEquals(
    computeDraftHeaderState(true, false, [
      { code: 'not_enough_members', have: 1, need: 4 },
      { code: 'draft_date_not_reached', draftDate: '2026-10-05T18:00:00Z' },
    ]),
    'date_pending',
  );
});
