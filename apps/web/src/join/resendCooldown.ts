/**
 * A floor between two confirmation emails to the same address (the app's
 * lib/auth/resendCooldown.ts, ported). "Send again" repeats signUp(): under
 * PKCE a signUp() REPLACES the one stored code verifier, and supabase-js
 * DELETES it when the call errors. GoTrue refuses a second email inside its
 * minimum interval (60 s), so a "Send again" tapped too soon would fail AND
 * destroy the verifier the first, still-valid email needs. A repeat inside the
 * interval is therefore not sent at all; the person sees the existing "Too many
 * attempts" line. Pure and clock-injected so tests can drive it.
 */

/** GoTrue's default minimum interval between two emails to one address. */
export const RESEND_COOLDOWN_MS = 60_000;

export function createResendCooldown(now: () => number = Date.now, windowMs: number = RESEND_COOLDOWN_MS, max = 50) {
  const sentAt = new Map<string, number>();
  const key = (email: string) => (typeof email === 'string' ? email.trim().toLowerCase() : '');
  return {
    markSent(email: string): void {
      const k = key(email);
      if (!k) return;
      sentAt.delete(k);
      sentAt.set(k, now());
      if (sentAt.size > max) sentAt.delete(sentAt.keys().next().value as string);
    },
    remainingMs(email: string): number {
      const at = sentAt.get(key(email));
      if (at === undefined) return 0;
      const left = at + windowMs - now();
      return left > 0 ? left : 0;
    },
  };
}

/** What a too-soon repeat reports: GoTrue's own rate-limit code, so getAuthErrorMessage words it. */
export const RESEND_TOO_SOON = { message: '', code: 'over_email_send_rate_limit' } as const;

export const confirmationCooldown = createResendCooldown();
