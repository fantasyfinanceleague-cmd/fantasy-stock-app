/**
 * Hermetic unit tests for draft-control/rules.ts. No DB, no Deno runtime
 * APIs — run:
 *
 *   deno test supabase/functions/draft-control/rules.test.ts
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import {
  canStartDraft,
  computeBotsNeeded,
  computeStartBlockers,
  isBotsAllowedForEmail,
  isCommissioner,
  type LeagueStartState,
  MIN_DRAFT_MEMBERS,
  nextBotIds,
  toRosterReconfirm,
} from './rules.ts';

const NOW = new Date('2026-10-01T00:00:00Z');

function startState(overrides: Partial<LeagueStartState> = {}): LeagueStartState {
  return {
    commissionerId: 'commish-1',
    draftStatus: 'not_started',
    stakeMode: 'budget_cap',
    memberCount: MIN_DRAFT_MEMBERS,
    numParticipants: 8,
    draftDate: '2026-09-30T00:00:00Z', // in the past relative to NOW
    leagueType: 'matchup',
    playoffTeams: 4,
    ...overrides,
  };
}

Deno.test('computeStartBlockers: fully satisfied state has no blockers', () => {
  assertEquals(computeStartBlockers(startState(), NOW), []);
  assert(canStartDraft(startState(), NOW));
});

Deno.test('computeStartBlockers: draft already started or completed blocks', () => {
  const blockers = computeStartBlockers(startState({ draftStatus: 'in_progress' }), NOW);
  assertEquals(blockers, [{ code: 'not_started_state', draftStatus: 'in_progress' }]);
});

Deno.test('computeStartBlockers: no stake mode blocks', () => {
  const blockers = computeStartBlockers(startState({ stakeMode: null }), NOW);
  assertEquals(blockers, [{ code: 'no_stake_mode' }]);
});

Deno.test('computeStartBlockers: TBD draft date blocks with no_draft_date', () => {
  const blockers = computeStartBlockers(startState({ draftDate: null }), NOW);
  assertEquals(blockers, [{ code: 'no_draft_date' }]);
});

Deno.test('computeStartBlockers: future draft date blocks with draft_date_not_reached', () => {
  const future = '2026-10-02T00:00:00Z';
  const blockers = computeStartBlockers(startState({ draftDate: future }), NOW);
  assertEquals(blockers, [{ code: 'draft_date_not_reached', draftDate: future }]);
});

Deno.test('computeStartBlockers: draft date exactly at now is reached, not blocked', () => {
  const blockers = computeStartBlockers(startState({ draftDate: NOW.toISOString() }), NOW);
  assertEquals(blockers, []);
});

Deno.test('computeStartBlockers: too few members blocks with counts', () => {
  const blockers = computeStartBlockers(startState({ memberCount: 2 }), NOW);
  assertEquals(blockers, [{ code: 'not_enough_members', have: 2, need: MIN_DRAFT_MEMBERS }]);
});

Deno.test('computeStartBlockers: multiple blockers all reported, in order', () => {
  const blockers = computeStartBlockers(
    startState({ draftStatus: 'in_progress', stakeMode: null, draftDate: null, memberCount: 1 }),
    NOW,
  );
  assertEquals(blockers.map((b) => b.code), [
    'not_started_state',
    'no_stake_mode',
    'no_draft_date',
    'not_enough_members',
  ]);
});

Deno.test('isCommissioner: exact match only', () => {
  assert(isCommissioner({ commissionerId: 'a' }, 'a'));
  assert(!isCommissioner({ commissionerId: 'a' }, 'b'));
});

Deno.test('computeBotsNeeded: tops up to MIN_DRAFT_MEMBERS', () => {
  assertEquals(computeBotsNeeded(1, 8), MIN_DRAFT_MEMBERS - 1);
  assertEquals(computeBotsNeeded(MIN_DRAFT_MEMBERS, 8), 0);
  assertEquals(computeBotsNeeded(MIN_DRAFT_MEMBERS + 1, 8), 0);
});

Deno.test('computeBotsNeeded: never exceeds the league own num_participants cap', () => {
  // A 2-team league can never reach MIN_DRAFT_MEMBERS(4) via bots.
  assertEquals(computeBotsNeeded(1, 2), 1);
  assertEquals(computeBotsNeeded(2, 2), 0);
});

Deno.test('nextBotIds: sequential bot-N ids with no existing members', () => {
  assertEquals(nextBotIds([], 3), ['bot-1', 'bot-2', 'bot-3']);
});

Deno.test('nextBotIds: skips collisions with existing members (web bot-id shape)', () => {
  assertEquals(nextBotIds(['bot-1', 'bot-2'], 2), ['bot-1-1', 'bot-2-1']);
});

Deno.test('nextBotIds: skips collisions across the newly generated batch too', () => {
  // bot-1 and bot-1-1 already taken -> next must be bot-1-2, not another
  // bot-1-1.
  assertEquals(nextBotIds(['bot-1', 'bot-1-1'], 1), ['bot-1-2']);
});

Deno.test('isBotsAllowedForEmail: no allowlist configured denies everyone', () => {
  assert(!isBotsAllowedForEmail(null, 'a@example.com'));
  assert(!isBotsAllowedForEmail('', 'a@example.com'));
});

Deno.test('isBotsAllowedForEmail: exact email match, case-insensitive', () => {
  assert(isBotsAllowedForEmail('fantasyfinanceleague@gmail.com', 'FantasyFinanceLeague@gmail.com'));
  assert(!isBotsAllowedForEmail('fantasyfinanceleague@gmail.com', 'someoneelse@example.com'));
});

Deno.test('isBotsAllowedForEmail: comma-separated list', () => {
  const list = 'a@example.com, b@example.com';
  assert(isBotsAllowedForEmail(list, 'b@example.com'));
  assert(!isBotsAllowedForEmail(list, 'c@example.com'));
});

Deno.test('isBotsAllowedForEmail: "*" allows every caller (never a code default — deploy-time only)', () => {
  assert(isBotsAllowedForEmail('*', 'anyone@example.com'));
  assert(!isBotsAllowedForEmail('*', null));
});

// ---------------------------------------------------------------------------
// Playoff spots vs managers (Giorgio, 2026-09-29): equal is fine, more is not
// ---------------------------------------------------------------------------

Deno.test('playoff spots EQUAL to the member count may start', () => {
  assertEquals(computeStartBlockers(startState({ memberCount: 4, playoffTeams: 4 }), NOW), []);
  assertEquals(computeStartBlockers(startState({ memberCount: 8, playoffTeams: 8 }), NOW), []);
});

Deno.test('more playoff spots than members blocks with both numbers', () => {
  const blockers = computeStartBlockers(startState({ memberCount: 5, playoffTeams: 8 }), NOW);
  assertEquals(blockers, [{ code: 'playoff_teams_exceeds_members', playoffTeams: 8, members: 5 }]);
  assertEquals(canStartDraft(startState({ memberCount: 5, playoffTeams: 8 }), NOW), false);
});

Deno.test('NULL / 0 / 1 / fractional playoff_teams on a matchup league blocks (no silent default)', () => {
  // playoff_teams is required on matchup leagues (20261012000000); planSeason and
  // the season-end seeding refuse an invalid value too, so starting would strand
  // the season. It used to read NULL/0 as 4.
  for (const playoffTeams of [null, 0, 1, 2.5]) {
    assertEquals(computeStartBlockers(startState({ memberCount: 4, playoffTeams }), NOW), [
      { code: 'invalid_playoff_teams', playoffTeams },
    ]);
  }
  assertEquals(computeStartBlockers(startState({ memberCount: 4, playoffTeams: 2 }), NOW), []);
  assertEquals(computeStartBlockers(startState({ memberCount: 4, playoffTeams: 3 }), NOW), [], 'any P from 2, not just 2/4/8');
});

Deno.test('flexible P: every P from 2 to the member count may start; one more may not', () => {
  for (let members = 4; members <= 16; members++) {
    for (let p = 2; p <= members; p++) {
      assertEquals(computeStartBlockers(startState({ memberCount: members, playoffTeams: p }), NOW), [], `P=${p} members=${members}`);
    }
    assertEquals(computeStartBlockers(startState({ memberCount: members, playoffTeams: members + 1 }), NOW), [
      { code: 'playoff_teams_exceeds_members', playoffTeams: members + 1, members },
    ]);
  }
});

Deno.test('duration leagues have no playoffs and are never blocked on playoff spots', () => {
  assertEquals(computeStartBlockers(startState({ leagueType: 'duration', memberCount: 4, playoffTeams: 8 }), NOW), []);
});

Deno.test('below the headcount floor only the headcount blocker is shown', () => {
  const blockers = computeStartBlockers(startState({ memberCount: 3, playoffTeams: 8 }), NOW);
  assertEquals(blockers, [{ code: 'not_enough_members', have: 3, need: MIN_DRAFT_MEMBERS }]);
});

Deno.test('computeStartBlockers: a pending roster reconfirmation blocks, right after the state blocker', () => {
  const rc = { departed: [{ userId: 'u-sam', name: 'Sam' }], membersBefore: 5 };
  assertEquals(computeStartBlockers(startState({ rosterReconfirm: rc }), NOW), [
    { code: 'roster_reconfirm_required', departed: rc.departed, membersBefore: 5, members: MIN_DRAFT_MEMBERS },
  ]);
  assert(!canStartDraft(startState({ rosterReconfirm: rc }), NOW));
  const codes = computeStartBlockers(
    startState({ draftStatus: 'in_progress', stakeMode: null, rosterReconfirm: rc }),
    NOW,
  ).map((b) => b.code);
  assertEquals(codes.slice(0, 3), ['not_started_state', 'roster_reconfirm_required', 'no_stake_mode']);
  // null / absent = nothing owed
  assertEquals(computeStartBlockers(startState({ rosterReconfirm: null }), NOW), []);
});

Deno.test('toRosterReconfirm: maps the row; a malformed payload still blocks (fail closed)', () => {
  assertEquals(toRosterReconfirm(null), null);
  assertEquals(toRosterReconfirm(undefined), null);
  assertEquals(
    toRosterReconfirm({ departed: [{ user_id: 'a', name: 'Al', left_at: 'x' }, { user_id: 'b', name: 'Bo' }], members_before: 6 }),
    { departed: [{ userId: 'a', name: 'Al' }, { userId: 'b', name: 'Bo' }], membersBefore: 6 },
  );
  assertEquals(toRosterReconfirm({ departed: 'garbage', members_before: 'x' }), { departed: [], membersBefore: 0 });
  assertEquals(toRosterReconfirm({ departed: [null, 3, { name: 'no id' }], members_before: 4 }), { departed: [], membersBefore: 4 });
  // A row with junk still yields a non-null value, so the blocker fires.
  assert(computeStartBlockers(startState({ rosterReconfirm: toRosterReconfirm({}) }), NOW).length === 1);
});
