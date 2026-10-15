/**
 * The app's friendly auth errors (apps/mobile/lib/authErrors.ts), ported: the
 * same GoTrue code or message always reads the same line, here and in the app
 * (authErrors parity test). NEVER the server's own words: an unmapped error is
 * the generic line.
 */
import { WEB_COPY } from './joinCopy';

function field(error: unknown, key: 'code' | 'message'): string {
  const v = error !== null && typeof error === 'object' ? (error as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' ? v : '';
}

/** The server-side signup gate's refusal (Before User Created hook); it has no stable code. */
export function isSignupsPausedError(error: unknown): boolean {
  const message = field(error, 'message').toLowerCase();
  return message.includes('not open for new signups');
}

/** Signing in to an account whose email was never confirmed (confirmation is ON). */
export function isEmailNotConfirmedError(error: unknown): boolean {
  return field(error, 'code') === 'email_not_confirmed' || field(error, 'message').toLowerCase().includes('email not confirmed');
}

/** `weakPasswordMessage`: the policy sentence for the weak_password case (the form passes its own). */
export function getAuthErrorMessage(error: unknown, weakPasswordMessage?: string): string {
  const code = field(error, 'code');
  const message = field(error, 'message').toLowerCase();

  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'Invalid email or password. Please try again.';
  }
  if (isEmailNotConfirmedError(error)) return 'Please verify your email before signing in.';
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
  if (isSignupsPausedError(error)) return WEB_COPY.signupsPaused;
  if (message.includes('network request failed') || message.includes('failed to fetch') || message.includes('network error')) {
    return 'Network error — check your connection and try again.';
  }
  return WEB_COPY.generic;
}
