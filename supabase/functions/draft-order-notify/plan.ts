/**
 * Pure decisions for draft-order-notify — no DB, no network, hermetically
 * tested in plan.test.ts.
 *
 * The notices (league_notifications rows) are created in SQL, in the same
 * transaction as their event (20261109000000: the room opening, the start, a
 * postponement, a league becoming at risk). This function only DELIVERS them:
 * pending -> sending -> sent | no_device | skipped | failed. The words are
 * built HERE, at send time, from verified rows (draft_notice_context), so a
 * position or a name is never stale and nothing caller-supplied reaches a push.
 *
 * #67's 'draft_order_set' is no longer pushed (its rows are in-app records,
 * marked skipped at insert); its message lives on as the room-open push.
 */

/** Bounds per invocation; the cron re-fires each minute for the rest. */
export const MAX_PUSHES_PER_RUN = 50;
/** A transient failure (lookup error, Expo non-ok) is retried this many times
 * in total, one attempt per tick, before the row settles as 'failed'. */
export const MAX_PUSH_ATTEMPTS = 3;
/** A row stuck in 'sending' this long (the function died mid-send) is
 * reclaimable. Must match draft_order_notify_due()'s interval in SQL. */
export const STALE_SENDING_MS = 10 * 60 * 1000;

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** The app's time convention: no per-user time zone is stored, so draft
 * times in pushes are Eastern (as lib/marketHours.ts). */
export const PUSH_TIME_ZONE = 'America/New_York';

/** "7:00 PM" — time only, no date, in PUSH_TIME_ZONE. ICU may emit a narrow
 * no-break space before AM/PM; normalized to a plain space. */
export function formatDraftTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: PUSH_TIME_ZONE, hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso))
    .replace(/[\u202f\u00a0]/g, ' ');
}

/**
 * The push, built SERVER-SIDE from verified values only (send-notification's
 * closed-set rule: no caller-supplied strings). The position is read AT SEND
 * TIME from the current order, so a leaver closing the gap after the finalize
 * never makes it stale. Copy: Design Lead, board @ 4ab3429, plus the "ET"
 * suffix (Orchestrator, 2026-09-29).
 * The "starts at" sentence is dropped when there is no draft_date or the
 * draft has already started (the start-backstop finalize): announcing a start
 * time that has passed would be wrong.
 */
export function draftOrderSetMessage(i: {
  leagueName: string;
  leagueId: string;
  mode: string; // leagues.draft_order_mode
  position: number;
  draftDate: string | null;
  draftStarted: boolean;
}) {
  const lead = i.mode === 'manual' ? 'The commissioner set the draft order.' : 'The draft order is set.';
  // "ET" label: the app marks Eastern times everywhere ("Resumes Fri 9:30 AM
  // ET"); an unlabeled Eastern time is wrong for anyone outside ET.
  const when = i.draftDate && !i.draftStarted ? ` The draft starts at ${formatDraftTime(i.draftDate)} ET.` : '';
  return {
    title: i.leagueName,
    body: `${lead} You pick ${ordinal(i.position)}.${when}`,
    data: { type: 'draft_order_set', screen: 'draft', league_id: i.leagueId },
  };
}

export type DeliveryOutcome =
  | 'sent'
  | 'no_token' // no device registered, or notifications turned off
  | 'not_in_order' // left the league (or never in the order) since the notice was created
  | 'superseded' // the event no longer holds (fixed, rescheduled, started): saying it would be wrong
  | 'lookup_failed'
  | 'expo_error'
  | 'expo_ticket_error';

export type PushStatus = 'pending' | 'sent' | 'no_device' | 'skipped' | 'failed';

/** Where a claimed row settles. `attempts` INCLUDES the one just made. A
 * transient failure goes back to 'pending' (the next tick retries) until the
 * attempt budget is spent; a definitive outcome settles immediately. */
export function nextPushStatus(outcome: DeliveryOutcome, attempts: number): PushStatus {
  switch (outcome) {
    case 'sent': return 'sent';
    case 'no_token': return 'no_device';
    case 'not_in_order': return 'skipped';
    case 'superseded': return 'skipped';
    default: return attempts >= MAX_PUSH_ATTEMPTS ? 'failed' : 'pending';
  }
}

// ===========================================================================
// Draft auto-start pushes (20261109000000). COPY: board strings where they
// exist (inventory-board.jsx, "Auto-start call"); every NEW string is marked
// NEW COPY for the Design Lead.
// ===========================================================================

/** The kinds this function delivers (and the only ones it selects). */
export const DELIVERED_KINDS = ['draft_room_open', 'draft_started', 'draft_at_risk', 'draft_postponed'] as const;
export type DeliveredKind = typeof DELIVERED_KINDS[number];

/** draft_notice_context's shape (20261109000000), read at send time. */
export interface NoticeContext {
  kind: string;
  league_id: string;
  user_id: string;
  created_at: string;
  league_name: string | null;
  draft_status: string | null;
  draft_date: string | null;
  draft_order_mode: string | null;
  is_member: boolean;
  is_commissioner: boolean;
  commissioner_name: string | null;
  position: number | null;
  watch: { draft_date: string; blocked: boolean; blockers: unknown; room_opened_at: string | null } | null;
  postponement: { postponed_from: string; stage: string; reason: string; blockers: unknown } | null;
}

/** The first blocker, in words, completing "Your draft can't start at 7:00 PM ET: ___."
 * Only roster_reconfirm_required's "<name> left the league" is board copy;
 * every other line is NEW COPY. */
