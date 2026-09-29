/**
 * Hermetic unit tests for lib/authErrors.ts's shared error-message mapper.
 * Run from apps/mobile/tests-deno (see that directory's deno.json):
 *
 *   cd apps/mobile/tests-deno && deno test .
 *
 * Every case here matches something login.tsx already relied on (message
 * text) before this was extracted, plus two new ones reset-password.tsx
 * needs that login.tsx never triggered: 'same_password' and a network
 * failure. error.code is checked first (GoTrue's stable machine-readable
 * code) with the message text as a fallback for transport-level failures
 * that never got a code.
 *
 * lib/authErrors.ts deliberately does not import constants/passwordRules.ts
 * (Deno can't resolve this app's `@/*` alias — see that file's header
 * comment), so these tests pass a literal stand-in string as
 * weakPasswordMessage rather than importing PASSWORD_RULE_SENTENCE; the
 * real call sites (login.tsx, reset-password.tsx) pass the real one.
 */
import { assertEquals } from 'jsr:@std/assert';
import { getAuthErrorMessage } from '../lib/authErrors.ts';

const RULE_SENTENCE_STANDIN = 'Use at least 8 characters, with an uppercase letter, a lowercase letter, a number, and a symbol.';

Deno.test('getAuthErrorMessage: invalid credentials, by code', () => {
  assertEquals(
    getAuthErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }),
    'Invalid email or password. Please try again.'
  );
});

Deno.test('getAuthErrorMessage: invalid credentials, by message only (no code)', () => {
  assertEquals(
    getAuthErrorMessage({ message: 'Invalid login credentials' }),
    'Invalid email or password. Please try again.'
  );
});

Deno.test('getAuthErrorMessage: email not confirmed', () => {
  assertEquals(
    getAuthErrorMessage({ code: 'email_not_confirmed', message: 'Email not confirmed' }),
    'Please verify your email before signing in.'
  );
});

Deno.test('getAuthErrorMessage: user already registered', () => {
  assertEquals(
    getAuthErrorMessage({ code: 'user_already_exists', message: 'User already registered' }),
    'An account with this email already exists.'
  );
});

Deno.test('getAuthErrorMessage: same_password (new case, updateUser reusing the current password)', () => {
  assertEquals(
    getAuthErrorMessage({ code: 'same_password', message: 'New password should be different from the old password.' }),
    'Your new password needs to be different from your current one.'
  );
  // Message-only fallback, in case a future SDK version omits the code.
  assertEquals(
    getAuthErrorMessage({ message: 'New password should be different from the old password.' }),
    'Your new password needs to be different from your current one.'
  );
});

Deno.test('getAuthErrorMessage: weak_password returns the caller-supplied policy sentence', () => {
  assertEquals(
    getAuthErrorMessage({ code: 'weak_password', message: 'Password should be at least 8 characters.' }, RULE_SENTENCE_STANDIN),
    RULE_SENTENCE_STANDIN
  );
});

Deno.test('getAuthErrorMessage: weak_password with no override falls back to a generic message', () => {
  assertEquals(
    getAuthErrorMessage({ code: 'weak_password', message: 'Password should be at least 8 characters.' }),
    'That password does not meet the required strength.'
  );
});

Deno.test('getAuthErrorMessage: invalid email', () => {
  assertEquals(
    getAuthErrorMessage({ code: 'email_address_invalid', message: 'Unable to validate email address: invalid format' }),
    'Please enter a valid email address.'
  );
});

Deno.test('getAuthErrorMessage: rate limited', () => {
  assertEquals(
    getAuthErrorMessage({ code: 'over_request_rate_limit', message: 'For security purposes, you can only request this once every 60 seconds.' }),
    'Too many attempts — please wait a minute and try again.'
  );
});

Deno.test('getAuthErrorMessage: signups closed (message-only, no stable code for this one)', () => {
  assertEquals(
    getAuthErrorMessage({ message: 'Signups not open for new signups' }),
    'Stockpile isn\'t open for new signups yet — check back soon. Existing accounts can still sign in.'
  );
});

Deno.test('getAuthErrorMessage: network failure (new case, no code — never reached the server)', () => {
  assertEquals(
    getAuthErrorMessage({ message: 'Network request failed' }),
    'Network error — check your connection and try again.'
  );
  assertEquals(
    getAuthErrorMessage({ message: 'TypeError: Failed to fetch' }),
    'Network error — check your connection and try again.'
  );
});

Deno.test('getAuthErrorMessage: unrecognized error falls back to its own message', () => {
  assertEquals(
    getAuthErrorMessage({ message: 'Something wildly specific broke.' }),
    'Something wildly specific broke.'
  );
});

Deno.test('getAuthErrorMessage: no message at all falls back to a generic string', () => {
  assertEquals(getAuthErrorMessage({}), 'Something went wrong. Please try again.');
  assertEquals(getAuthErrorMessage(null), 'Something went wrong. Please try again.');
});
