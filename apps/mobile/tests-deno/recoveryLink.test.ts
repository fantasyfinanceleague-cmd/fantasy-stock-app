/**
 * Hermetic unit tests for lib/recoveryLink.ts's deep-link URL parsing. Run
 * from apps/mobile/tests-deno (see that directory's deno.json):
 *
 *   cd apps/mobile/tests-deno && deno test .
 *
 * or, from repo root:
 *
 *   deno test apps/mobile/tests-deno/recoveryLink.test.ts
 *
 * Covers F2 (deep-link session fixation): the `rn` nonce must be read
 * strictly from the URL's query (before '#'), never from the fragment,
 * or an attacker could smuggle a matching `rn` into the fragment itself.
 */
import { assertEquals } from 'jsr:@std/assert';
import { parseRecoveryLink, resetScreenState, RESET_VERIFY_TIMEOUT_MS } from '../lib/recoveryLink.ts';

const NONCE = 'a'.repeat(64);

Deno.test('parseRecoveryLink: happy path — tokens and nonce from a genuine link', () => {
  const url = `fantasystockapp://reset-password?rn=${NONCE}#access_token=at123&refresh_token=rt456&type=recovery`;
  assertEquals(parseRecoveryLink(url), {
    kind: 'tokens',
    accessToken: 'at123',
    refreshToken: 'rt456',
    nonce: NONCE,
  });
});

Deno.test('parseRecoveryLink: rn smuggled into the fragment is NOT read as the nonce', () => {
  // No `?rn=` in the query at all — only in the fragment, where an attacker
  // crafting a link could put anything. queryStart === -1 here entirely.
  const url = `fantasystockapp://reset-password#access_token=at123&refresh_token=rt456&rn=${NONCE}`;
  const result = parseRecoveryLink(url);
  assertEquals(result.kind, 'tokens');
  if (result.kind === 'tokens') {
    assertEquals(result.nonce, null);
  }
});

Deno.test('parseRecoveryLink: rn present in BOTH query and fragment reads only the query value', () => {
  const queryNonce = 'b'.repeat(64);
  const fragmentNonce = 'c'.repeat(64);
  const url = `fantasystockapp://reset-password?rn=${queryNonce}#access_token=at123&refresh_token=rt456&rn=${fragmentNonce}`;
  const result = parseRecoveryLink(url);
  assertEquals(result.kind, 'tokens');
  if (result.kind === 'tokens') {
    assertEquals(result.nonce, queryNonce);
  }
});

Deno.test('parseRecoveryLink: expired/used link reports its error instead of tokens', () => {
  const url = 'fantasystockapp://reset-password?rn=' + NONCE +
    '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
  assertEquals(parseRecoveryLink(url), {
    kind: 'error',
    code: 'otp_expired',
    description: 'Email link is invalid or has expired',
  });
});

Deno.test('parseRecoveryLink: error takes precedence even if stray tokens are also present', () => {
  const url = `fantasystockapp://reset-password#error=access_denied&error_code=otp_expired&access_token=at&refresh_token=rt`;
  const result = parseRecoveryLink(url);
  assertEquals(result.kind, 'error');
});

Deno.test('parseRecoveryLink: no hash fragment at all is "none"', () => {
  assertEquals(parseRecoveryLink(`fantasystockapp://reset-password?rn=${NONCE}`), { kind: 'none' });
});

Deno.test('parseRecoveryLink: hash present but missing refresh_token is "none"', () => {
  const url = `fantasystockapp://reset-password?rn=${NONCE}#access_token=at123&type=recovery`;
  assertEquals(parseRecoveryLink(url), { kind: 'none' });
});

Deno.test('parseRecoveryLink: hash present but missing access_token is "none"', () => {
  const url = `fantasystockapp://reset-password?rn=${NONCE}#refresh_token=rt456&type=recovery`;
  assertEquals(parseRecoveryLink(url), { kind: 'none' });
});

Deno.test('parseRecoveryLink: a URL that is not a recovery link at all is "none"', () => {
  assertEquals(parseRecoveryLink('fantasystockapp://league-settings?id=1'), { kind: 'none' });
});

Deno.test('parseRecoveryLink: matches on type=recovery even without the literal path "reset-password"', () => {
  const url = `fantasystockapp://some-other-path?rn=${NONCE}#access_token=at&refresh_token=rt&type=recovery`;
  const result = parseRecoveryLink(url);
  assertEquals(result.kind, 'tokens');
});

