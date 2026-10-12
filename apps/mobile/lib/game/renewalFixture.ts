/**
 * Hermetic fixtures for Run it back (3c), shaped EXACTLY like get_renewal_roster
 * in PR #94's SQL (until the backend is live). Derived from one roster, the
 * board's Season 1 players: Roberto (commissioner, in), Paolo (in), Francesco
 * (in), Gianluigi (in), Alessandro (out), Andrea (pending), Marta C. (new). The
 * counts are computed from the people, never typed, so they cannot drift.
 */
import type { RenewalGroup, RenewalCounts } from './renewal';
import { FIXTURE_USER_ID } from '../shell/fixtureIds';

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

/** Who is calling get_renewal_roster: the commissioner (with a reply still pending, or
 * 'commissioner-ready' once everyone has answered: the review screen), a member who is
 * in / new / pending / out, 'in-set' (in, everyone has replied and the draft is set: no
 * Change, GS-10), 'removed' (out by the commissioner's Remove: no ask, GS-14), or someone
 * the roster is not visible to. EXPO_PUBLIC_RENEWAL_FIXTURE picks it. */
export type RenewalCaller = 'commissioner' | 'commissioner-ready' | 'in' | 'in-set' | 'new' | 'pending' | 'out' | 'removed' | 'stranger';
const CALLERS: readonly RenewalCaller[] = ['commissioner', 'commissioner-ready', 'in', 'in-set', 'new', 'pending', 'out', 'removed', 'stranger'];

export function parseRenewalCaller(raw: string | null | undefined): RenewalCaller | null {
  return raw && (CALLERS as readonly string[]).includes(raw) ? (raw as RenewalCaller) : null;
}

/** The caller after an answer through the seam's respond_to_renewal (DEV captures of the
 * flip: an out player taps I'm in and lands on the list; a member who is in changes to
 * out). Only a Season 1 player who can answer moves; everyone else stays put. Pure. */
export function callerAfterAnswer(caller: RenewalCaller, answer: 'in' | 'out' | null): RenewalCaller {
  if (answer === null) return caller;
  return caller === 'in' || caller === 'pending' || caller === 'out' ? answer : caller;
}

/** The seam's last answer (lib/game/seamCalls.ts), so the fixture roster follows it. */
let fixtureAnswer: 'in' | 'out' | null = null;
export function markFixtureAnswer(answer: unknown): void {
  if (answer === 'in' || answer === 'out') fixtureAnswer = answer;
}
export function fixtureAnswered(caller: RenewalCaller): RenewalCaller {
  return callerAfterAnswer(caller, fixtureAnswer);
}

/** The draft time the 'in-set' fixture's roster carries (the commissioner has scheduled). */
export const FIXTURE_SET_DRAFT_DATE = '2026-01-24T00:00:00Z';

/** The commissioner when the caller is a member: Paolo (as in the leagues-member shell fixture). */
export const RENEWAL_MEMBER_COMMISSIONER = 'paolo';

/** The shell fixture's Run it back facts (lib/shell/devFixture.ts fixtureLeagues): does
 * Summer Cup have its Season 2 (always in leagues-renewal; in leagues once the seam's
 * renew_league has answered), and who is commissioner of both seasons (you, unless the
 * caller is a member: then Paolo). Pure, so Deno tests it. */
export function renewalShellFacts(fixture: string, renewedBySeam: boolean, caller: RenewalCaller | null): { renewed: boolean; commissionerId: string } {
  const renewed = fixture === 'leagues-renewal' || (fixture === 'leagues' && renewedBySeam);
  const asMember = renewed && caller !== null && caller !== 'commissioner' && caller !== 'commissioner-ready';
  return { renewed, commissionerId: asMember ? RENEWAL_MEMBER_COMMISSIONER : FIXTURE_USER_ID };
}

/** The roster, as the caller sees it. "Me" is always the signed-in fixture user
 * (FIXTURE_USER_ID, Roberto B.): the commissioner by default, or a member in the
 * caller's group, with Paolo as commissioner. */
function roster(caller: RenewalCaller): { user_id: string; display_name: string; group: RenewalGroup; is_commissioner?: boolean }[] {
  const asCommissioner = caller === 'commissioner' || caller === 'commissioner-ready';
  const myGroup: RenewalGroup = caller === 'new' || caller === 'pending' || caller === 'out' ? caller : caller === 'removed' ? 'out' : 'in';
  const allReplied = caller === 'commissioner-ready' || caller === 'in-set';
  return [
    { user_id: FIXTURE_USER_ID, display_name: 'Roberto B.', group: myGroup, is_commissioner: asCommissioner },
    { user_id: RENEWAL_MEMBER_COMMISSIONER, display_name: 'Paolo M.', group: 'in', is_commissioner: !asCommissioner },
    { user_id: 'alessandro', display_name: 'Alessandro D.', group: 'out' },
    { user_id: 'francesco', display_name: 'Francesco T.', group: 'in' },
    { user_id: 'gianluigi', display_name: 'Gianluigi B.', group: 'in' },
    { user_id: 'andrea', display_name: 'Andrea P.', group: allReplied ? 'in' : 'pending' },
    { user_id: 'marta', display_name: 'Marta C.', group: 'new' },
  ];
}

export const FIXTURE_LEAGUE_ID = 'fixture-season-2';
export const FIXTURE_ASKED_AT = '2026-01-16T18:00:00Z';
export const FIXTURE_NUDGED_AT: string | null = '2026-01-17T14:00:00Z';

export function fixturePeople(now: Date, caller: RenewalCaller = 'commissioner'): FixturePerson[] {
  return roster(caller).map((p) => {
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
export function fixtureRoster(caller: RenewalCaller, now: Date) {
  if (caller === 'stranger') return { status: 'not_visible' as const };
  const people = fixturePeople(now, caller);
  if (caller === 'pending' || caller === 'out' || caller === 'removed') {
    return {
      status: 'ok' as const,
      league_id: FIXTURE_LEAGUE_ID,
      full_list: false as const,
      caller_status: caller === 'pending' ? ('pending' as const) : ('out' as const),
      caller_decided_by: caller === 'out' ? ('player' as const) : caller === 'removed' ? ('commissioner' as const) : null,
      draft_status: 'not_started',
      draft_date: null,
    };
  }
  // The caller's own status: my row's group (the SQL derives it from the caller's row).
  const callerStatus: RenewalGroup = people.find((p) => p.user_id === FIXTURE_USER_ID)!.group;
  const counts = fixtureCounts(people);
  return {
    status: 'ok' as const,
    league_id: FIXTURE_LEAGUE_ID,
    full_list: true as const,
    is_commissioner: caller === 'commissioner' || caller === 'commissioner-ready',
    caller_status: callerStatus,
    draft_status: 'not_started',
    draft_date: caller === 'in-set' ? FIXTURE_SET_DRAFT_DATE : null,
    counts,
    replies_pending: counts.pending > 0,
    people,
  };
}
