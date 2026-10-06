/**
 * The lobby's playoff-teams stepper (3c-2; Design Lead ruling): the lock first
 * (no "Try again": retrying can't fix it), then any other failure, including
 * a 0-row update, as "not saved". Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  PLAYOFF_TEAMS_LOCKED,
  PLAYOFF_TEAMS_NOT_SAVED,
  isLeagueLockError,
  playoffTeamsSaveOutcome,
} from '../lib/game/playoffTeamsSave.ts';
import { settingsSaveOutcome } from '../lib/game/settingsSave.ts';
import hookSrc from '../lib/game/useDraftAutoStart.ts' with { type: 'text' };

const lock = (prefix: string) => ({ code: '42501', message: `${prefix}: playoff spots cannot change once the draft has started` });

Deno.test('saved: exactly the one row, no error', () => {
  assertEquals(playoffTeamsSaveOutcome({ data: [{ id: 'L1' }], error: null }), { kind: 'saved' });
});

Deno.test('the lock comes first, from either freeze, with no "Try again"', () => {
  for (const p of ['playoff_teams_locked', 'league_rules_locked']) {
    assertEquals(playoffTeamsSaveOutcome({ data: null, error: lock(p) }), { kind: 'locked', line: PLAYOFF_TEAMS_LOCKED });
  }
  assertEquals(/try again/i.test(PLAYOFF_TEAMS_LOCKED), false);
});

Deno.test('0 rows (RLS or a stale id: no error) is not saved, retryable', () => {
  assertEquals(playoffTeamsSaveOutcome({ data: [], error: null }), { kind: 'not_saved', line: PLAYOFF_TEAMS_NOT_SAVED });
  assertEquals(playoffTeamsSaveOutcome({ data: null, error: null }), { kind: 'not_saved', line: PLAYOFF_TEAMS_NOT_SAVED });
});

Deno.test('any other error is not saved, retryable, never the raw message', () => {
  const out = playoffTeamsSaveOutcome({ data: null, error: { message: 'network request failed' } });
  assertEquals(out, { kind: 'not_saved', line: PLAYOFF_TEAMS_NOT_SAVED });
});

Deno.test('the ruled not-saved line', () => {
  assertEquals(PLAYOFF_TEAMS_NOT_SAVED, "Playoff teams weren't saved. Try again.");
});

Deno.test('the lock line IS League settings\' existing lock line (settingsSave), so the two never drift', () => {
  const settings = settingsSaveOutcome({ patchError: { message: 'league_rules_locked: x' }, slotsError: null });
  assertEquals(settings.message, PLAYOFF_TEAMS_LOCKED);
});

Deno.test('only a message that starts with a lock code is a lock', () => {
  assertEquals(isLeagueLockError({ message: 'playoff_teams_locked: …' }), true);
  assertEquals(isLeagueLockError({ message: 'league_slots_locked: …' }), false); // slots, not the playoff column
  assertEquals(isLeagueLockError({ message: 'something playoff_teams_locked' }), false);
  assertEquals(isLeagueLockError(null), false);
  assertEquals(isLeagueLockError({ message: 42 }), false);
});

Deno.test('the stepper (the shared auto-start hook: lobby and Home) goes through the outcome (source guard)', () => {
  assertEquals(hookSrc.includes('playoffTeamsSaveOutcome(res)'), true);
  assertEquals(hookSrc.includes("The playoff teams didn't change. Try again."), false);
});