Deno.test('parseRecoveryLink: empty string is "none"', () => {
  assertEquals(parseRecoveryLink(''), { kind: 'none' });
});

Deno.test('parseRecoveryLink: missing rn param (no query at all) still returns tokens with a null nonce', () => {
  const url = 'fantasystockapp://reset-password#access_token=at123&refresh_token=rt456&type=recovery';
  const result = parseRecoveryLink(url);
  assertEquals(result.kind, 'tokens');
  if (result.kind === 'tokens') {
    assertEquals(result.nonce, null);
  }
});

// ---------------------------------------------------------------------------
// resetScreenState
// ---------------------------------------------------------------------------
// Covers two gaps:
//
// 1. "verifying spins forever" — a URL that routes to reset-password by
//    path but that parseRecoveryLink calls 'none' (a bare `?rn=` with no
//    fragment, a truncated link, a future PKCE `?code=` link) never gets a
//    `status` param and never sets the recovery flag, so only the
//    elapsed-time fallback moves it off "verifying".
//
// 2. "form keyed on isRecovery, not on any signed-in user" — a user who is
//    signed in for an unrelated reason and lands on /reset-password some
//    other way (a stray deep link, a bookmark) must NOT see the form. That
//    case has isRecovery: false the whole time (lib/recoveryNonce.ts's
//    flag is only ever set true by a nonce-verified setSession in
//    _layout.tsx), so it falls all the way through verifying -> timeout ->
//    invalid, identically to having no session at all.

Deno.test('resetScreenState: status=invalid wins even with isRecovery true and zero elapsed time', () => {
  assertEquals(
    resetScreenState({ status: 'invalid', isRecovery: true, elapsedMs: 0 }),
    'invalid'
  );
});

Deno.test('resetScreenState: status=invalid wins even past the timeout', () => {
  assertEquals(
    resetScreenState({ status: 'invalid', isRecovery: false, elapsedMs: RESET_VERIFY_TIMEOUT_MS * 10 }),
    'invalid'
  );
});

Deno.test('resetScreenState: isRecovery true (no invalid status) is form, regardless of elapsed time', () => {
  assertEquals(
    resetScreenState({ status: undefined, isRecovery: true, elapsedMs: 0 }),
    'form'
  );
  assertEquals(
    resetScreenState({ status: null, isRecovery: true, elapsedMs: RESET_VERIFY_TIMEOUT_MS * 10 }),
    'form'
  );
});

Deno.test('resetScreenState: isRecovery false, no status, under the timeout is verifying', () => {
  assertEquals(
    resetScreenState({ status: undefined, isRecovery: false, elapsedMs: 0 }),
    'verifying'
  );
  assertEquals(
    resetScreenState({ status: undefined, isRecovery: false, elapsedMs: RESET_VERIFY_TIMEOUT_MS - 1 }),
    'verifying'
  );
});

Deno.test('resetScreenState: isRecovery false, no status, at or past the timeout is invalid', () => {
  assertEquals(
    resetScreenState({ status: undefined, isRecovery: false, elapsedMs: RESET_VERIFY_TIMEOUT_MS }),
    'invalid'
  );
  assertEquals(
    resetScreenState({ status: null, isRecovery: false, elapsedMs: RESET_VERIFY_TIMEOUT_MS + 5000 }),
    'invalid'
  );
});

Deno.test('resetScreenState: isRecovery flips true exactly at the timeout boundary still reaches form', () => {
  // isRecovery is checked before the elapsed-time fallback, so a setSession
  // that resolves right as the timer fires does not lose to it.
  assertEquals(
    resetScreenState({ status: undefined, isRecovery: true, elapsedMs: RESET_VERIFY_TIMEOUT_MS }),
    'form'
  );
});

Deno.test('resetScreenState: a user signed in for an unrelated reason (isRecovery false) never reaches form', () => {
  // The whole point of keying on isRecovery instead of "any session at
  // all": this case is indistinguishable from "no session" to this
  // function, and must resolve to invalid once the timeout elapses rather
  // than ever showing the recovery form.
  assertEquals(
    resetScreenState({ status: undefined, isRecovery: false, elapsedMs: 0 }),
    'verifying'
  );
  assertEquals(
    resetScreenState({ status: undefined, isRecovery: false, elapsedMs: RESET_VERIFY_TIMEOUT_MS }),
    'invalid'
  );
});
