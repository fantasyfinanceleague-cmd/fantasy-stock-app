// Account deletion (W4) — the delete screen's one line per league (board pick B). Pure.
//
// What happens to each league mirrors the server's scrub (plan 2026-10-21 › The system's side), decided from facts
// the app already reads: the leave window (lib/game/leaveLeague.ts, the same order of checks as the server), whether
// the person is the commissioner, and who else is in the league. Which line applies, in order:
//   1. a league they run with nobody else in it  -> deleted with the account (any window)
//   2. before the draft                          -> they simply leave it
//   3. a league they run, others in it           -> "{earliest member} becomes the commissioner."
//   4. a league they play in                     -> "The commissioner can hand it to a new manager."
//   5. a finished season                         -> "Your team stays as “Former manager”." alone: after the season
//      nothing is left to hand over (plan decision 9), so the approved sentence is cut BEFORE its second half.
// The successor is picked the way the server picks: earliest `joined_at`, then `user_id`; leavers, deleted seats
// and bots never count.

import { leaveWindow, type LeaveLeagueFacts, type LeaveWindow } from '../game/leaveLeague';
import { handOverLine, NO_OTHERS_LINE, NOT_DRAFTED_LINE, stayLine, successorLine } from './deleteCopy';

export interface LeagueMemberFact {
  user_id: string;
  joined_at: string | null;
  /** A leaver of a finished season (hidden_at set) is not a manager any more. */
  hidden: boolean;
  /** The seat's name from the server (get_league_display_names); null when unknown. */
  displayName: string | null;
  isBot: boolean;
  /** Already a deleted seat (its name is the placeholder). */
  deleted: boolean;
}

/** The earliest-joined OTHER live human manager: joined_at, then user_id (the server's rule). */
export function successorOf(members: readonly LeagueMemberFact[], meId: string): LeagueMemberFact | null {
  const others = members.filter((m) => m.user_id !== meId && !m.hidden && !m.deleted && !m.isBot);
  if (others.length === 0) return null;
  const at = (m: LeagueMemberFact) => {
    const t = m.joined_at ? new Date(m.joined_at).getTime() : NaN;
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  return others.slice().sort((a, b) => at(a) - at(b) || (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0))[0];
}

export interface DeleteLeagueInput {
  id: string;
  name: string;
  commissionerId: string | null;
  facts: LeaveLeagueFacts;
  members: readonly LeagueMemberFact[];
}

export interface DeleteLeagueLine {
  id: string;
  name: string;
  line: string;
  window: LeaveWindow;
}

export function leagueLine(league: DeleteLeagueInput, meId: string, label: string, nowMs: number): DeleteLeagueLine {
  const window = leaveWindow(league.facts, nowMs);
  const isCommissioner = league.commissionerId === meId;
  const successor = successorOf(league.members, meId);
  let line: string;
  if (isCommissioner && successor === null) line = NO_OTHERS_LINE;
  else if (window === 'before_draft') line = NOT_DRAFTED_LINE;
  else if (isCommissioner) {
    const name = successor?.displayName?.trim();
    line = name ? successorLine(label, name) : stayLine(label);
  } else if (window === 'after_season') line = stayLine(label);
  else line = handOverLine(label);
  return { id: league.id, name: league.name, line, window };
}
