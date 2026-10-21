/**
 * Push copy for the notices scrub_deleted_manager creates, and their delivery.
 * Shared by delete-account and heal-account-deletions (whichever runs the scrub
 * delivers what it created).
 *
 * COPY IS PROVISIONAL for the Design Lead. It never names the deleted manager:
 * their name is scrubbed, which is the point (PRODUCT_RULES "Account deletion").
 */
import type { PushMessage } from './push.ts';
import type { ScrubNotice } from './account-deletion.ts';
import { deliverNotice } from './notice-delivery.ts';

export function deletionNoticeMessage(n: ScrubNotice): PushMessage | null {
  const league = n.league_name?.trim() || 'your league';
  switch (n.kind) {
    case 'commissioner_transferred':
      return {
        title: league,
        body: `You're now the commissioner of ${league}.`,
        data: { type: 'commissioner_transferred', league_id: n.league_id },
      };
    case 'member_left':
      // Pre-draft only (the scrub uses leave_league's pre-draft branch), which
      // always owes the commissioner a roster reconfirmation.
      return {
        title: league,
        body: `A manager left ${league}. Confirm your roster before the draft.`,
        data: { type: 'member_left', league_id: n.league_id },
      };
    default:
      return null;
  }
}

/** The whole notice batch of one deletion gets this long; the rest stay pending (the in-app record exists). */
export const NOTICE_BATCH_BUDGET_MS = 12_000;

// deno-lint-ignore no-explicit-any
export async function deliverDeletionNotices(admin: any, notices: ScrubNotice[], budgetMs = NOTICE_BATCH_BUDGET_MS): Promise<void> {
  const started = Date.now();
  for (let i = 0; i < notices.length; i++) {
    if (Date.now() - started >= budgetMs) {
      console.error('deletion notices: budget reached, left pending', notices.length - i);
      return;
    }
    const n = notices[i];
    const msg = deletionNoticeMessage(n);
    if (!msg) {
      console.error('deletion notice of unknown kind left pending', n.kind, n.id);
      continue;
    }
    const status = await deliverNotice(admin, n.kind, n.id, n.recipient, msg);
    console.log('deletion notice', JSON.stringify({ kind: n.kind, notice: n.id, push_status: status }));
  }
}
