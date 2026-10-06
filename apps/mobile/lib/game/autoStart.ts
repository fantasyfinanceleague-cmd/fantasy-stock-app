/**
 * Draft auto-start, the client's rules (3c-2; backend feat/draft-auto-start,
 * board #call-auto-start "The draft starts by itself (decided)", docs/PRODUCT_RULES.md
 * › Draft). Pure, so the rules tests see them.
 *
 * Giorgio's rules: no manual Start. "Draft starts in …" once a date is set; the
 * room opens at T−1h (the order is set); the draft starts by itself at T. The
 * gate is the room-open time: still blocked then, the draft is POSTPONED for
 * everyone and the commissioner picks a new time. Draft times sit on 15-minute
 * steps, at least an hour out, and can't change once the room opens (except
 * when postponed).
 *
 * The phase comes from the SERVER (draft-control status: start_state, judged on
 * the server's clock) plus the server's clock offset, never the phone's clock
 * alone. Copy: the board's strings verbatim (its own mix of ’ and '); anything
 * marked NEW is flagged for the Design Lead.
 */
import { etDateParts } from '../time/etParts';
import { defaultDraftDate } from './draftDateSave';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
/** The room opens this long before the draft (ROOM_OPEN_LEAD_SECONDS server-side). */
export const ROOM_OPEN_LEAD_MS = HOUR;
/** Draft times sit on this grid (DRAFT_TIME_STEP_MINUTES). */
export const DRAFT_TIME_STEP_MINUTES = 15;

export type StartState = 'no_date' | 'scheduled' | 'at_risk' | 'room_open' | 'due' | 'postponed' | 'started';
const START_STATES: readonly StartState[] = ['no_date', 'scheduled', 'at_risk', 'room_open', 'due', 'postponed', 'started'];

export interface Postponed {
  from: string | null;
  stage: string | null;
  reason: string | null;
}

export interface StartStatus {
  /** Null when the server didn't send one (an older draft-control). */
  startState: StartState | null;
  startsAt: string | null;
  postponed: Postponed | null;
}

/** draft-control status → the auto-start fields. Unknown values are null, never guessed. */
export function parseStartStatus(data: Record<string, unknown> | null | undefined): StartStatus {
  const raw = data?.start_state;
  const startState = typeof raw === 'string' && (START_STATES as readonly string[]).includes(raw) ? (raw as StartState) : null;
  const startsAt = typeof data?.starts_at === 'string' ? data.starts_at : null;
  const p = data?.postponed as Record<string, unknown> | null | undefined;
  const postponed = p && typeof p === 'object'
    ? {
      from: typeof p.from === 'string' ? p.from : null,
      stage: typeof p.stage === 'string' ? p.stage : null,
      reason: typeof p.reason === 'string' ? p.reason : null,
    }
    : null;
  return { startState, startsAt, postponed };
}

// ── The server clock ─────────────────────────────────────────────────────

/** The server's clock minus the phone's, from a read that carried server_now
 * (get_draft_clock, as the draft room does). 0 when there is none. */
export function serverOffsetMs(serverNowIso: string | null | undefined, receivedAtMs: number): number {
  if (!serverNowIso) return 0;
  const t = new Date(serverNowIso).getTime();
  return Number.isNaN(t) ? 0 : t - receivedAtMs;
}

// ── The lobby's phase ────────────────────────────────────────────────────

/** What the lobby shows. `starting` = the start time has come (the countdown
 * reads 00:00, any member's phone asks the server to start, and polls). */
export type LobbyPhase = 'no_date' | 'scheduled' | 'at_risk' | 'room_open' | 'starting' | 'postponed' | 'started';

/** The server's state, carried forward on the server clock between reads: a
 * countdown that crosses T−1h or T moves on by itself (and the caller re-reads
 * at those boundaries). The server's word wins for started / postponed /
 * no_date / at_risk; a missing start_state (an older server) is derived from
 * the time alone. */
