/**
 * Hermetic fixtures for Run it back (3c), shaped EXACTLY like get_renewal_roster
 * in PR #94's SQL (until the backend is live). Derived from one roster, the
 * board's Season 1 players: Roberto (commissioner, in), Paolo (in), Francesco
 * (in), Gianluigi (in), Alessandro (out), Andrea (pending), Marta C. (new). The
 * counts are computed from the people, never typed, so they cannot drift.
 */
import type { RenewalGroup, RenewalCounts } from './renewal';

export interface FixturePerson {
  user_id: string;
  display_name: string;
  group: RenewalGroup;
  is_commissioner: boolean;
  decided_by: 'player' | 'commissioner' | null;
  responded_at: string | null;
  nudge_count: number;
  last_nudged_at: string | null;
  can_nudge: boolean;
  can_remove: boolean;
}

const ROSTER: { user_id: string; display_name: string; group: RenewalGroup; is_commissioner?: boolean }[] = [
  { user_id: 'roberto', display_name: 'Roberto B.', group: 'in', is_commissioner: true },
  { user_id: 'paolo', display_name: 'Paolo M.', group: 'in' },
  { user_id: 'alessandro', display_name: 'Alessandro D.', group: 'out' },
  { user_id: 'francesco', display_name: 'Francesco T.', group: 'in' },
  { user_id: 'gianluigi', display_name: 'Gianluigi B.', group: 'in' },
  { user_id: 'andrea', display_name: 'Andrea P.', group: 'pending' },
  { user_id: 'marta', display_name: 'Marta C.', group: 'new' },
];

export const FIXTURE_LEAGUE_ID = 'fixture-season-2';
export const FIXTURE_ASKED_AT = '2026-01-16T18:00:00Z';
export const FIXTURE_NUDGED_AT: string | null = '2026-01-17T14:00:00Z';

export function fixturePeople(now: Date): FixturePerson[] {
  return ROSTER.map((p) => {
    const pending = p.group === 'pending';
    const answered = p.group === 'in' || p.group === 'out';
    const lastNudged = pending ? FIXTURE_NUDGED_AT : null;
    const nudgeable = pending && (lastNudged === null || now.getTime() - new Date(lastNudged).getTime() >= 24 * 60 * 60 * 1000);
    return {
      user_id: p.user_id,
      display_name: p.display_name,
      group: p.group,
      is_commissioner: p.is_commissioner === true,
      decided_by: answered ? 'player' : null,
      responded_at: answered ? FIXTURE_ASKED_AT : null,
      nudge_count: pending ? 1 : 0,
      last_nudged_at: lastNudged,
      can_nudge: nudgeable,
      can_remove: pending,
    };
  });
}

export function fixtureCounts(people: FixturePerson[]): RenewalCounts {
  const n = (g: RenewalGroup) => people.filter((p) => p.group === g).length;
  const inN = n('in');
  const newN = n('new');
  return { in: inN, new: newN, out: n('out'), pending: n('pending'), team_count: inN + newN, max_teams: 16 };
}

/** What get_renewal_roster returns to a caller, by who they are (SQL shape). */
export function fixtureRoster(caller: 'commissioner' | 'in' | 'new' | 'pending' | 'out' | 'stranger', now: Date) {
  if (caller === 'stranger') return { status: 'not_visible' as const };
  const people = fixturePeople(now);
  if (caller === 'pending' || caller === 'out') {
    return {
      status: 'ok' as const,
      league_id: FIXTURE_LEAGUE_ID,
      full_list: false as const,
      caller_status: caller,
      caller_decided_by: caller === 'out' ? ('player' as const) : null,
      draft_status: 'not_started',
      draft_date: null,
    };
  }
  const me = people.find((p) => p.user_id === (caller === 'commissioner' ? 'roberto' : caller === 'in' ? 'paolo' : 'marta'))!;
  const counts = fixtureCounts(people);
  return {
    status: 'ok' as const,
    league_id: FIXTURE_LEAGUE_ID,
    full_list: true as const,
    is_commissioner: caller === 'commissioner',
    caller_status: me.group,
    draft_status: 'not_started',
    draft_date: null,
    counts,
    replies_pending: counts.pending > 0,
    people,
  };
}
