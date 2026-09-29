/**
 * Pure decisions for draft-order-notify — no DB, no network, hermetically
 * tested in plan.test.ts.
 *
 * The notice itself (the league_notifications row) is created EXACTLY ONCE, in
 * SQL, in the same transaction as the finalize (20261013000000). This function
 * only DELIVERS it: pending -> sending -> sent | no_device | skipped | failed.
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
 * never makes it stale. Copy: Design Lead, board @ 4ab3429 (verbatim).
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
  const when = i.draftDate && !i.draftStarted ? ` The draft starts at ${formatDraftTime(i.draftDate)}.` : '';
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
    default: return attempts >= MAX_PUSH_ATTEMPTS ? 'failed' : 'pending';
  }
}
