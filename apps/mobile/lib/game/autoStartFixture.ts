/**
 * Draft auto-start fixtures for the capture seam (3c-2): a draft-control
 * `status` response for every start_state, relative to `now`, shaped like the
 * real one (feat/draft-auto-start draft-control/index.ts). Pure, so the rules
 * tests see them. Picked with EXPO_PUBLIC_DRAFT_START_FIXTURE=<state>, or
 * <state>:member for a member's view (dev builds with the seam on only).
 * Sample: the board's Serie A Traders (Sofia F. left; 8 playoff teams, 7 in).
 */
import type { StartState } from './autoStart';

const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

export const DRAFT_START_FIXTURE_STATES: readonly StartState[] = ['no_date', 'scheduled', 'at_risk', 'room_open', 'due', 'postponed', 'started'];

/** "at_risk" / "postponed:member" → the state and the viewer; null if unknown. */
export function parseDraftStartFixture(raw: string | null | undefined): { state: StartState; member: boolean } | null {
  if (!raw) return null;
  const [state, who] = raw.split(':');
  if (!(DRAFT_START_FIXTURE_STATES as readonly string[]).includes(state)) return null;
  return { state: state as StartState, member: who === 'member' };
}

const SOFIA_LEFT = { code: 'roster_reconfirm_required', departed: [{ name: 'Sofia F.' }], membersBefore: 8, members: 7, choice: 'pending' };
const PLAYOFF_8_OF_7 = { code: 'playoff_teams_exceeds_members', playoffTeams: 8, members: 7 };

export function draftStartStatusFixture(state: StartState, member: boolean, nowMs: number): Record<string, unknown> {
  const base = { ok: true, is_commissioner: !member, bots_allowed: false, bots_needed: 0, member_count: 7, min_members: 4, postponed: null };
  const notReached = (t: number) => ({ code: 'draft_date_not_reached', draftDate: iso(t) });
  switch (state) {
    case 'no_date':
      return { ...base, can_start: false, start_state: 'no_date', starts_at: null, blockers: [{ code: 'no_draft_date' }] };
    case 'scheduled': {
      const t = nowMs + 2 * 24 * HOUR + 6 * HOUR + 40 * MIN + 30_000; // "2d 06h 40m"
      return { ...base, can_start: false, start_state: 'scheduled', starts_at: iso(t), blockers: [notReached(t)] };
    }
    case 'at_risk': {
      const t = nowMs + HOUR + 58 * MIN + 12_000; // the room opens in "58:12"
      return { ...base, can_start: false, start_state: 'at_risk', starts_at: iso(t), blockers: [SOFIA_LEFT, PLAYOFF_8_OF_7, notReached(t)] };
    }
    case 'room_open': {
      const t = nowMs + 42 * MIN + 18_000; // "42:18"
      return { ...base, can_start: false, start_state: 'room_open', starts_at: iso(t), blockers: [notReached(t)] };
    }
    case 'due':
      return { ...base, can_start: true, start_state: 'due', starts_at: iso(nowMs - 3000), blockers: [] };
    case 'postponed': {
      const from = nowMs - 10 * MIN; // the room would have opened 70 min ago
      return {
        ...base,
        can_start: false,
        start_state: 'postponed',
        starts_at: null,
        postponed: { from: iso(from + HOUR), stage: 'room_open', reason: 'roster_reconfirm_required' },
        blockers: [SOFIA_LEFT, PLAYOFF_8_OF_7, { code: 'no_draft_date' }, { code: 'draft_postponed' }],
      };
    }
    case 'started':
      return { ...base, can_start: false, start_state: 'started', starts_at: iso(nowMs - 5 * MIN), blockers: [{ code: 'not_started_state', draftStatus: 'in_progress' }] };
  }
}
