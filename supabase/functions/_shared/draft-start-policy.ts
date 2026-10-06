/**
 * Draft auto-start POLICY. Pure: no DB, no Deno runtime APIs (hermetically
 * tested in draft-start-policy.test.ts; mobile can import the same rules).
 *
 * Giorgio, 2026-10-06: "the draft is not something that is started manually.
 * It should be something that starts at the minute that is selected by the
 * commissioner ... the draft room will open at 11 a.m. and the draft will
 * automatically start at noon."
 * Decisions (2026-10-06): "people still need an hour heads up and notice".
 *   1. The REAL GATE is room-open time (T-1h). Blocked then: the room does not
 *      open, the draft does not start, the league is POSTPONED, everyone is
 *      told, and the commissioner picks a NEW time (>= 1 h notice again). No
 *      late start. Blocked at T even though the room opened (rare): the same.
 *   2. The commissioner is warned BEFORE the room opens: the moment the league
 *      becomes blocked, and again at T-2h if still blocked.
 *   3. Pushes to everyone: the room opens (with your position), the draft
 *      started, and the draft is postponed.
 *   4. Draft times: quarter hours only, at least an hour ahead (55 min floor).
 *   5. The time can't change once the room is open, except when postponed.
 *
 * SQL holds the same numbers in public.draft_start_policy() (20261109000000);
 * supabase/tests/draft_auto_start.pglite.test.ts pins the two equal.
 */

/** The room opens (the order is set, #67) this long before draft_date. */
export const ROOM_OPEN_LEAD_SECONDS = 60 * 60;
/** The gate decides this long before the room opens, so the 10 s sweep acts
 * before #67 finalizes the order at T-1h. */
export const GATE_LEAD_SECONDS = 30;
/** The commissioner's reminder, if still blocked. */
export const REMINDER_LEAD_SECONDS = 2 * 60 * 60;
/** An unchanged league is re-evaluated this often (price drift)... */
export const WATCH_REFRESH_SECONDS = 5 * 60;
/** ...once its draft is within this horizon. */
export const WATCH_HORIZON_SECONDS = 24 * 60 * 60;
/** A user-set draft time is at least this far ahead (an hour, minus the
 * Design Lead's invisible slack for a slow form). */
export const MIN_LEAD_SECONDS = 55 * 60;
/** Draft times sit on this grid (:00 / :15 / :30 / :45). */
export const DRAFT_TIME_STEP_MINUTES = 15;
/** TS only (no SQL mirror): a start that keeps failing for a SYSTEM reason
 * (a pool outage, a racing edit, an rpc error) is retried this long past T,
 * then postponed. A blocker never waits: it postpones at once. */
export const START_RETRY_SECONDS = 5 * 60;

/** The numbers public.draft_start_policy() must return (pinned by test). */
export const SQL_POLICY = {
  room_lead_s: ROOM_OPEN_LEAD_SECONDS,
  gate_lead_s: GATE_LEAD_SECONDS,
  reminder_lead_s: REMINDER_LEAD_SECONDS,
  refresh_s: WATCH_REFRESH_SECONDS,
  horizon_s: WATCH_HORIZON_SECONDS,
  min_lead_s: MIN_LEAD_SECONDS,
  step_minutes: DRAFT_TIME_STEP_MINUTES,
} as const;

/**
 * Where a league is, judged on the server's clock (a skewed phone clock never
 * shows the wrong phase):
 *   no_date    draft_date is TBD (and not postponed).
 *   scheduled  before the room opens, nothing blocks.
 *   at_risk    before the room opens, something blocks: fix it or it is
 *              postponed when the room would open.
 *   room_open  T-1h <= now < T.
 *   due        now >= T, not started yet (the next sweep tick starts it, or
 *              postpones it).
 *   postponed  draft_postponements has a row: a new time is needed.
 *   started    draft_status left not_started.
 */
export type StartState = 'no_date' | 'scheduled' | 'at_risk' | 'room_open' | 'due' | 'postponed' | 'started';

export interface StartStateInput {
  draftStatus: string | null;
  draftDate: string | null; // ISO, or null = TBD (or cleared by a postponement)
  postponed: boolean; // the explicit draft_postponements row, never inferred
  /** Is anything other than the date itself blocking the start right now? */
  blocked: boolean;
}

const ms = (s: number) => s * 1000;
const at = (iso: string) => new Date(iso).getTime();

export function computeStartState(input: StartStateInput, now: Date): StartState {
  if ((input.draftStatus ?? 'not_started') !== 'not_started') return 'started';
  if (input.postponed) return 'postponed';
  if (!input.draftDate) return 'no_date';
  const t = at(input.draftDate);
  if (now.getTime() < t - ms(ROOM_OPEN_LEAD_SECONDS)) return input.blocked ? 'at_risk' : 'scheduled';
  if (now.getTime() < t) return 'room_open';
  return 'due';
}

/** The gate window [T-1h-30s, T): blocked -> postpone, clear -> the room may open. */
export function isInGate(draftDate: string, now: Date): boolean {
  const t = at(draftDate);
  return now.getTime() >= t - ms(ROOM_OPEN_LEAD_SECONDS + GATE_LEAD_SECONDS) && now.getTime() < t;
}

/** The room's time has come (T-1h or later). */
export function isRoomTime(draftDate: string | null, now: Date): boolean {
  return !!draftDate && now.getTime() >= at(draftDate) - ms(ROOM_OPEN_LEAD_SECONDS);
}

/** Past T + START_RETRY_SECONDS: a start still failing for a system reason is postponed. */
export function isPastStartRetry(draftDate: string, now: Date): boolean {
  return now.getTime() >= at(draftDate) + ms(START_RETRY_SECONDS);
}

/** A blocker code that means "could not judge", not "blocked": never postpones
 * or warns on its own (the feasibility pool could not be read). */
export function isTransientBlocker(code: string): boolean {
  return code === 'feasibility_unavailable';
}

/** Decision 4, the same rule the DB enforces (trg_leagues_draft_time):
 * a quarter hour, no seconds, at least MIN_LEAD_SECONDS ahead. */
export type DraftTimeVerdict = 'ok' | 'not_quarter_hour' | 'too_soon';
export function checkDraftTime(iso: string, now: Date): DraftTimeVerdict {
  const d = new Date(iso);
  if (d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0 || d.getUTCMinutes() % DRAFT_TIME_STEP_MINUTES !== 0) {
    return 'not_quarter_hour';
  }
  if (d.getTime() < now.getTime() + ms(MIN_LEAD_SECONDS)) return 'too_soon';
  return 'ok';
}

/**
 * The server's clock for one status read (the mobile lobby's countdown offset:
 * one read, no separate get_draft_clock call). `dbNow` is the database's now()
 * (get_draft_clock.server_now), the same clock the SQL start/gate decisions use;
 * the edge clock is the fallback when that read failed. The returned `now`
 * judges start_state too, so server_now and start_state are the SAME instant.
 */
export function resolveServerNow(dbNow: string | null | undefined, fallback: Date): { now: Date; serverNow: string } {
  const t = dbNow ? new Date(dbNow) : null;
  const now = t && Number.isFinite(t.getTime()) ? t : fallback;
  return { now, serverNow: now.toISOString() };
}
