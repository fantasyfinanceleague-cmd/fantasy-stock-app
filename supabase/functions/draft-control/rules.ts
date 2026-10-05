/**
 * Pure preconditions for draft-control (mobile launch-blocker: the only code
 * path that started a draft or added bots was web, which is paused — see
 * docs/STATUS.md §4). No DB, no Deno runtime APIs — hermetically tested in
 * rules.test.ts.
 *
 * Mirrors web's DraftPage.jsx rules (REQUIRE_DRAFT_DATE, MIN_PARTICIPANTS,
 * DraftSetupModal's bot-id generation) so the server enforces exactly what the
 * web UI used to imply, rather than inventing new behaviour.
 */

import { isValidPlayoffTeams } from '../_shared/playoff-bracket.ts';

/** Members needed (people + bots) to start a draft — matches web's
 * MIN_PARTICIPANTS and sits at the floor of leagues_num_participants_range
 * (20250819185319_leagues_rules.sql: 4..16). Product decision (2026-09-25,
 * Giorgio): fixed at 4, not commissioner-adjustable — web allowed lowering it
 * to 2, but bots stay test-account-only here, so a real launch league must
 * reach 4 humans, or a test-account commissioner tops it up with bots. */
export const MIN_DRAFT_MEMBERS = 4;

export type DraftStatus = 'not_started' | 'in_progress' | 'completed';

export interface LeagueStartState {
  commissionerId: string;
  draftStatus: DraftStatus;
  stakeMode: string | null;
  memberCount: number;
  numParticipants: number; // the CAP (leagues.num_participants), not the floor
  draftDate: string | null; // ISO, or null = TBD
  leagueType: string | null; // leagues.league_type: 'matchup' | 'duration'
  playoffTeams: number | null; // leagues.playoff_teams, as stored (no default)
  /** Run it back (20261027000002): how many Season 1 invitees have not answered
   * yet. Counted by the server (pending rows), never inferred. Optional so
   * ordinary leagues need no value; undefined means 0. */
  renewalRepliesPending?: number;
}

export type StartBlocker =
  | { code: 'not_started_state'; draftStatus: DraftStatus }
  | { code: 'no_stake_mode' }
  | { code: 'no_draft_date' }
  | { code: 'draft_date_not_reached'; draftDate: string }
  | { code: 'not_enough_members'; have: number; need: number }
  | { code: 'invalid_playoff_teams'; playoffTeams: number | null }
  | { code: 'playoff_teams_exceeds_members'; playoffTeams: number; members: number }
  | { code: 'renewal_replies_pending'; pending: number };

/**
 * Every reason the draft cannot start right now, in a stable order (state,
 * then stake mode, then date, then headcount, then playoff spots vs headcount) so the UI can show the most
 * fundamental blocker first. Empty = startable.
 *
 * Q3 (2026-09-25, Giorgio): starting REQUIRES draft_date to be set AND
 * reached — same as web's REQUIRE_DRAFT_DATE=true. A TBD date and a
 * not-yet-reached date are distinct blockers so the UI can tell "set a date"
 * from "wait until <time>".
 */
