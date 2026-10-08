// Phase 3b-1 — DEV-ONLY fixture mode for design captures (Orchestrator,
// 2026-09-29): states that depend on prod data (the three-group league sheet,
// a NULL username, zero leagues) are captured from the board's own sample
// data instead of whatever prod accounts happen to hold.
//
// Safety:
// - Read only when __DEV__. Release bundles compile __DEV__ to false, so the
//   whole branch is dead code there and the env var is never consulted.
// - Enabled by EXPO_PUBLIC_SHELL_FIXTURE in apps/mobile/.env.local (gitignored;
//   Metro bakes .env files in at bundle time, see MOBILE_SIMULATOR.md). Unset
//   = the real app.
// - It fakes the SESSION and the LEAGUE LIST locally. It never signs in, never
//   calls Supabase for them, and never writes: SessionProvider skips
//   supabase.auth entirely and LeagueContext skips its queries.

import type { League } from '../LeagueContext';
import type { SheetLeague } from './leagueSheet';
import { USERNAME_RE } from './usernameRules';

/**
 * leagues      — signed in as roberto_b, in the board's four leagues
 * no-leagues   — signed in, in no leagues
 * no-username  — signed in with a NULL username (the Pick-a-username gate)
 * signed-out   — starts signed out: any sign-in succeeds locally (into
 *                `leagues`), and create-account gets the server's
 *                signups-paused refusal, so every auth state can be captured
 *                without typing a credential
 * onboarding   — like signed-out, but onboarding is shown on every launch
 * drafting     — signed in, in one league whose draft is in progress (the
 *                League tab's "Go to the draft room" state)
 * leagues-member — `leagues`, but Paolo M. (the seam's 'paolo') is every
 *                league's commissioner, so you are a member; and Serie A
 *                Traders' draft is three days out, so its leave window is
 *                open (the member's League settings and leave sheets, item 13)
 */
export type ShellFixture = 'leagues' | 'no-leagues' | 'no-username' | 'signed-out' | 'onboarding' | 'drafting' | 'leagues-member';

const FIXTURES: readonly ShellFixture[] = ['leagues', 'no-leagues', 'no-username', 'signed-out', 'onboarding', 'drafting', 'leagues-member'];

/** Fixtures that start signed out. */
export function fixtureStartsSignedOut(f: ShellFixture): boolean {
  return f === 'signed-out' || f === 'onboarding';
}

/** The Before User Created hook's refusal, as the fixture's sign-up returns it. */
export const FIXTURE_SIGNUPS_PAUSED_MESSAGE = 'Sign-ups are not open for new signups right now.';

/** Long enough to see a button's loading state in a capture. */
export const FIXTURE_NETWORK_MS = 900;

function parse(raw: string | undefined): ShellFixture | null {
  return raw && (FIXTURES as readonly string[]).includes(raw) ? (raw as ShellFixture) : null;
}

export const SHELL_FIXTURE: ShellFixture | null = __DEV__ ? parse(process.env.EXPO_PUBLIC_SHELL_FIXTURE) : null;

if (SHELL_FIXTURE) {
  console.warn(`[dev] SHELL FIXTURE "${SHELL_FIXTURE}" — fake session and leagues, no Supabase reads or writes for them.`);
}

import { FIXTURE_USER_ID } from './fixtureIds';
export { FIXTURE_USER_ID };
export const FIXTURE_EMAIL = 'roberto@example.com';
/** DEV-only XXXL capture seams (carry-overs 1-2, 2026-10-05): a long fixture
 * email and league name, so the email wrap and the league-pill wrap can be
 * checked at large text sizes. Read only under __DEV__; unset = the normal
 * fixture value. Fixture data only -- never a real account. */
export const FIXTURE_EMAIL_OVERRIDE: string | null = __DEV__ ? (process.env.EXPO_PUBLIC_SHELL_EMAIL || null) : null;
export const FIXTURE_LEAGUE_NAME_OVERRIDE: string | null = __DEV__ ? (process.env.EXPO_PUBLIC_SHELL_LEAGUE_NAME || null) : null;

export function fixtureUsername(fixture: ShellFixture): string | null {
  return fixture === 'no-username' ? null : 'roberto_b';
}

const DAY = 24 * 60 * 60 * 1000;

function league(over: Partial<League> & Pick<League, 'id' | 'name'>): League {
  return {
    invite_code: 'SCUD26',
    commissioner_id: FIXTURE_USER_ID,
    draft_status: 'completed',
    // The board's "Draft Sat 7:00 PM" (ET) -- harmless for a
    // draft_status:'completed' league (draft_date has no effect once the
    // draft is done), but needed so HOME_FIXTURE's pre_draft/
    // pre_draft_waiting states (an independent fixture axis from this
    // one, both keyed to whichever league the picker has active -- almost
    // always this one) have a real date/countdown to render instead of
    // silently hiding those lines for lack of one.
    draft_date: '2026-10-03T23:00:00Z',
    league_start_date: new Date(Date.now() - 40 * DAY).toISOString(),
    budget_mode: 'no-budget',
    stake_mode: 'fixed_notional',
    notional_per_slot: 1000,
    allow_undraftable: false,
    budget_amount: null,
    salary_cap_limit: null,
    num_participants: 6,
    num_rounds: 6,
    pick_seconds: 60,
    league_type: 'matchup',
    duration_days: null,
    num_weeks: 10,
    // Matches lib/home/homeFixtureData.ts's FIXTURE_LEAGUE.playoffTeams
    // (6) -- SeasonCard's week chips read `league.playoff_teams` (this
    // object) but the actual playoff week structure comes from HOME_
    // FIXTURE's own numbers, a fully independent fixture axis. A mismatch
    // here would silently produce the wrong round short-name (B7).
    playoff_teams: 6,
    current_week: 6,
    created_at: new Date(Date.now() - 50 * DAY).toISOString(),
    current_season_id: null,
    season_status: 'active',
    ...over,
  };
}

