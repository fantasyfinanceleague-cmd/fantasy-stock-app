/**
 * Server-side Expo push: the target-token lookup and the send, extracted
 * VERBATIM from send-notification/index.ts (getTargetToken, and the
 * fetch-to-Expo + ticket check in its SEND block) so a server-originated push
 * (draft-order-notify, a cron) cannot drift from the user-triggered one.
 *
 * send-notification is deliberately NOT switched over to this module in the
 * same change — that would need its own redeploy + byte-verification
 * (CLAUDE.md), the same precedent as ./cron-auth.ts. It remains the reference
 * this file must keep matching.
 *
 * F8 (push tokens are a bearer capability): tokens are read here with the
 * service role, inside an edge function, and never leave it — no client reads
 * a token and no token is logged. This module widens nothing.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;

// Each schema state makes ONE of the two token sources absent, and that absence
// is expected, not a failure:
//   * before phase 2: push_tokens does not exist -> PGRST205 / 42P01
//   * after phase 2:  user_profiles.expo_push_token is dropped -> PGRST204 / 42703
// Any other error is a real lookup failure.
// deno-lint-ignore no-explicit-any
const isMissingRelation = (e: any) => e?.code === 'PGRST205' || e?.code === '42P01';
// deno-lint-ignore no-explicit-any
const isMissingColumn = (e: any) => e?.code === 'PGRST204' || e?.code === '42703';

/**
 * Read the target's push token. Prefers the owner-scoped push_tokens table and
 * falls back to the legacy user_profiles column (works before AND after the F8
 * phase-2 relocation). Destructure-and-check per CLAUDE.md: a real error is
 * `lookupFailed`, distinct from the legitimate "target has no token".
 */
export async function getTargetToken(
  admin: Admin,
  targetUserId: string,
): Promise<{ token: string | null; enabled: boolean; lookupFailed: boolean }> {
  // deno-lint-ignore no-explicit-any
  const failed = (what: string, e: any) => {
    console.error(`${what} lookup failed:`, e?.code, e?.message);
    return { token: null, enabled: false, lookupFailed: true };
  };

  // notifications_enabled stays on user_profiles in both schema states — it is a
  // preference flag, not a capability, and the profile screen renders it.
  const { data: prefs, error: prefsErr } = await admin
    .from('user_profiles').select('notifications_enabled').eq('id', targetUserId).maybeSingle();
  if (prefsErr) return failed('user_profiles', prefsErr);
  const enabled = prefs?.notifications_enabled !== false;

  const { data: row, error: rowErr } = await admin
    .from('push_tokens').select('token').eq('user_id', targetUserId).maybeSingle();
  if (rowErr && !isMissingRelation(rowErr)) return failed('push_tokens', rowErr);
  if (row?.token) return { token: row.token, enabled, lookupFailed: false };

  // Legacy fallback (pre-phase-2). Delete once the relocation migration has landed.
  const { data: legacy, error: legacyErr } = await admin
    .from('user_profiles').select('expo_push_token').eq('id', targetUserId).maybeSingle();
  if (legacyErr && !isMissingColumn(legacyErr)) return failed('user_profiles.expo_push_token', legacyErr);

  return { token: legacy?.expo_push_token ?? null, enabled, lookupFailed: false };
}

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export type PushSendResult =
  | { sent: true }
  | { sent: false; reason: 'expo_error' | 'expo_ticket_error' };

/**
 * POST one message to Expo. HTTP 200 is NOT acceptance: Expo reports
 * per-message failures (e.g. DeviceNotRegistered) as 200 with a ticket
 * { status: 'error' }; only a ticket with status 'ok' counts as sent.
 * Never logs a response body or Expo's `message` — both can echo the token.
 */
export async function sendExpoPush(token: string, msg: PushMessage): Promise<PushSendResult> {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: token, sound: 'default', title: msg.title, body: msg.body, data: msg.data }),
  });
  const resText = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('Expo push failed: HTTP', res.status); // body omitted: may echo the token
    return { sent: false, reason: 'expo_error' };
  }
  // deno-lint-ignore no-explicit-any
  let ticket: any = null;
  try { ticket = JSON.parse(resText)?.data; } catch { /* treated as not-ok below */ }
  if (Array.isArray(ticket)) ticket = ticket[0];
  if (ticket?.status !== 'ok') {
    console.error('Expo push ticket not ok:', ticket?.details?.error ?? (ticket ? 'unknown' : 'unparseable'));
    return { sent: false, reason: 'expo_ticket_error' };
  }
  return { sent: true };
}