export function lobbyPhase(status: Pick<StartStatus, 'startState' | 'startsAt'>, serverNowMs: number): LobbyPhase {
  const s = status.startState;
  if (s === 'started') return 'started';
  if (s === 'postponed') return 'postponed';
  if (s === 'no_date' || !status.startsAt) return 'no_date';
  const t = new Date(status.startsAt).getTime();
  if (Number.isNaN(t)) return 'no_date';
  if (s === 'at_risk' && serverNowMs < t) return 'at_risk'; // the gate decides at T−1h; re-read then
  if (serverNowMs >= t) return 'starting';
  if (serverNowMs >= t - ROOM_OPEN_LEAD_MS) return 'room_open';
  return 'scheduled';
}

/** The next time the phase can change on its own (T−1h, then T), to re-read
 * the status then. Null when nothing is pending. */
export function nextBoundaryMs(startsAt: string | null, serverNowMs: number): number | null {
  if (!startsAt) return null;
  const t = new Date(startsAt).getTime();
  if (Number.isNaN(t)) return null;
  for (const b of [t - ROOM_OPEN_LEAD_MS, t]) if (b > serverNowMs) return b;
  return null;
}

/** The countdown target for a phase: T for everyone; the room-open time for
 * the commissioner's at-risk deadline. */
export function roomOpensAtMs(startsAt: string): number {
  return new Date(startsAt).getTime() - ROOM_OPEN_LEAD_MS;
}

// ── The countdown ────────────────────────────────────────────────────────

/** The board's clock: "2d 06h 40m" / "6h 40m" at an hour or more (to the
 * minute, rounded down); "42:18" under an hour (to the second, rounded up, so
 * it reads 00:00 only at the moment itself); "00:00" at and past it. */
