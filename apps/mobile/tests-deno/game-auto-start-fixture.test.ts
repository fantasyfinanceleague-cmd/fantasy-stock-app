/**
 * The capture seam's auto-start fixtures (3c-2): one draft-control status per
 * start_state, each parsing to the lobby phase it's meant to show, with the
 * board's numbers. Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { DRAFT_START_FIXTURE_STATES, draftStartStatusFixture, parseDraftStartFixture } from '../lib/game/autoStartFixture.ts';
import { countdownCopy, deadlineCopy, fixableBlockers, lobbyPhase, parseStartStatus } from '../lib/game/autoStart.ts';
import { invokeFixtureFor } from '../lib/game/seamFixtures.ts';

const NOW = Date.parse('2026-10-03T12:00:00Z');

const EXPECTED_PHASE = {
  no_date: 'no_date', scheduled: 'scheduled', at_risk: 'at_risk', room_open: 'room_open',
  due: 'starting', postponed: 'postponed', started: 'started',
} as const;

Deno.test('every start_state has a fixture, and each shows its own phase', () => {
  assertEquals([...DRAFT_START_FIXTURE_STATES], ['no_date', 'scheduled', 'at_risk', 'room_open', 'due', 'postponed', 'started']);
  for (const state of DRAFT_START_FIXTURE_STATES) {
    const data = draftStartStatusFixture(state, false, NOW);
    const s = parseStartStatus(data);
    assertEquals(s.startState, state, state);
    assertEquals(lobbyPhase(s, NOW), EXPECTED_PHASE[state], state);
    assertEquals(data.ok, true, state);
  }
});

Deno.test('the fixtures carry the board\'s clocks', () => {
  const sched = parseStartStatus(draftStartStatusFixture('scheduled', false, NOW));
  assertEquals(countdownCopy('scheduled', sched.startsAt!, NOW).clock, '2d 06h 40m');
  const open = parseStartStatus(draftStartStatusFixture('room_open', false, NOW));
  assertEquals(countdownCopy('room_open', open.startsAt!, NOW).clock, '42:18');
  const risk = parseStartStatus(draftStartStatusFixture('at_risk', false, NOW));
  assertEquals(deadlineCopy(risk.startsAt!, NOW).clock, '58:12');
});

Deno.test('at risk and postponed carry the board\'s two blockers', () => {
  for (const state of ['at_risk', 'postponed'] as const) {
    const blockers = draftStartStatusFixture(state, false, NOW).blockers as { code: string }[];
    assertEquals(fixableBlockers(blockers).map((b) => b.code), ['roster_reconfirm_required', 'playoff_teams_exceeds_members'], state);
  }
  assertEquals(parseStartStatus(draftStartStatusFixture('postponed', false, NOW)).postponed?.stage, 'room_open');
});

Deno.test('the viewer: commissioner by default, ":member" for a member', () => {
  assertEquals(parseDraftStartFixture('postponed'), { state: 'postponed', member: false });
  assertEquals(parseDraftStartFixture('postponed:member'), { state: 'postponed', member: true });
  assertEquals(parseDraftStartFixture('bogus'), null);
  assertEquals(parseDraftStartFixture(undefined), null);
  assertEquals(draftStartStatusFixture('at_risk', true, NOW).is_commissioner, false);
});

Deno.test('the seam serves the picked fixture for status; start and confirm_roster succeed', () => {
  const status = invokeFixtureFor('draft-control', { action: 'status' }, 'room_open')!.data as Record<string, unknown>;
  assertEquals(status.start_state, 'room_open');
  assertEquals((invokeFixtureFor('draft-control', { action: 'start' }, 'due')!.data as { ok: boolean }).ok, true);
  assertEquals((invokeFixtureFor('draft-control', { action: 'confirm_roster', choice: 'move_forward' })!.data as { ok: boolean }).ok, true);
  // No fixture picked: the old generic status, unchanged.
  assertEquals((invokeFixtureFor('draft-control', { action: 'status' })!.data as { start_state?: string }).start_state, undefined);
});
