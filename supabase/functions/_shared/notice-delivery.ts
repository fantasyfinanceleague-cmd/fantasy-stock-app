/**
 * Deliver ONE league_notifications row a server action just created: claim it
 * (pending -> sending), send, settle. Copied VERBATIM from leave-league/index.ts
 * (deliverNotice) and leave-league/logic.ts (noticeStatus) for delete-account and
 * join-league's takeover. leave-league is deliberately NOT switched over in the
 * same change: that would need its own redeploy and byte-verification
 * (CLAUDE.md), the precedent of ./cron-auth.ts and ./push.ts. It remains the
 * reference this file must keep matching.
 *
 * The claim is conditional, so a retry cannot double-send. One attempt, settled
 * truthfully: a failure is 'failed', never a 'pending' that reads as "still to
 * come". Never throws; a push never fails the action that has already committed.
 */
import { getTargetToken, type PushMessage, sendExpoPush } from './push.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;

export type DeliveryOutcome = 'sent' | 'no_token' | 'lookup_failed' | 'expo_error' | 'expo_ticket_error';

export function noticeStatus(o: DeliveryOutcome): 'sent' | 'no_device' | 'failed' {
  if (o === 'sent') return 'sent';
  if (o === 'no_token') return 'no_device';
  return 'failed';
}

/**
 * How long one Expo push may take. Deliveries here sit inside requests people wait on (the end of an
 * account deletion, a takeover), and a hung Expo must not hold them open or leave a notice stranded at
 * 'sending': past this the push is reported 'expo_error' and the notice settles 'failed'.
 */
export const PUSH_TIMEOUT_MS = 4000;

/** Returns the settled status, or null if the claim or settle didn't land. */
export async function deliverNotice(
  admin: Admin,
  kind: string,
  noticeId: string,
  recipient: string,
  message: PushMessage,
  opts: { pushTimeoutMs?: number } = {},
): Promise<string | null> {
  const r = { notice_id: noticeId };
  try {
    const { data: claimed, error: claimErr } = await admin
      .from('league_notifications')
      .update({ push_status: 'sending', push_attempts: 1, push_attempted_at: new Date().toISOString() })
      .eq('id', r.notice_id)
      .eq('push_status', 'pending')
      .select('id')
      .maybeSingle();
    if (claimErr || !claimed) {
      console.error(`${kind} claim failed`, r.notice_id, claimErr ? JSON.stringify(claimErr) : 'no row claimed');
      return null;
    }

    let outcome: DeliveryOutcome;
    const { token, enabled, lookupFailed } = await getTargetToken(admin, recipient);
    if (lookupFailed) {
      outcome = 'lookup_failed';
    } else if (!token || !enabled) {
      outcome = 'no_token';
    } else {
      const res = await sendExpoPush(token, message, { timeoutMs: opts.pushTimeoutMs ?? PUSH_TIMEOUT_MS });
      outcome = res.sent ? 'sent' : res.reason;
    }

    const status = noticeStatus(outcome);
    const { data: settled, error: setErr } = await admin
      .from('league_notifications')
      .update({ push_status: status, push_error: outcome === 'sent' ? null : outcome })
      .eq('id', r.notice_id)
      .eq('push_status', 'sending')
      .select('id')
      .maybeSingle();
    if (setErr || !settled) {
      console.error(`${kind} settle failed`, r.notice_id, setErr ? JSON.stringify(setErr) : 'no row settled');
      return null;
    }
    return status;
  } catch (e) {
    console.error(`${kind} delivery threw`, r.notice_id, String(e));
    return null;
  }
}