export function computeStartBlockers(state: LeagueStartState, now: Date): StartBlocker[] {
  const blockers: StartBlocker[] = [];

  if (state.draftStatus !== 'not_started') {
    blockers.push({ code: 'not_started_state', draftStatus: state.draftStatus });
  }
  if (!state.stakeMode) {
    blockers.push({ code: 'no_stake_mode' });
  }
  if (!state.draftDate) {
    blockers.push({ code: 'no_draft_date' });
  } else if (new Date(state.draftDate).getTime() > now.getTime()) {
    blockers.push({ code: 'draft_date_not_reached', draftDate: state.draftDate });
  }
  if (state.memberCount < MIN_DRAFT_MEMBERS) {
    blockers.push({ code: 'not_enough_members', have: state.memberCount, need: MIN_DRAFT_MEMBERS });
  } else if (state.leagueType === 'matchup' && !isValidPlayoffTeams(state.playoffTeams)) {
    // playoff_teams is required on matchup leagues (20261012000000) and is used
    // AS STORED, with no default: planSeason and the season-end seeding refuse
    // an invalid value too, so a league that got here could never finish its
    // season. (It used to read NULL/0 as 4 via `playoff_teams || 4`.)
    blockers.push({ code: 'invalid_playoff_teams', playoffTeams: state.playoffTeams });
  } else if (state.leagueType === 'matchup' && state.playoffTeams! > state.memberCount) {
    // Product rule (Giorgio, 2026-09-29): playoff spots may EQUAL the number of
    // managers but never exceed it. A league that started with more spots than
    // managers reaches the end of its regular season and cannot be seeded;
    // process-week-results refuses that transition every run
    // ('standings_rank_refused: N ranked managers for M playoff spots'), which
    // is the last-line guard. This is the prevention: start-time is the right
    // place because membership is frozen once the draft starts
    // (join_league_by_code's draft guard), and "playoff_teams <= member
    // count" spans two tables, so it cannot be a single-row CHECK.
    // Only evaluated once the headcount floor is met, so the UI shows one
    // headcount problem at a time.
    blockers.push({
      code: 'playoff_teams_exceeds_members',
      playoffTeams: state.playoffTeams!,
      members: state.memberCount,
    });
  }
  // Run it back: no start while any invitee has not answered. The DB gate
  // (trg_leagues_renewal_gate) enforces the same predicate for every role; this
  // blocker gives the commissioner the reason instead of a raised error. Last,
  // so the fundamental blockers above are shown first.
  if ((state.renewalRepliesPending ?? 0) > 0) {
    blockers.push({ code: 'renewal_replies_pending', pending: state.renewalRepliesPending! });
  }

  return blockers;
}

export function canStartDraft(state: LeagueStartState, now: Date): boolean {
  return computeStartBlockers(state, now).length === 0;
}

export function isCommissioner(state: Pick<LeagueStartState, 'commissionerId'>, callerId: string): boolean {
  return state.commissionerId === callerId;
}

/** How many bots would need to be added to reach MIN_DRAFT_MEMBERS, capped at
 * the league's own num_participants (never overshoot the league's own team
 * count). 0 means bots are not needed (or the league is already at/above the
 * cap and cannot take more members at all). */
export function computeBotsNeeded(memberCount: number, numParticipants: number): number {
  const target = Math.min(MIN_DRAFT_MEMBERS, numParticipants);
  return Math.max(target - memberCount, 0);
}

/**
 * Generate `count` fresh bot member ids that don't collide with
 * `existingMemberIds` or each other. Same shape as web's
 * DraftPage.jsx fillWithBots (`bot-N`, then `bot-N-suffix` on collision) so a
 * league that mixes web-added and server-added bots never collides.
 */
export function nextBotIds(existingMemberIds: string[], count: number): string[] {
  const taken = new Set(existingMemberIds);
  const ids: string[] = [];
  let i = 1;
  while (ids.length < count) {
    let candidate = `bot-${i}`;
    let suffix = 1;
    while (taken.has(candidate)) {
      candidate = `bot-${i}-${suffix++}`;
    }
    taken.add(candidate);
    ids.push(candidate);
    i++;
  }
  return ids;
}

/**
 * Is this caller allowed to add bots at all? Env-driven allowlist
 * (DRAFT_BOTS_ALLOWED_EMAILS, comma-separated, case-insensitive) so Giorgio
 * can widen or narrow it with `supabase secrets set` alone — no redeploy, no
 * code change. Product decision (2026-09-25): defaults to the test account
 * only; "*" opts every commissioner in, but nothing here ships that value —
 * it is a deploy-time secret, never a code default.
 */
export function isBotsAllowedForEmail(allowlistEnv: string | null | undefined, email: string | null | undefined): boolean {
  if (!allowlistEnv || !email) return false;
  const entries = allowlistEnv.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (entries.includes('*')) return true;
  return entries.includes(email.trim().toLowerCase());
}
