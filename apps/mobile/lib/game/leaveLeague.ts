/**
 * Leaving a league, and handing over the commissioner's title (3c-2, item 13;
 * board #call-leave, ruled by Giorgio 2026-10-06; refusal lines from the UX
 * audit's Rule 8 table › leave-league). The leave-league edge function and its
 * RPCs (#126, #132) own every rule; this file only mirrors the window for the
 * row's display and maps outcomes to copy. The server is the gate: if the
 * client's window read is stale, the refusal shows the right line.
 *
 * The flow stays behind EXPO_PUBLIC_LEAVE_LEAGUE=1 (the kill switch). Pure: the
 * caller passes the flag value in, so the rule is testable without process.env.
 */
import type { FunctionRefusal } from '../functionRefusal';
import { etTimeLabel } from './autoStart';

export function leaveLeagueEnabled(flag: string | undefined): boolean {
  return flag === '1';
}

// ── Copy: the board's, verbatim, unless marked NEW ──────────────────────────
export const LEAVE_LEAGUE = 'Leave league'; // board
export const STAY = 'Stay'; // board
export const COMMISSIONER_ROW = 'Commissioner'; // board (League settings row)
export const COMMISSIONER_YOU = 'You'; // board (the commissioner's own row value)
/** The row while teams are locked in: before (T−1h on), during and after the draft, until the season ends. */
export const LEAVE_LOCKED_LINE = 'Teams are locked in from an hour before the draft until the season ends.'; // board, ruled
/** The commissioner's Leave row (Q4 = A, transfer first). */
export const LEAVE_COMMISSIONER_FIRST = 'Make someone else commissioner first.'; // board
export const WHO_TAKES_OVER = 'Who takes over as commissioner?'; // board (Q4 frame)
export const MEMBER_LINE = 'Member'; // board (Q4 frame)
/** The transfer sheet's title and the line under it (Design Lead, ruled). */
export const TRANSFER_TITLE = 'Make someone else commissioner';
export const TRANSFER_NOTE = 'The new commissioner takes over right away. You stay in the league.';
/** The transfer button once a manager is picked. NEW (the board's "Leave and hand over to {name}", minus the leave). */
export function handOverLabel(name: string): string {
  return `Hand over to ${name}`;
}
/** Before a pick the button can't name anyone, so it says what it does. NEW. */
export const HAND_OVER = 'Hand over';
export const TRANSFER_CANCEL = 'Cancel'; // NEW

// ── The window (mirrors _league_membership_window, 20261110000000) ─────────
export type LeaveWindow = 'before_draft' | 'locked_order_set' | 'locked_season' | 'after_season';

const HOUR_MS = 60 * 60 * 1000;

export interface LeaveLeagueFacts {
  seasonStatus: string | null | undefined;
  draftStatus: string | null | undefined;
  draftDate: string | null | undefined;
}

/** When the draft order is set: an hour before the draft time. */
export function orderSetAtMs(draftDate: string | null | undefined): number | null {
  if (!draftDate) return null;
  const t = new Date(draftDate).getTime();
  return Number.isNaN(t) ? null : t - HOUR_MS;
}

/** The same order of checks as the server: a finished season, a started draft,
 * then the order time. (The server also locks on an order already finalized;
 * the client can't see that, and the refusal covers it.) */
export function leaveWindow(l: LeaveLeagueFacts, nowMs: number): LeaveWindow {
  if (l.seasonStatus === 'completed') return 'after_season';
  if ((l.draftStatus ?? 'not_started') !== 'not_started') return 'locked_season';
  const orderAt = orderSetAtMs(l.draftDate);
  if (orderAt !== null && nowMs >= orderAt) return 'locked_order_set';
  return 'before_draft';
}

/** "Sat 6:00 PM ET" (the board's time format for the order). */
export function orderAtLabel(ms: number): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(ms));
  return `${day} ${etTimeLabel(ms)}`;
}

export interface LeaveRowView {
  enabled: boolean;
  sub: string | null;
}

/** Open, before the draft, with no draft time yet (Design Lead, ruled). */
export const LEAVE_UNTIL_NO_TIME = 'You can leave until an hour before the draft.';

/** The League settings row. Locked comes first (the same line for members and
 * the commissioner), then the commissioner's transfer-first, then open. Open
 * before the draft says until when. */
export function leaveRowView(window: LeaveWindow, isCommissioner: boolean, draftDate: string | null | undefined): LeaveRowView {
  if (window === 'locked_order_set' || window === 'locked_season') return { enabled: false, sub: LEAVE_LOCKED_LINE };
  if (isCommissioner) return { enabled: false, sub: LEAVE_COMMISSIONER_FIRST };
  if (window === 'before_draft') {
    const at = orderSetAtMs(draftDate);
    return { enabled: true, sub: at !== null ? `You can leave until ${orderAtLabel(at)}, when the draft order is set.` : LEAVE_UNTIL_NO_TIME };
  }
  return { enabled: true, sub: null };
}

/** The title can change hands only when a member could leave (PR #132: one window). */
export function transferAllowed(window: LeaveWindow): boolean {
  return window === 'before_draft' || window === 'after_season';
}

export interface LeaveSheetCopy {
  title: string;
  bullets: string[];
}