export function blockerReason(blockers: unknown): string {
  const first = Array.isArray(blockers) && blockers.length > 0 ? blockers[0] as Record<string, unknown> : null;
  const code = first ? String(first.code ?? '') : '';
  switch (code) {
    case 'roster_reconfirm_required': {
      const names = Array.isArray(first!.departed)
        ? (first!.departed as Array<Record<string, unknown>>).map((d) => String(d.name ?? '')).filter(Boolean)
        : [];
      if (names.length === 1) return `${names[0]} left the league`; // board
      if (names.length === 2) return `${names[0]} and ${names[1]} left the league`; // NEW COPY
      if (names.length > 2) return `${names.length} managers left the league`; // NEW COPY
      return 'a manager left the league'; // NEW COPY
    }
    case 'not_enough_members': return 'the league needs at least 4 managers'; // NEW COPY
    case 'no_stake_mode': return 'the league has no stake mode'; // NEW COPY
    case 'invalid_playoff_teams': return "the number of playoff teams isn't set"; // NEW COPY
    case 'playoff_teams_exceeds_members': return 'there are more playoff teams than managers'; // NEW COPY
    case 'slots_infeasible': return "some roster slots can't be filled"; // NEW COPY
    case 'budget_infeasible': return "the budget can't fill every roster"; // NEW COPY
    case 'renewal_replies_pending': return "not every Season 1 player has answered"; // NEW COPY
    case 'room_did_not_open':
    case 'start_failed': return 'something went wrong on our side'; // NEW COPY
    default: return 'something needs fixing'; // NEW COPY
  }
}

const ROOM_LEAD_MS = 60 * 60 * 1000;
const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

export type NoticeDecision =
  | { send: true; message: { title: string; body: string; data: Record<string, string> } }
  | { send: false; outcome: 'not_in_order' | 'superseded' };

/**
 * What to send for one notice — or why not. Every "why not" re-checks that the
 * event still holds, so nobody is told something that stopped being true
 * between the event and the send (a fixed league, a new time, a started draft).
 */
export function decideNotice(ctx: NoticeContext): NoticeDecision {
  const title = ctx.league_name ?? 'Your league';
  const data = { type: ctx.kind, screen: 'draft', league_id: ctx.league_id };
  if (!ctx.is_member) return { send: false, outcome: 'not_in_order' };
  const notStarted = (ctx.draft_status ?? 'not_started') === 'not_started';

  switch (ctx.kind) {
    case 'draft_room_open': {
      // The room opened for THIS draft time and the draft is still ahead.
      if (!notStarted || ctx.postponement || !ctx.watch?.room_opened_at || !ctx.draft_date
          || ctx.watch.draft_date !== ctx.draft_date) {
        return { send: false, outcome: 'superseded' };
      }
      if (ctx.position == null) return { send: false, outcome: 'not_in_order' };
      // Board string (#67's push, unchanged): "The draft order is set. You pick 4th. The draft starts at 7:00 PM ET."
      const m = draftOrderSetMessage({
        leagueName: title,
        leagueId: ctx.league_id,
        mode: ctx.draft_order_mode ?? 'random',
        position: Number(ctx.position),
        draftDate: ctx.draft_date,
        draftStarted: false,
      });
      return { send: true, message: { ...m, data } };
    }
    case 'draft_started': {
      if (notStarted) return { send: false, outcome: 'superseded' };
      if (ctx.position == null) return { send: false, outcome: 'not_in_order' };
      // Board string: "Your draft has started. You pick 4th."
      return { send: true, message: { title, body: `Your draft has started. You pick ${ordinal(Number(ctx.position))}.`, data } };
    }
    case 'draft_at_risk': {
      // Still the commissioner, still blocked for the CURRENT time, still ahead.
      if (!ctx.is_commissioner || !notStarted || ctx.postponement || !ctx.draft_date
          || !ctx.watch?.blocked || ctx.watch.draft_date !== ctx.draft_date) {
        return { send: false, outcome: 'superseded' };
      }
      const when = formatDraftTime(ctx.draft_date);
      const reason = blockerReason(ctx.watch.blockers);
      const t = new Date(ctx.draft_date).getTime();
      if (new Date(ctx.created_at).getTime() >= t - REMINDER_LEAD_MS) {
        // NEW COPY (the T-2h reminder, and any warning inside the last 2 h): the deadline is the room.
        const room = formatDraftTime(new Date(t - ROOM_LEAD_MS).toISOString());
        return {
          send: true,
          message: { title, body: `Your draft can't start at ${when} ET: ${reason}. Fix it by ${room} ET, or it will be postponed.`, data },
        };
      }
      // Board string: "Your draft can't start at 7:00 PM ET: Sofia F. left the league. Fix it in the lobby."
      return { send: true, message: { title, body: `Your draft can't start at ${when} ET: ${reason}. Fix it in the lobby.`, data } };
    }
    case 'draft_postponed': {
      if (!ctx.postponement || !notStarted) return { send: false, outcome: 'superseded' }; // a new time is set already
      if (ctx.is_commissioner) {
        // NEW COPY (the commissioner's version).
        return {
          send: true,
          message: { title, body: `Your draft is postponed: ${blockerReason(ctx.postponement.blockers)}. Pick a new draft time in the lobby.`, data },
        };
      }
      // Board string: "The draft is postponed. Roberto B. will pick a new time."
      const who = ctx.commissioner_name ?? 'The commissioner'; // NEW COPY (fallback)
      return { send: true, message: { title, body: `The draft is postponed. ${who} will pick a new time.`, data } };
    }
    default:
      return { send: false, outcome: 'superseded' };
  }
}
