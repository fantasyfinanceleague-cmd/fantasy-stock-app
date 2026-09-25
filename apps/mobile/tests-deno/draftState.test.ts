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
import { computeDraftPhase, describeStartBlocker } from '../lib/draftState.ts';

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