export function startClock(msLeft: number): string {
  if (msLeft <= 0) return '00:00';
  const pad = (n: number) => String(n).padStart(2, '0');
  if (msLeft < HOUR) {
    const secs = Math.ceil(msLeft / 1000);
    if (secs >= 3600) return '1h 00m';
    return `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  }
  const totalMinutes = Math.floor(msLeft / MIN);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  return `${hours}h ${pad(minutes)}m`;
}

// ── ET labels (Hermes: hourCycle pinned; .format() only for times) ──────

const ET = 'America/New_York';

/** "6:00 PM ET". */
export function etTimeLabel(ms: number): string {
  const t = new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).format(new Date(ms));
  return `${t} ET`;
}

/** "Sat, Oct 3 · 7:00 PM ET" (the board's draft time). */
export function etWhenLabel(ms: number): string {
  const d = new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms));
  return `${d} · ${etTimeLabel(ms)}`;
}

/** "Today" / "Tomorrow" / "Thu, Oct 1", by the ET calendar date. */
export function etDayWord(ms: number, nowMs: number): string {
  const day = etDateParts(new Date(ms));
  const today = etDateParts(new Date(nowMs));
  if (day && today) {
    const key = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
    const diff = Math.round((key(day.year, day.month, day.day) - key(today.year, today.month, today.day)) / (24 * HOUR));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
  }
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms));
}

// ── The countdown card (everyone) ────────────────────────────────────────

export interface CountdownCopy {
  tag: string;
  clock: string;
  /** Shown with a spinner (the starting phase). */
  starting: string | null;
  lines: string[];
}

/** Board AutoLobby: before the room, room open, at 0. */
export function countdownCopy(phase: 'scheduled' | 'room_open' | 'starting', startsAt: string, serverNowMs: number): CountdownCopy {
  const t = new Date(startsAt).getTime();
  const auto = `The draft starts automatically at ${etWhenLabel(t)}.`;
  if (phase === 'starting') return { tag: 'Draft starts in', clock: '00:00', starting: 'Starting the draft', lines: [] };
  if (phase === 'room_open') return { tag: 'Draft room open · starts in', clock: startClock(t - serverNowMs), starting: null, lines: [auto] };
  return {
    tag: 'Draft starts in',
    clock: startClock(t - serverNowMs),
    starting: null,
    lines: [auto, `The draft room opens at ${etTimeLabel(roomOpensAtMs(startsAt))}, when the order is set.`],
  };
}

/** No draft time yet. NEW copy (no frame). */
export function noDateCopy(isCommissioner: boolean, commissionerName: string): string {
  return isCommissioner ? 'Set a draft time in League settings.' : `${commissionerName} will set the draft time.`;
}
export const NO_DATE_TITLE = 'No draft time yet'; // NEW copy

/** Shown under "Starting the draft" while the server retries a start (draft_start_retrying). NEW copy. */
export const START_RETRYING = 'Still starting. This can take a minute.';

// ── The commissioner's blockers card ─────────────────────────────────────

/** Codes that never show as a blocker in the card: the date itself is the
 * countdown; postponed is the card's own state; feasibility_unavailable means
 * "couldn't judge", never "blocked" (draft-start-policy isTransientBlocker). */
const NOT_SHOWN = new Set([
  'draft_date_not_reached', 'draft_postponed', 'no_draft_date', 'not_started_state', 'feasibility_unavailable',
  'room_did_not_open', 'start_failed',
]);

export type Blocker = { code: string; [k: string]: unknown };

/** The blockers the commissioner can fix, in the server's order. */
export function fixableBlockers(blockers: readonly Blocker[]): Blocker[] {
  return blockers.filter((b) => !NOT_SHOWN.has(b.code));
}

function departedNames(b: Blocker): string[] {
  const d = Array.isArray(b.departed) ? (b.departed as { name?: unknown }[]) : [];
  return d.map((x) => (typeof x?.name === 'string' ? x.name : '')).filter(Boolean);
}

/** A blocker as a whole clause (the board's phrases; the rest NEW, from the
 * backend's flagged list). Shown capitalised as the card's title. */
export function blockerClause(b: Blocker): string {
  switch (b.code) {
    case 'roster_reconfirm_required': {
      const names = departedNames(b);
      if (names.length === 1) return `${names[0]} left the league`;
      if (names.length === 2) return `${names[0]} and ${names[1]} left the league`;
      const n = names.length || Number(b.membersBefore ?? 0) - Number(b.members ?? 0);
      return n > 0 ? `${n} managers left the league` : 'something needs fixing';
    }
    case 'playoff_teams_exceeds_members':
      return typeof b.playoffTeams === 'number' && typeof b.members === 'number'
        ? `${b.playoffTeams} playoff teams, but ${b.members} teams are in`
        : 'more playoff teams than teams';
    case 'not_enough_members':
      return `fewer than ${typeof b.need === 'number' ? b.need : 4} teams have joined`;
    case 'slots_infeasible':
      return "some slots can't be filled";
    case 'budget_infeasible':
      return "the budget can't fill every roster";
    case 'no_stake_mode':
      return 'the league has no stake mode';
    case 'invalid_playoff_teams':
      return "the number of playoff teams isn't set";
    case 'renewal_replies_pending':
      return 'not every Season 1 player has answered';
    default:
      return 'something needs fixing';
  }
}

/** The clause as a card title: first letter capitalised. */
export function blockerTitle(b: Blocker): string {
  const c = blockerClause(b);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** The playoff stepper's line in the blockers card (board: "Up to 7, one per team."). */
export function playoffFixLine(members: number): string {
  return `Up to ${members}, one per team.`;
}

/** The reconfirm choices (the leave board's buttons). */
export function moveForwardLabel(members: number): string {
  return `Move forward with ${members}`;
}
export const INVITE_SOMEONE_NEW = 'Invite someone new';

export interface BlockersCardCopy {
  tag: string;
  title: string;
  line: string;
}

/** Board BlockersCard. `deadlineLabel` is the room-open time ("6:00 PM ET"). */
export function blockersCardCopy(phase: 'risk' | 'postponed', deadlineLabel: string | null): BlockersCardCopy {
  if (phase === 'risk') {
    const at = deadlineLabel ?? 'the draft room opens';
    return {
      tag: `Needs you before ${at}`,
      title: 'The draft can’t start yet',
      line: `Fix these before ${at}, when the draft room opens. If they’re still open then, the draft is postponed.`,
    };
  }
  return {
    tag: 'Postponed',
    title: 'The draft is postponed',
    line: deadlineLabel
      ? `The league wasn’t ready at ${deadlineLabel}. Fix these, then pick a new draft time.`
      : 'The league wasn’t ready in time. Fix these, then pick a new draft time.', // NEW (no time known)
  };
}

export const PICK_NEW_TIME = 'Pick a new draft time';
export const PICK_NEW_TIME_NOTE = "Fix these first. The new time needs at least an hour's notice.";
/** Under the button once nothing blocks (NEW copy). */
export const PICK_NEW_TIME_READY = "The new time needs at least an hour's notice.";
/** The reconfirm choice didn't save. NEW copy. */
export const RECONFIRM_NOT_SAVED = "Your choice wasn't saved. Try again.";
/** The lobby's draft status read failed (the house "X didn't load" form, with Try again). NEW copy. */
export const DRAFT_STATUS_LOAD_FAILED = "The draft status didn't load.";
/** The new time didn't save, for a reason other than the three draft-time refusals. NEW copy. */
export const NEW_TIME_NOT_SAVED = "The new draft time wasn't saved. Try again.";

/** The time the postponed league wasn't ready at: the room-open time (stage
 * room_open, or unknown), the draft time itself for a stage-start postponement. */
export function postponedAtMs(p: Postponed | null): number | null {
  if (!p?.from) return null;
  const from = new Date(p.from).getTime();
  if (Number.isNaN(from)) return null;
  return p.stage === 'start' ? from : from - ROOM_OPEN_LEAD_MS;
}

/** The commissioner's at-risk deadline card (board CommishBlocked, risk). */
export function deadlineCopy(startsAt: string, serverNowMs: number): { tag: string; clock: string; line: string } {
  const t = new Date(startsAt).getTime();
  return {
    tag: 'Draft room opens in',
    clock: startClock(roomOpensAtMs(startsAt) - serverNowMs),
    line: `The draft starts at ${etTimeLabel(t)}.`,
  };
}

// ── Members once postponed ───────────────────────────────────────────────

export function memberPostponedCopy(commissionerName: string): { tag: string; title: string; line: string } {
  return {
    tag: 'Draft postponed',
    title: `${commissionerName} will pick a new time.`,
    line: "You'll see it here and on your Home, with at least an hour's notice.",
  };
}

/** Who to name when the commissioner's name isn't known (backend's fallback). */
export const COMMISSIONER_FALLBACK = 'The commissioner';

// ── The date picker ──────────────────────────────────────────────────────

/** The earliest time a draft can be set: an hour out, up to the next quarter hour. */
export function earliestDraftMs(nowMs: number): number {
  return defaultDraftDate(new Date(nowMs)).getTime();
}

/** On the 15-minute grid, no seconds. */
export function onDraftGrid(ms: number): boolean {
  return ms % (DRAFT_TIME_STEP_MINUTES * MIN) === 0;
}

/** Board DraftDatePicker's line: "Today · 3:15 PM ET", and whether it is the earliest. */
export function pickerLine(ms: number, nowMs: number): { value: string; earliest: boolean } {
  return { value: `${etDayWord(ms, nowMs)} · ${etTimeLabel(ms)}`, earliest: ms === earliestDraftMs(nowMs) };
}
export const EARLIEST_NOTE = '(the earliest you can pick: an hour from now)';
export const PICKER_HELPER = 'The draft room opens 1 hour before, and the draft starts automatically.';

/** Board DateAfterRoom: the Draft date row once the room is open. */
export const DATE_LOCKED_AFTER_ROOM = 'The draft time can’t change once the draft room opens.';

/** Is the draft time locked? Once the room opens and until the draft starts,
 * except when postponed (it needs a new time). */
export function draftTimeLocked(startState: StartState | null): boolean {
  return startState === 'room_open' || startState === 'due';
}

/** The server's draft-time refusals (22023, trg_leagues_draft_time), calm.
 * Null for anything else. too_soon / invalid are NEW copy. */
export function draftTimeRefusal(err: unknown): string | null {
  const m = (err as { message?: unknown } | null | undefined)?.message;
  if (typeof m !== 'string') return null;
  if (m.startsWith('draft_time_locked')) return DATE_LOCKED_AFTER_ROOM;
  if (m.startsWith('draft_time_too_soon')) return 'Pick a time at least an hour from now.';
  if (m.startsWith('draft_time_invalid')) return 'Pick a time on the quarter hour.';
  return null;
}

/** What a start request's refusal means for the lobby: keep waiting (the
 * server retries), or re-read (postponed, not yet due on its clock, anything else). */
export function startKickOutcome(res: { ok?: unknown; reason?: unknown } | null | undefined): 'started' | 'retrying' | 'reread' {
  if (res?.ok === true) return 'started';
  if (res?.reason === 'draft_start_retrying') return 'retrying';
  return 'reread';
}

// ── What the lobby shows, per phase and viewer ───────────────────────────

export interface LobbyView {
  /** The commissioner's blockers card. */
  blockers: 'risk' | 'postponed' | null;
  /** The commissioner's "Draft room opens in" deadline (at risk). */
  deadline: boolean;
  /** Everyone's countdown card. */
  countdown: 'scheduled' | 'room_open' | 'starting' | null;
  memberPostponed: boolean;
  noDate: boolean;
  /** The order (or the waiting state) under the countdown. */
  order: boolean;
  /** Ask the server to start (any member's phone at 0:00), then poll. */
  kick: boolean;
}

/** Board #call-auto-start frames: AutoLobby (everyone), CommishBlocked (the
 * commissioner at risk / postponed), MemberPostponed. At risk is the
 * commissioner's business: members see the plain countdown. A commissioner
 * at risk with nothing fixable (only "couldn't judge") sees the countdown too. */
export function lobbyView(phase: LobbyPhase, isCommissioner: boolean, fixableCount: number): LobbyView {
  const none: LobbyView = { blockers: null, deadline: false, countdown: null, memberPostponed: false, noDate: false, order: true, kick: false };
  switch (phase) {
    case 'no_date':
      return { ...none, noDate: true };
    case 'scheduled':
      return { ...none, countdown: 'scheduled' };
    case 'at_risk':
      return isCommissioner && fixableCount > 0
        ? { ...none, blockers: 'risk', deadline: true }
        : { ...none, countdown: 'scheduled' };
    case 'room_open':
      return { ...none, countdown: 'room_open' };
    case 'starting':
      return { ...none, countdown: 'starting', kick: true };
    case 'started':
      return { ...none, countdown: 'starting' }; // the League tab switches to the room on the next read
    case 'postponed':
      return isCommissioner ? { ...none, blockers: 'postponed', order: false } : { ...none, memberPostponed: true, order: false };
  }
}

// ── Home's pre-draft card, from the same view ────────────────────────────

export interface HomeView {
  blockers: 'risk' | 'postponed' | null;
  countdown: 'scheduled' | 'room_open' | 'starting' | null;
  memberPostponed: boolean;
  noDate: boolean;
}

/** Home shows what the lobby shows (lobbyView), with one difference from the
 * board's commissioner Home (ReconfirmHome): at risk, the needs-you card sits
 * on top AND the draft card keeps its countdown below it (the lobby shows the
 * room-open deadline instead). Home never asks the server to start. */
export function homeView(phase: LobbyPhase, isCommissioner: boolean, fixableCount: number): HomeView {
  const lv = lobbyView(phase, isCommissioner, fixableCount);
  if (lv.blockers === 'risk') return { blockers: 'risk', countdown: 'scheduled', memberPostponed: false, noDate: false };
  return { blockers: lv.blockers, countdown: lv.countdown, memberPostponed: lv.memberPostponed, noDate: lv.noDate };
}

/** "You pick 4th" (the room-open push's words), from the revealed order. Null
 * when the order isn't set or the viewer isn't in it. */
export function yourPickLine(order: readonly string[] | null, myUserId: string, ordinal: (n: number) => string): string | null {
  if (!order) return null;
  const seat = order.indexOf(myUserId) + 1;
  return seat > 0 ? `You pick ${ordinal(seat)}` : null;
}
