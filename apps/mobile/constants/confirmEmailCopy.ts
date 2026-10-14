// Onboarding W2 — the words on "Check your email" after an email sign-up (components/shell/
// ConfirmEmailSent.tsx) and the chip shown on return from the confirmation link. ONE copy module.
//
// APPROVED by Giorgio, 2026-10-14 (via the Planner), verbatim:
//   with a pending invite: "We sent a link to {email}. Tap it to finish joining {league}."
//   with no invite:        "We sent a link to {email}. Tap it to finish creating your account."
//   the return chip:       "✓ EMAIL CONFIRMED" (above Pick a username; W4 draws it)
// The title and the two actions are the existing forgot-password strings. `league` is the pending
// invite's league name (W3 passes it); without one the body is the no-invite sentence.
export const CONFIRM_EMAIL_COPY = {
  title: 'Check your email',
  back: 'Back to sign in',
  resend: "Didn't receive it? Send again",
  /** The chip above "Pick a username" after the confirmation link signs the person in. */
  confirmedChip: '✓ EMAIL CONFIRMED',
} as const;

/** The body under the title. A blank / missing league name is the no-invite sentence. */
export function confirmSentBody(email: string, league?: string | null): string {
  const name = typeof league === 'string' ? league.trim() : '';
  return name
    ? `We sent a link to ${email}. Tap it to finish joining ${name}.`
    : `We sent a link to ${email}. Tap it to finish creating your account.`;
}