/** The leave sheet (board LeaveSheet "pre", LeaveFinished). Null while locked. */
export function leaveSheetCopy(
  window: LeaveWindow,
  l: { leagueName: string; commissionerName: string; seasonNumber: number | null | undefined; draftDate: string | null | undefined },
): LeaveSheetCopy | null {
  const title = `Leave ${l.leagueName}?`;
  if (window === 'before_draft') {
    const at = orderSetAtMs(l.draftDate);
    const bullets = [`${l.commissionerName} chooses whether to go ahead with one fewer team or invite someone new.`];
    if (at !== null) bullets.push(`You can rejoin with the invite code until ${orderAtLabel(at)}.`);
    return { title, bullets };
  }
  if (window === 'after_season') {
    // The season's number when known (board: "Season 1 stays …"); never a guessed "Season 1" (NEW fallback, flagged).
    const which = typeof l.seasonNumber === 'number' && l.seasonNumber > 0 ? `Season ${l.seasonNumber}` : 'Your season';
    return { title, bullets: ['It comes off your Home and Your leagues.', `${which} stays in the league’s History, with your record in it.`] };
  }
  return null;
}

// ── Outcomes (the audit's Rule 8 table › leave-league, verbatim) ───────────
export type LeaveOutcome =
  | { kind: 'left' }
  | { kind: 'hidden' }
  | { kind: 'transferred' }
  /** No answer, a server fault, or a status we don't know: the outcome is unknown. */
  | { kind: 'unknown' }
  | { kind: 'refused'; reason: string | null; line: string };

const DIDNT_GO_THROUGH = "That didn't go through.";
const REFUSAL_LINES: Record<string, string> = {
  locked_in: LEAVE_LOCKED_LINE,
  transfer_first: 'Make someone else commissioner first, then you can leave.',
  not_commissioner: 'Only the commissioner can hand over the title.',
  target_invalid: 'Pick a manager in this league.',
  not_member: "You're not in this league anymore.",
  successor_not_allowed: DIDNT_GO_THROUGH,
  bad_request: DIDNT_GO_THROUGH,
  rate_limited: 'Too many tries. Wait a moment, then try again.',
  not_authenticated: 'Your session ended. Sign in again.',
};
export const LEAVE_REFUSAL_REASONS: readonly string[] = Object.keys(REFUSAL_LINES);

/** What a leave or transfer call came to. No answer, a server fault (5xx,
 * 'unhandled'), or a status we don't know is UNKNOWN, never a guessed success
 * or failure: a leave re-reads your membership (leaveRecheck); a transfer says
 * "That didn't go through." (transferLine). */
export function leaveOutcome(r: FunctionRefusal): LeaveOutcome {
  if (r.transport) return { kind: 'unknown' };
  if (r.reason === null) {
    const status = r.body.status;
    if (status === 'left') return { kind: 'left' };
    if (status === 'hidden') return { kind: 'hidden' };
    if (status === 'transferred') return { kind: 'transferred' };
    return { kind: 'unknown' };
  }
  if (r.status === 401) return { kind: 'refused', reason: r.reason, line: REFUSAL_LINES.not_authenticated };
  if (r.reason === 'unhandled' || (r.status !== null && r.status >= 500)) return { kind: 'unknown' };
  return { kind: 'refused', reason: r.reason, line: REFUSAL_LINES[r.reason] ?? DIDNT_GO_THROUGH };
}

/** A transfer's unknown outcome: the title either moved or it didn't, and the
 * refreshed screen shows which; the line asks for nothing destructive. */
export function transferUnknownLine(): string {
  return DIDNT_GO_THROUGH;
}

/** The re-read could not confirm (Design Lead, ruled). */
export const LEAVE_UNCONFIRMED = "We couldn't confirm that. Check your connection, then try again.";

/** After a leave's UNKNOWN outcome, your own membership row decides (Design
 * Lead, ruled: leave is destructive, so never guess). You can always read your
 * own row (league_members_select_members: user_id = auth.uid()). No row: you
 * left. A hidden row: a finished league you hid. A shown row: still in. A
 * failed read: unconfirmed. */
export function leaveRecheck(
  read: { error: unknown; data: { hidden_at: string | null }[] | null },
  leagueName: string,
): LeaveOutcome {
  if (read.error || !read.data) return { kind: 'refused', reason: null, line: LEAVE_UNCONFIRMED };
  const row = read.data[0];
  if (!row) return { kind: 'left' };
  if (row.hidden_at) return { kind: 'hidden' };
  return { kind: 'refused', reason: null, line: `You're still in ${leagueName}. Try again.` };
}

// ── The transfer picker ────────────────────────────────────────────────────
export interface TransferCandidate {
  userId: string;
  name: string;
}

/** Current human members other than you (PR #132: never a bot, never yourself),
 * in the order the names came. A member with no name has no row (never a blank
 * radio). Nothing is preselected: the caller starts with no pick. */
export function transferCandidates(
  memberIds: readonly string[],
  names: readonly { user_id: string; display_name: string | null; is_bot?: boolean | null }[],
  me: string,
): TransferCandidate[] {
  const current = new Set(memberIds.map(String));
  return names
    .filter((n) => current.has(String(n.user_id)) && String(n.user_id) !== me && !n.is_bot && !String(n.user_id).startsWith('bot-'))
    .filter((n) => (n.display_name ?? '').trim() !== '')
    .map((n) => ({ userId: String(n.user_id), name: (n.display_name as string).trim() }));
}
