// Friendly, user-facing translations of Supabase Auth errors — shared
// between login.tsx (sign in / sign up) and reset-password.tsx (password
// recovery), so the same server error reads the same way on every screen
// instead of a friendly message on one and a raw server string on another.
//
// Extracted from login.tsx's getUserFriendlyError (unchanged behavior for
// every case that already existed there) and extended with two cases
// login.tsx never needed: 'same_password' (reusing the current password
// via updateUser) and a network/transport failure.
//
// Prefers error.code — GoTrue's stable, machine-readable error code (see
// @supabase/auth-js's ErrorCode union, e.g. 'weak_password', 'same_password')
// — over string-matching error.message, and falls back to the message
// text where no code is present. A code is only ever absent for a
// transport-level failure (AuthRetryableFetchError) that never reached the
// server to get one, which is exactly the case the network check below
// exists to catch.
//
// Deliberately NO import of constants/passwordRules.ts's PASSWORD_RULE_SENTENCE
// here (unlike an earlier draft of this file): every other pure-logic module
// this app also runs through `deno test` (lib/recoveryLink.ts,
// lib/draftState.ts, lib/weekStatus.ts, ...) is self-contained, with zero
// cross-file imports, because Deno has no knowledge of this app's `@/*`
// tsconfig path alias and would fail to resolve one. Callers that want the
// shared password-policy sentence in the weak_password case pass it in via
// `weakPasswordMessage` instead (both real call sites do); a caller that
// doesn't gets a still-reasonable generic fallback.

export function getAuthErrorMessage(error: any, weakPasswordMessage?: string): string {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';

  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'Invalid email or password. Please try again.';
  }
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Please verify your email before signing in.';
  }
  if (code === 'user_already_exists' || message.includes('user already registered')) {
    return 'An account with this email already exists.';
  }
  if (code === 'same_password' || message.includes('should be different from the old password')) {
    return 'Your new password needs to be different from your current one.';
  }
  if (code === 'weak_password' || message.includes('password should be at least')) {
    return weakPasswordMessage ?? 'That password does not meet the required strength.';
  }
  if (code === 'email_address_invalid' || message.includes('invalid email') || message.includes('unable to validate email')) {
    return 'Please enter a valid email address.';
  }
  if (
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    message.includes('rate limit') ||
    message.includes('for security purposes')
  ) {
    return 'Too many attempts — please wait a minute and try again.';
  }
  // Server-side signup gate (Before User Created hook).
  if (message.includes('not open for new signups')) {
    return 'Stockpile isn\'t open for new signups yet — check back soon. Existing accounts can still sign in.';
  }
  if (message.includes('network request failed') || message.includes('failed to fetch') || message.includes('network error')) {
    return 'Network error — check your connection and try again.';
  }
  return error?.message || 'Something went wrong. Please try again.';
}
