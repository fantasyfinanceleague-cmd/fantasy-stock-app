// Password policy — the single source of truth for the mobile signup requirements
// checklist AND client-side validation (so the list is never written twice here).
//
// MIRROR of packages/shared/constants PASSWORD_REQUIREMENTS, kept in sync MANUALLY:
// Metro does not resolve the @fantasy-stock/shared workspace package from this app
// (mobile lives outside the npm workspace and has no monorepo Metro config). If the
// Supabase Auth password policy changes, update BOTH this file and the shared one.
//
// Must match the Supabase Auth password policy (Dashboard -> Authentication ->
// Policies): min 8 chars, and at least one lowercase, uppercase, digit, and symbol.

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRequirement {
  id: string;
  label: string;
  test: (pw: string) => boolean;
}

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (pw) => (pw || '').length >= PASSWORD_MIN_LENGTH },
  { id: 'lowercase', label: 'A lowercase letter (a–z)', test: (pw) => /[a-z]/.test(pw || '') },
  { id: 'uppercase', label: 'An uppercase letter (A–Z)', test: (pw) => /[A-Z]/.test(pw || '') },
  { id: 'digit', label: 'A number (0–9)', test: (pw) => /[0-9]/.test(pw || '') },
  { id: 'symbol', label: 'A symbol (! ? @ # …)', test: (pw) => /[^A-Za-z0-9]/.test(pw || '') },
];

// The requirements a password FAILS (empty array = valid).
export function failingPasswordRequirements(pw: string): PasswordRequirement[] {
  return PASSWORD_REQUIREMENTS.filter((r) => !r.test(pw));
}

// One sentence stating the policy above, for a screen that wants to show
// the rule as prose rather than (or in addition to) the live checklist —
// e.g. reset-password.tsx, which has no room for a per-requirement list.
// Sentence case, matching this app's copy conventions.
export const PASSWORD_RULE_SENTENCE =
  `Use at least ${PASSWORD_MIN_LENGTH} characters, with an uppercase letter, a lowercase letter, a number, and a symbol.`;

export interface PasswordCheckResult {
  valid: boolean;
  failing: PasswordRequirement[];
}

/**
 * Pure pass/fail check against the same policy as the checklist and
 * failingPasswordRequirements() above (this just packages that result more
 * conveniently for a caller that only wants a single valid/invalid answer
 * plus what's missing, e.g. to build a "Your password needs: …" message).
 */
export function checkPassword(pw: string): PasswordCheckResult {
  const failing = failingPasswordRequirements(pw);
  return { valid: failing.length === 0, failing };
}
