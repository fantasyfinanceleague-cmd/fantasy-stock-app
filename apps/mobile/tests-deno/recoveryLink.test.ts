/**
 * Hermetic unit tests for lib/recoveryLink.ts: the PKCE password-recovery deep link's URL parsing and
 * the reset screen's state. Run from apps/mobile/tests-deno (see that directory's deno.json):
 *
 *   cd apps/mobile/tests-deno && deno test .
 *
 * or, from repo root:
 *
 *   deno test apps/mobile/tests-deno/recoveryLink.test.ts
 *
 * Covers F2 (deep-link session fixation) in its PKCE form: the link carries only a one-time CODE, read
 * strictly from the URL's query (before '#'), never the fragment; an error redirect wins over a code;
 * and an old-style link with tokens in the fragment yields no code at all, so it can only fail closed.
 * (The nonce this file used to test is gone: the exchange itself is bound to this device, see
 * lib/recoveryLink.ts and onboarding-w2-auth.test.ts.)
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import {
  buildRecoveryRedirect,
  isRecoveryExchange,
  parseRecoveryLink,
  resetScreenState,
  RESET_VERIFY_TIMEOUT_MS,
} from '../lib/recoveryLink.ts';

const CODE = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

Deno.test('parseRecoveryLink: a genuine PKCE link yields its code', () => {
  assertEquals(parseRecoveryLink(`fantasystockapp://reset-password?flow=pkce&code=${CODE}`, false), { kind: 'code', code: CODE });
  assertEquals(parseRecoveryLink(`fantasystockapp://reset-password?code=${CODE}`, false), { kind: 'code', code: CODE });
  assertEquals(parseRecoveryLink(`fantasystockapp:///reset-password?flow=pkce&code=${CODE}`, false), { kind: 'code', code: CODE });
});

Deno.test('parseRecoveryLink: a code smuggled into the FRAGMENT is never read', () => {
  assertEquals(parseRecoveryLink(`fantasystockapp://reset-password?flow=pkce#code=${CODE}`, false), { kind: 'empty' });
  assertEquals(parseRecoveryLink(`fantasystockapp://reset-password#code=${CODE}`, false), { kind: 'empty' });
  // Query code wins and the fragment one is ignored.
  const other = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  assertEquals(parseRecoveryLink(`fantasystockapp://reset-password?code=${CODE}#code=${other}`, false), { kind: 'code', code: CODE });
  // A `?code=` that appears only AFTER the '#' is fragment text.
  assertEquals(parseRecoveryLink(`fantasystockapp://reset-password#x=1?code=${CODE}`, false), { kind: 'empty' });
});

Deno.test('parseRecoveryLink: an old-style link (tokens in the fragment, a pre-PKCE build) has no code: fail closed', () => {
  const old = `fantasystockapp://reset-password?rn=${'a'.repeat(64)}#access_token=at&refresh_token=rt&type=recovery`;
  assertEquals(parseRecoveryLink(old, false), { kind: 'empty' });
});

Deno.test('parseRecoveryLink: expired / used link reports its error, in the query (PKCE) or the fragment (implicit)', () => {
  assertEquals(
    parseRecoveryLink('fantasystockapp://reset-password?flow=pkce&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', false),
    { kind: 'error', code: 'otp_expired' }
  );
  assertEquals(
    parseRecoveryLink('fantasystockapp://reset-password#error=access_denied&error_code=otp_expired', false),
    { kind: 'error', code: 'otp_expired' }
  );
  assertEquals(parseRecoveryLink('fantasystockapp://reset-password?error=access_denied', false), { kind: 'error', code: 'access_denied' });
});

Deno.test('parseRecoveryLink: an error wins even if a code is also present', () => {
  assertEquals(
    parseRecoveryLink(`fantasystockapp://reset-password?code=${CODE}&error_code=otp_expired`, false),
    { kind: 'error', code: 'otp_expired' }
  );
});

Deno.test('parseRecoveryLink: the right path with no usable code is "empty"', () => {
  for (const url of [
    'fantasystockapp://reset-password',
    'fantasystockapp://reset-password?flow=pkce',
    'fantasystockapp://reset-password?code=',
    'fantasystockapp://reset-password?code=short',
    `fantasystockapp://reset-password?code=${'x'.repeat(300)}`,
    'fantasystockapp://reset-password?code=has%20space%20in%20it',
    'fantasystockapp://reset-password?code=<script>alert(1)</script>',
  ]) {
    assertEquals(parseRecoveryLink(url, false), { kind: 'empty' }, url);
  }
});

Deno.test('parseRecoveryLink: anything that is not exactly the recovery path is "none"', () => {
  for (const url of [
    '',
    `fantasystockapp://auth/confirm?code=${CODE}`,
    `fantasystockapp://reset-passwordx?code=${CODE}`,
    `fantasystockapp://reset-password/evil?code=${CODE}`,
    `fantasystockapp://login?next=reset-password&code=${CODE}`,
    `https://evil.example/reset-password?code=${CODE}`,
    `evilfantasystockapp://reset-password?code=${CODE}`,
    `fantasystockapp://join-league#reset-password`,
  ]) {
    assertEquals(parseRecoveryLink(url, false), { kind: 'none' }, url);
  }
});

Deno.test('parseRecoveryLink: the bare-path and exp(s):// shapes are dev-only', () => {
  for (const url of [`/reset-password?code=${CODE}`, `exp://127.0.0.1:8081/--/reset-password?code=${CODE}`]) {
    assertEquals(parseRecoveryLink(url, false), { kind: 'none' }, `release: ${url}`);
    assertEquals(parseRecoveryLink(url, true), { kind: 'code', code: CODE }, `dev: ${url}`);
    assertEquals(parseRecoveryLink(url), { kind: 'none' }, `default under Deno (no __DEV__): ${url}`);
  }
});

Deno.test('buildRecoveryRedirect: no secret, and a query so the narrow F2 allow-list entry still matches', () => {
  const redirect = buildRecoveryRedirect();
  assertEquals(redirect, 'fantasystockapp://reset-password?flow=pkce');
  // The dashboard patterns Giorgio may have (docs/security/DEPLOY-RUNBOOK.md step 2): `**` matches anything.
  const glob = (pattern: string) =>
    new RegExp('^' + pattern.split('**').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  assert(glob('fantasystockapp://**').test(redirect));
  assert(glob('fantasystockapp://reset-password?**').test(redirect));
  // ...whereas a query-less URL would NOT match the narrow entry (the reason for the query):
  assertFalse(glob('fantasystockapp://reset-password?**').test('fantasystockapp://reset-password'));
  // The parser accepts what the redirect builds, with a code added by GoTrue.
  assertEquals(parseRecoveryLink(`${redirect}&code=${CODE}`, false), { kind: 'code', code: CODE });
});

Deno.test('isRecoveryExchange: only a recovery exchange opens the form, under either spelling supabase-js has used', () => {
  assert(isRecoveryExchange('PASSWORD_RECOVERY')); // auth-js 2.89 (the locked version)
  assert(isRecoveryExchange('recovery')); // auth-js 2.108 (what a lockfile refresh could pull in)
  for (const other of [null, undefined, '', 'password_recovery', 'RECOVERY', 'SIGNUP', 'signup', 'magiclink']) {
    assertFalse(isRecoveryExchange(other as string | null | undefined), String(other));
  }
});

// ── resetScreenState ─────────────────────────────────────────────────────────

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
