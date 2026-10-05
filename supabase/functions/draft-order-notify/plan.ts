import {
  renewalInviteBody,
  renewalRemovedBody,
  renewalReplyBody,
  seasonSetBody,
} from '../_shared/renewal-copy.ts';

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

/** Run it back notice kinds (20261027000001). Copy: _shared/renewal-copy.ts, the
 * 3c prompt's "Run it back" section (design @ 3244d02). */
export const RENEWAL_KINDS = ['renewal_invite', 'renewal_reply', 'renewal_nudge', 'renewal_removed', 'season_set'] as const;
export type RenewalKind = (typeof RENEWAL_KINDS)[number];
export const NOTICE_KINDS = ['draft_order_set', ...RENEWAL_KINDS] as const;

export interface RenewalNotice {
  kind: RenewalKind;
  leagueName: string;
  leagueId: string;
  /** league_notifications.detail: the event as it happened, written at event time. */
  detail: Record<string, unknown>;
}

/** The push for a renewal notice, built SERVER-SIDE from the stored detail only.
 * Every string comes from _shared/renewal-copy.ts. Returns null for an unknown
 * kind (the caller settles that row as skipped). */
export function renewalNoticeMessage(n: RenewalNotice) {
  const d = n.detail;
  const season = Number(d.season_number) || 0;
  const data = { type: n.kind, screen: 'league', league_id: n.leagueId };
  const num = (v: unknown) => Number(v) || 0;
  switch (n.kind) {
    case 'renewal_invite':
    case 'renewal_nudge':
      return {
        title: n.leagueName,
        body: renewalInviteBody({ commissioner: String(d.commissioner_name ?? 'The commissioner'), season }),
        data,
      };
    case 'renewal_reply':
      return {
        title: n.leagueName,
        body: renewalReplyBody({
          name: String(d.subject_name ?? 'A player'),
          response: d.response === 'in' ? 'in' : 'out',
          season,
          running: num(d.in),
          out: num(d.out),
          noReply: num(d.pending),
        }),
        data,
      };
    case 'renewal_removed':
      return {
        title: n.leagueName,
        body: renewalRemovedBody({ commissioner: String(d.commissioner_name ?? 'The commissioner'), season, league: n.leagueName }),
        data,
      };
    case 'season_set':
      return {
        title: n.leagueName,
        body: seasonSetBody({
          league: n.leagueName,
          season,
          draftDate: typeof d.draft_date === 'string' ? d.draft_date : null,
        }),
        data,
      };
    default:
      return null;
  }
}

export type DeliveryOutcome =
  | 'sent'
  | 'no_token' // no device registered, or notifications turned off
  | 'not_in_order' // left the league (or never in the order) since the notice was created
  | 'unknown_kind' // a kind this function does not deliver: never retried
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
    case 'unknown_kind': return 'skipped';
    default: return attempts >= MAX_PUSH_ATTEMPTS ? 'failed' : 'pending';
  }
}
