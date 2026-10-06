/**
 * Draft auto-start POLICY (Giorgio, 2026-10-06): "the draft is not something
 * that is started manually. It should be something that starts at the minute
 * that is selected by the commissioner ... the draft room will open at 11 a.m.
 * and the draft will automatically start at noon."
 *
 * Pure: no DB, no Deno runtime APIs (hermetically tested in
 * draft-start-policy.test.ts). This file is THE place the start-time policy
 * lives; draft-start.ts executes it and the SQL mirrors the one number it must
 * know (see START_GRACE_SECONDS).
 *
 * BLOCKED AT T — the policy built (★A, the Orchestrator's default pending
 * Giorgio's board, docs/migrations/DRAFT_AUTO_START_PLAN.md §2): a draft that
 * cannot start at draft_date stays not_started, and starts automatically the
 * moment its blockers clear, as long as that is within START_GRACE_SECONDS of
 * draft_date. After that it is MISSED: it never auto-starts, and the
 * commissioner must set a new draft time (a new draft_date re-opens the
 * window). Changing to the other options is local:
 *   B (missed at once): drop the grace to a cron-lag allowance (~120 s) here
 *     AND in public.draft_start_grace() (20261109000000); nothing else moves.
 *   C (auto-fix what's safe): add the fix step in draft-start.ts startDraftIfDue,
 *     between the blocker evaluation and start_league_draft (one place).
 */

/** How long after draft_date a blocked draft may still auto-start. MUST equal
 * public.draft_start_grace() (20261109000000): due_draft_starts() and
 * start_league_draft() judge the window in SQL, this module judges it for
 * draft-control status. supabase/tests/draft_auto_start.pglite.test.ts pins
 * the two together. */
export const START_GRACE_SECONDS = 15 * 60;

/** The draft room opens (the order is set, #67) this long before draft_date. */
export const ROOM_OPEN_LEAD_SECONDS = 60 * 60;

/**
 * Where a league is in the start lifecycle, judged on the server's clock (so a
 * skewed phone clock never shows the wrong phase):
 *   no_date    — draft_date is TBD; never auto-starts.
 *   scheduled  — more than an hour out.
 *   room_open  — within the hour before draft_date (the order is set).
 *   due        — draft_date reached, inside the grace, nothing blocks: the start
 *                is imminent (the next sweep tick, or a kick).
 *   delayed    — draft_date reached, inside the grace, something blocks.
 *   missed     — past the grace and still not started: needs a new draft time.
 *   started    — draft_status left not_started.
 */
export type StartState = 'no_date' | 'scheduled' | 'room_open' | 'due' | 'delayed' | 'missed' | 'started';

export interface StartStateInput {
  draftStatus: string | null;
  draftDate: string | null; // ISO, or null = TBD
  /** Is anything other than the date itself blocking the start right now? */
  blocked: boolean;
}

/** The start window is [draft_date, draft_date + grace): the same half-open
 * interval due_draft_starts() and start_league_draft() use in SQL. */
export function isInStartWindow(draftDate: string, now: Date): boolean {
  const t = new Date(draftDate).getTime();
  return now.getTime() >= t && now.getTime() < t + START_GRACE_SECONDS * 1000;
}

export function isPastStartWindow(draftDate: string, now: Date): boolean {
  return now.getTime() >= new Date(draftDate).getTime() + START_GRACE_SECONDS * 1000;
}

export function computeStartState(input: StartStateInput, now: Date): StartState {
  if ((input.draftStatus ?? 'not_started') !== 'not_started') return 'started';
  if (!input.draftDate) return 'no_date';
  const t = new Date(input.draftDate).getTime();
  if (now.getTime() < t - ROOM_OPEN_LEAD_SECONDS * 1000) return 'scheduled';
  if (now.getTime() < t) return 'room_open';
  if (isPastStartWindow(input.draftDate, now)) return 'missed';
  return input.blocked ? 'delayed' : 'due';
}

/** True once the room is open (or later): status starts evaluating the full
 * blocker set (feasibility included) from here, so the commissioner gets the
 * hour to fix what would stop the start. */
export function isRoomOpen(draftDate: string | null, now: Date): boolean {
  if (!draftDate) return false;
  return now.getTime() >= new Date(draftDate).getTime() - ROOM_OPEN_LEAD_SECONDS * 1000;
}
