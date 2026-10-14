// Onboarding W2 (PKCE) — a floor between two confirmation emails to the same address.
//
// "Send again" repeats signUp() (lib/SessionProvider.tsx). Under PKCE a signUp() REPLACES the one
// stored code verifier, and supabase-js DELETES it when the call errors. GoTrue refuses a second email
// inside its minimum interval (default 60 s, over_email_send_rate_limit), so a "Send again" tapped too
// soon would fail AND destroy the verifier the first, still-valid email needs: its link would then
// confirm the address but could not sign this device in. So a repeat inside the interval is not sent at
// all; the person sees the existing "Too many attempts — please wait a minute and try again." line
// (getAuthErrorMessage) instead. Pure and clock-injected so tests-deno can drive it.

/** GoTrue's default minimum interval between two emails to one address. */
export const RESEND_COOLDOWN_MS = 60_000;

export function createResendCooldown(now: () => number = Date.now, windowMs: number = RESEND_COOLDOWN_MS, max = 50) {
  const sentAt = new Map<string, number>();
  const key = (email: string) => (typeof email === 'string' ? email.trim().toLowerCase() : '');
  return {
    /** Record that a confirmation email was just requested for `email`. */
    markSent(email: string): void {
      const k = key(email);
      if (!k) return;
      sentAt.delete(k);
      sentAt.set(k, now());
      if (sentAt.size > max) sentAt.delete(sentAt.keys().next().value as string); // oldest first
    },
    /** Milliseconds until another email to `email` may be requested; 0 = go ahead. */
    remainingMs(email: string): number {
      const at = sentAt.get(key(email));
      if (at === undefined) return 0;
      const left = at + windowMs - now();
      return left > 0 ? left : 0;
    },
  };
}

/**
 * App-wide instances. SessionProvider.signUp consults and marks `confirmationCooldown` ITSELF, so every
 * caller (Create account, Check your email's Send again, Sign in's Send again) is covered by one rule.
 * Forgot password does the same with `resetCooldown`: resetPasswordForEmail also deletes the stored
 * verifier on any error (a rate limit included), which would orphan the first, still-valid reset email.
 * In-memory only: a relaunch inside the minute loses the floor (accepted).
 */
export const confirmationCooldown = createResendCooldown();
export const resetCooldown = createResendCooldown();

/** The error a too-early "Send again" shows: GoTrue's own code, so the shared mapper words it. */
export const RESEND_TOO_SOON = { message: '', code: 'over_email_send_rate_limit' } as const;