/** The board's leagues (docs/design/screens/data.js + inventory.jsx "League sheet"). */
export function fixtureLeagues(fixture: ShellFixture): { leagues: League[]; sheet: SheetLeague[] } {
  if (fixture === 'no-leagues') return { leagues: [], sheet: [] };
  if (fixture === 'drafting') {
    // One league, so it is necessarily the active one (no persisted id wins).
    const l = league({ id: 'fx-drafting', name: 'Serie A Traders', num_participants: 8, draft_status: 'in_progress', league_start_date: null, current_week: 1 });
    return {
      leagues: [l],
      sheet: [
        {
          marketOpen: true, ties: 0, isChampion: false, seasonLabel: '',
          currentWeek: l.current_week, numWeeks: l.num_weeks, playoffTeams: l.playoff_teams, draftDate: l.draft_date,
          id: l.id, name: l.name, seasonPhase: 'drafting', rank: null, rankCount: null, wins: 0, losses: 0, membersJoined: 8, capacity: 8,
        },
      ],
    };
  }

  // leagues-member: someone else is commissioner; the pre-draft league's draft is ahead (23:00Z, three days out).
  const member = fixture === 'leagues-member';
  const memberOver: Partial<League> = member ? { commissioner_id: 'paolo' } : {};
  const memberDraft = new Date(Math.floor((Date.now() + 3 * DAY) / DAY) * DAY + 23 * 60 * 60 * 1000).toISOString();
  const leagues = [
    league({ id: 'fx-scudetto', name: FIXTURE_LEAGUE_NAME_OVERRIDE ?? 'Stock Scudetto', ...memberOver }),
    league({ id: 'fx-friday', name: 'Friday Night Stocks', num_participants: 8, current_week: 2, ...memberOver }),
    league({
      id: 'fx-seriea',
      name: 'Serie A Traders',
      num_participants: 8,
      draft_status: 'not_started',
      draft_date: member ? memberDraft : '2026-10-03T23:00:00Z', // the board's "Draft Sat 7:00 PM" (ET)
      league_start_date: null,
      current_week: 1,
      ...memberOver,
    }),
    league({ id: 'fx-summer', name: 'Summer Cup', num_participants: 8, season_status: 'completed', current_week: 14, num_weeks: 14, ...memberOver }),
  ];

  const byId = new Map(leagues.map((l) => [l.id, l]));
  const facts = (id: string) => {
    const l = byId.get(id)!;
    return { currentWeek: l.current_week, numWeeks: l.num_weeks, playoffTeams: l.playoff_teams, draftDate: l.draft_date };
  };
  const base = { marketOpen: true, ties: 0, isChampion: false, seasonLabel: '' };
  const sheet: SheetLeague[] = [
    { ...base, ...facts('fx-scudetto'), id: 'fx-scudetto', name: FIXTURE_LEAGUE_NAME_OVERRIDE ?? 'Stock Scudetto', seasonPhase: 'regular', rank: 2, rankCount: 6, wins: 4, losses: 1, membersJoined: 6, capacity: 6 },
    { ...base, ...facts('fx-friday'), id: 'fx-friday', name: 'Friday Night Stocks', seasonPhase: 'regular', rank: 3, rankCount: 8, wins: 1, losses: 0, membersJoined: 8, capacity: 8 },
    { ...base, ...facts('fx-seriea'), id: 'fx-seriea', name: 'Serie A Traders', seasonPhase: 'pre_draft', rank: null, rankCount: null, wins: 0, losses: 0, membersJoined: 6, capacity: 8 },
    { ...base, ...facts('fx-summer'), id: 'fx-summer', name: 'Summer Cup', seasonPhase: 'completed', rank: 1, rankCount: 8, wins: 10, losses: 4, membersJoined: 8, capacity: 8, isChampion: true },
  ];

  return { leagues, sheet };
}

/** Names "other users" hold in the fixture — "roberto" makes the case-insensitive capture (Roberto vs roberto). */
const FIXTURE_TAKEN = ['roberto', 'roberto_26', 'rob'];

/** check_usernames' semantics, locally: case-insensitive, the caller's own name available. */
export function fixtureCheckUsernames(candidates: string[]): { username: string; status: 'available' | 'taken' | 'invalid' }[] {
  return candidates.slice(0, 10).map((username) => ({
    username,
    status: !USERNAME_RE.test(username)
      ? 'invalid'
      : FIXTURE_TAKEN.some((t) => t.toLowerCase() === username.toLowerCase())
        ? 'taken'
        : 'available',
  }));
}

export function fixtureSetUsername(name: string): 'ok' | 'taken' | 'invalid' {
  const { status } = fixtureCheckUsernames([name])[0];
  return status === 'available' ? 'ok' : status;
}
