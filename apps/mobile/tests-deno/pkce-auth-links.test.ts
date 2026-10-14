/**
 * Onboarding W2 (PKCE): the two email return links, the code exchange behind them, and the crypto
 * PKCE needs on Hermes.
 *
 *   cd apps/mobile/tests-deno && deno test .
 *
 * With flowType 'pkce' (lib/supabase.ts) the confirmation link and the password-recovery link carry one
 * one-time CODE; supabase.auth.exchangeCodeForSession(code) succeeds only on the device that stored the
 * code verifier when the flow began. These tests drive the REAL handler (lib/auth/authLinkHandlers.ts)
 * with a fake client for every outcome, the pure parsers for every shape, and auth-js's own PKCE helpers
 * against the crypto shim (when node_modules is present).
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { createRequire } from 'node:module';
import {
  AUTH_LINK_BASES,
  buildConfirmRedirect,
  createLinkDedupe,
  decideConfirmLink,
  isConfirmLink,
  isConfirmRoute,
  isSignupExchange,
  parseConfirmLink,
} from '../lib/auth/confirmLink.ts';
import { readLinkOutcome, redirectTypeOf } from '../lib/auth/authLink.ts';
import { isRecoveryExchange, isRecoveryRoute } from '../lib/recoveryLink.ts';
import { createAuthLinkHandler, type AuthLinkDeps, type ExchangeResult } from '../lib/auth/authLinkHandlers.ts';
import { createResendCooldown, RESEND_COOLDOWN_MS, RESEND_TOO_SOON } from '../lib/auth/resendCooldown.ts';
import { LEGACY_AUTH_KEYS, removeLegacyAuthKeys } from '../lib/auth/legacyAuthKeys.ts';
import { getAuthErrorMessage } from '../lib/authErrors.ts';
import { fillWithRandomBytes, hasWebCrypto, installPkceCrypto, pkceCryptoReady, pkceReady, Utf8TextEncoder } from '../lib/auth/pkceCrypto.ts';
import { isEmailJustConfirmed, setEmailJustConfirmed, subscribeEmailJustConfirmed } from '../lib/auth/emailConfirmed.ts';
import { createPendingRoute } from '../lib/shell/pendingRoute.ts';
import { resolveResumeTarget } from '../lib/shell/resumeTarget.ts';
import { SOURCES } from './sourceManifest.generated.ts';
import APP_JSON from '../app.json' with { type: 'json' };

const CODE = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const glob = (pattern: string) =>
  new RegExp('^' + pattern.split('**').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');

// ── the redirect and the link's shape ─────────────────────────────────────

Deno.test('confirm redirect: the scheme, no query and no secret; the dashboard pattern matches it', () => {
  assertEquals(AUTH_LINK_BASES[0], 'fantasystockapp://');
  assertEquals(buildConfirmRedirect(), 'fantasystockapp://auth/confirm');
  assertEquals(APP_JSON.expo.scheme + '://', AUTH_LINK_BASES[0]); // app.json's scheme, or the email goes nowhere
  // The exact Redirect URL pattern the hand-back tells Giorgio to add, and the broader F2 one.
  assert(glob('fantasystockapp://auth/confirm**').test(buildConfirmRedirect()));
  assert(glob('fantasystockapp://**').test(buildConfirmRedirect()));
  // What GoTrue redirects to once it adds the code still matches the same pattern.
  assert(glob('fantasystockapp://auth/confirm**').test(`${buildConfirmRedirect()}?code=${CODE}`));
});

Deno.test('isConfirmLink: the registered origins sign in, in a release build', () => {
  for (const url of [
    `fantasystockapp://auth/confirm?code=${CODE}`, // host form, as GoTrue redirects
    `fantasystockapp:///auth/confirm?code=${CODE}`, // empty-host form
    'fantasystockapp://auth/confirm/',
  ]) {
    assert(isConfirmLink(url, false), url);
    assert(isConfirmLink(url, true), url);
  }
});

Deno.test('isConfirmLink: the bare-path and exp(s):// shapes are DEV-ONLY (a release build never signs in from them)', () => {
  for (const url of [
    'exp://127.0.0.1:8081/--/auth/confirm?code=x',
    'exps://host.example:443/--/auth/confirm?code=x',
    '/auth/confirm?code=x',
    '//auth/confirm',
  ]) {
    assert(isConfirmLink(url, true), `dev: ${url}`);
    assertFalse(isConfirmLink(url, false), `release: ${url}`);
    assertFalse(isConfirmLink(url), `default (no __DEV__ under Deno) must be the release rule: ${url}`);
    assertEquals(parseConfirmLink(`${url}&code=${CODE}`, false), { kind: 'none' }, url);
  }
  assertEquals(parseConfirmLink(`exp://127.0.0.1:8081/--/auth/confirm?code=${CODE}`, true), { kind: 'code', code: CODE });
});

Deno.test('isConfirmRoute: navigation only: every shape redirects to sign-in, none of them signs anyone in', () => {
  for (const p of ['/auth/confirm', '/auth/confirm?code=x', 'fantasystockapp://auth/confirm?code=x', 'exp://h:1/--/auth/confirm']) {
    assert(isConfirmRoute(p), p);
  }
  for (const p of ['/auth/confirmx', '/auth', '/login', 'https://evil.example/auth/confirm', '', null, undefined]) {
    assertFalse(isConfirmRoute(p as string), String(p));
  }
});

Deno.test('isConfirmLink: look-alikes, other routes and other origins are not confirm links', () => {
  for (const url of [
    'fantasystockapp://auth/confirmx',
    'fantasystockapp://auth/confirm/evil',
    'fantasystockapp://auth',
    `fantasystockapp://reset-password?code=${CODE}`,
    'fantasystockapp://join-league?code=X#auth/confirm',
    `https://evil.example/auth/confirm?code=${CODE}`,
    'evilfantasystockapp://auth/confirm',
    'exp://127.0.0.1:8081/auth/confirm', // no /--/ marker
    '',
    null,
    undefined,
  ]) {
    assertFalse(isConfirmLink(url as string, true), `dev: ${String(url)}`);
    assertFalse(isConfirmLink(url as string, false), `release: ${String(url)}`);
  }
});

Deno.test('parseConfirmLink: the code comes from the QUERY only, shaped like a GoTrue code', () => {
  assertEquals(parseConfirmLink(`fantasystockapp://auth/confirm?code=${CODE}`, false), { kind: 'code', code: CODE });
  // A code in the fragment (attacker-shapeable) is never read.
  assertEquals(parseConfirmLink(`fantasystockapp://auth/confirm#code=${CODE}`, false), { kind: 'empty' });
  assertEquals(parseConfirmLink(`fantasystockapp://auth/confirm#x=1?code=${CODE}`, false), { kind: 'empty' });
  const other = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  assertEquals(parseConfirmLink(`fantasystockapp://auth/confirm?code=${CODE}#code=${other}`, false), { kind: 'code', code: CODE });
  // Not a code: empty, short, huge, odd characters.
  for (const bad of ['', 'short', 'x'.repeat(300), 'has space in it', '<script>', 'a/b/c/d/e/f/g/h']) {
    assertEquals(readLinkOutcome(`fantasystockapp://auth/confirm?code=${encodeURIComponent(bad)}`), { kind: 'empty' }, bad);
  }
});

Deno.test('parseConfirmLink: the error redirect (query or fragment) wins over a code; an old tokens link has no code', () => {
  assertEquals(
    parseConfirmLink('fantasystockapp://auth/confirm?error=access_denied&error_code=otp_expired&error_description=x', false),
    { kind: 'error', code: 'otp_expired' }
  );
  assertEquals(parseConfirmLink('fantasystockapp://auth/confirm#error=access_denied&error_code=otp_expired', false), {
    kind: 'error',
    code: 'otp_expired',
  });
  assertEquals(parseConfirmLink(`fantasystockapp://auth/confirm?code=${CODE}&error_code=otp_expired`, false), {
    kind: 'error',
    code: 'otp_expired',
  });
  // A pre-PKCE link (tokens in the fragment): there is nothing to exchange, so it can only fail closed.
  assertEquals(
    parseConfirmLink('fantasystockapp://auth/confirm?cn=abc#access_token=AT&refresh_token=RT&type=signup', false),
    { kind: 'empty' }
  );
  assertEquals(parseConfirmLink('fantasystockapp://auth/confirm', false), { kind: 'empty' });
  assertEquals(parseConfirmLink('fantasystockapp://reset-password?code=' + CODE, false), { kind: 'none' });
});

// ── the pre-exchange decision, the exchange type, and small helpers ───────

Deno.test('decideConfirmLink: only a code with NO session exchanges', () => {
  assertEquals(decideConfirmLink({ kind: 'code', code: CODE }, false), { kind: 'exchange', code: CODE });
  assertEquals(decideConfirmLink({ kind: 'code', code: CODE }, true), { kind: 'ignore' }); // never replaces a session
  for (const other of [{ kind: 'error', code: 'otp_expired' }, { kind: 'empty' }, { kind: 'none' }] as const) {
    for (const hasSession of [true, false]) assertEquals(decideConfirmLink(other, hasSession).kind, 'ignore');
  }
});

Deno.test('exchange type: a sign-up confirmation is a null redirectType; a recovery code is not one', () => {
  for (const ok of [null, undefined, '']) assert(isSignupExchange(ok), String(ok));
  for (const no of ['PASSWORD_RECOVERY', 'recovery', 'x']) assertFalse(isSignupExchange(no), no);
  assertEquals(redirectTypeOf({ redirectType: 'PASSWORD_RECOVERY' }), 'PASSWORD_RECOVERY');
  assertEquals(redirectTypeOf({ redirectType: null }), null);
  assertEquals(redirectTypeOf({}), null);
  assertEquals(redirectTypeOf(null), null);
  assertEquals(redirectTypeOf({ redirectType: 5 }), null);
});

Deno.test('dedupe: a cold-start link delivered twice is handled once; distinct links each get one run; bounded', () => {
  const d = createLinkDedupe(3);
  const a = `fantasystockapp://auth/confirm?code=${CODE}`;
  assertEquals(d.firstTime(a), true);
  assertEquals(d.firstTime(a), false); // getInitialURL + the 'url' event
  assertEquals(d.firstTime(a), false);
  assertEquals(d.firstTime(`fantasystockapp://auth/confirm?code=${'b'.repeat(36)}`), true);
  for (const k of ['k1', 'k2', 'k3']) d.firstTime(k); // pushes `a` out of the 3-entry window
  assertEquals(d.firstTime(a), true, 'the window is bounded (oldest forgotten)');
});

Deno.test('neither link is ever stored for resume, and a pending link survives the round-trip', () => {
  for (const link of [
    `fantasystockapp://auth/confirm?code=${CODE}`,
    'fantasystockapp://auth/confirm',
    `fantasystockapp://reset-password?flow=pkce&code=${CODE}`,
  ]) {
    assertEquals(resolveResumeTarget(link), null, link);
  }
  const pending = createPendingRoute();
  pending.authChanged('signedOut');
  pending.record('fantasystockapp:///join-league');
  pending.record(`fantasystockapp://auth/confirm?code=${CODE}`); // the confirmation round-trip
  assertEquals(pending.peek(), '/join-league');
  pending.authChanged('gated'); // the exchange signed in; the username gate shows
  assertEquals(pending.authChanged('ready'), '/join-league'); // then the waiting link resumes
});

Deno.test('just-confirmed flag: subscribable, idempotent, and cleared on sign-out', () => {
  assertEquals(isEmailJustConfirmed(), false);
  let calls = 0;
  const off = subscribeEmailJustConfirmed(() => calls++);
  setEmailJustConfirmed(true);
  setEmailJustConfirmed(true); // no change, no notification
  assertEquals([isEmailJustConfirmed(), calls], [true, 1]);
  setEmailJustConfirmed(false);
  off();
  setEmailJustConfirmed(true);
  assertEquals(calls, 2); // unsubscribed
  setEmailJustConfirmed(false);
  const sp = SOURCES['lib/SessionProvider.tsx'];
  assert(sp.slice(sp.indexOf("event === 'SIGNED_OUT'")).includes('setEmailJustConfirmed(false)'));
});

// ── the handler: every outcome, with a fake client ────────────────────────

const exchangeOk = (redirectType: string | null, id = 'user-1'): ExchangeResult =>
  ({ data: { session: { access_token: 't' }, user: { id }, redirectType }, error: null }) as unknown as ExchangeResult;
const exchangeFailed = (code = 'flow_state_not_found'): ExchangeResult => ({ data: { session: null, user: null }, error: { code } });

function harness(
  o: { session?: boolean; exchange?: ExchangeResult; confirmEnabled?: boolean; keepPushError?: boolean; recoveryOpen?: boolean; signOutError?: boolean } = {}
) {
  const calls: string[] = [];
  const exchanged: string[] = [];
  const deps: AuthLinkDeps = {
    confirmEnabled: o.confirmEnabled ?? true,
    getSession: async () => ({ data: { session: o.session ? { access_token: 'existing' } : null } }),
    exchangeCodeForSession: async (code) => {
      exchanged.push(code);
      calls.push('exchange');
      await Promise.resolve();
      return o.exchange ?? exchangeOk(null);
    },
    signOut: async () => {
      calls.push('signOut');
      return { error: o.signOutError ? { code: 'network' } : null };
    },
    isRecoveryActive: () => !!o.recoveryOpen,
    removePushToken: async (id) => {
      calls.push(`removePushToken:${id}`);
      if (o.keepPushError) throw new Error('boom');
    },
    setEmailJustConfirmed: (v) => void calls.push(`confirmed:${v}`),
    setRecoverySession: (v) => void calls.push(`recovery:${v}`),
    replaceRoute: (p) => void calls.push(`route:${p}`),
    warn: () => void calls.push('warn'),
    dedupe: createLinkDedupe(),
  };
  return { handle: createAuthLinkHandler(deps), calls, exchanged };
}
const CONFIRM_URL = `fantasystockapp://auth/confirm?code=${CODE}`;
const RESET_URL = `fantasystockapp://reset-password?flow=pkce&code=${CODE}`;

Deno.test('confirm: a valid code on the device that began the sign-up signs in and marks the email confirmed', async () => {
  const h = harness();
  assertEquals(await h.handle(CONFIRM_URL), 'confirm-signed-in');
  assertEquals(h.exchanged, [CODE]);
  assertEquals(h.calls, ['exchange', 'confirmed:true']);
});

Deno.test('confirm: with a session already present nothing is exchanged (the verifier is not spent)', async () => {
  const h = harness({ session: true });
  assertEquals(await h.handle(CONFIRM_URL), 'confirm-ignored');
  assertEquals(h.calls, []);
});

Deno.test('confirm: another device / a spent, expired or forged code: the exchange is refused and nothing else happens', async () => {
  for (const code of ['flow_state_not_found', 'validation_failed', 'bad_code_verifier', '']) {
    const h = harness({ exchange: exchangeFailed(code) });
    assertEquals(await h.handle(CONFIRM_URL), 'confirm-failed', code);
    assertEquals(h.calls, ['exchange', 'warn'], code); // no flag, no sign-out, no route change
  }
  // An exchange that reports success but hands back no session is a failure too.
  const odd = harness({ exchange: { data: { session: null, user: null }, error: null } });
  assertEquals(await odd.handle(CONFIRM_URL), 'confirm-failed');
  assertFalse(odd.calls.includes('confirmed:true'));
});

Deno.test('confirm: a RECOVERY code on the confirm path is signed back out and is not "email confirmed"', async () => {
  const h = harness({ exchange: exchangeOk('PASSWORD_RECOVERY', 'attacker-or-owner') });
  assertEquals(await h.handle(CONFIRM_URL), 'confirm-wrong-type');
  assertEquals(h.calls, ['exchange', 'warn', 'removePushToken:attacker-or-owner', 'signOut']);
  // Even if dropping the push token throws, the sign-out still happens.
  const h2 = harness({ exchange: exchangeOk('PASSWORD_RECOVERY'), keepPushError: true });
  assertEquals(await h2.handle(CONFIRM_URL), 'confirm-wrong-type');
  assert(h2.calls.includes('signOut'));
});

Deno.test('confirm: an error redirect, a link with no code, and the dev fixture exchange nothing', async () => {
  for (const url of [
    'fantasystockapp://auth/confirm?error=access_denied&error_code=otp_expired',
    'fantasystockapp://auth/confirm',
    'fantasystockapp://auth/confirm?code=short',
    'fantasystockapp://auth/confirm?cn=abc#access_token=AT&refresh_token=RT&type=signup', // a pre-PKCE link
  ]) {
    const h = harness();
    assertEquals(await h.handle(url), 'confirm-ignored', url);
    assertEquals(h.exchanged, [], url);
  }
  const fixture = harness({ confirmEnabled: false });
  assertEquals(await fixture.handle(CONFIRM_URL), 'confirm-ignored');
  assertEquals(fixture.exchanged, []);
});

Deno.test('dedupe: the same link delivered twice at once is exchanged ONCE (getInitialURL + the url event race)', async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.handle(CONFIRM_URL), h.handle(CONFIRM_URL)]);
  assertEquals([a, b].sort(), ['confirm-signed-in', 'duplicate']);
  assertEquals(h.exchanged, [CODE]);
  const r = harness({ exchange: exchangeOk('PASSWORD_RECOVERY') });
  const [c, d] = await Promise.all([r.handle(RESET_URL), r.handle(RESET_URL)]);
  assertEquals([c, d].sort(), ['duplicate', 'recovery-form']);
  assertEquals(r.exchanged, [CODE]);
  assertFalse(r.calls.includes('route:/reset-password?status=invalid'), 'a duplicate must not flip a working reset to invalid');
});

Deno.test('recovery: a PASSWORD_RECOVERY exchange sets the flag and opens the form', async () => {
  const h = harness({ exchange: exchangeOk('PASSWORD_RECOVERY') });
  assertEquals(await h.handle(RESET_URL), 'recovery-form');
  assertEquals(h.calls, ['exchange', 'recovery:true', 'route:/reset-password']);
});

Deno.test('recovery: fail closed: an expired / used / forged / other-device code lands on the invalid screen with no flag', async () => {
  for (const code of ['flow_state_not_found', 'validation_failed', 'bad_code_verifier', '']) {
    const h = harness({ exchange: exchangeFailed(code) });
    assertEquals(await h.handle(RESET_URL), 'recovery-invalid', code);
    assertEquals(h.calls, ['exchange', 'recovery:false', 'route:/reset-password?status=invalid'], code);
  }
});

Deno.test('recovery: a SIGN-UP code presented on the reset path is refused AND signed back out', async () => {
  const h = harness({ exchange: exchangeOk(null, 'someone') });
  assertEquals(await h.handle(RESET_URL), 'recovery-invalid');
  assertEquals(h.calls, ['exchange', 'removePushToken:someone', 'signOut', 'recovery:false', 'route:/reset-password?status=invalid']);
  assertFalse(h.calls.includes('recovery:true'));
});

Deno.test('recovery: an error redirect, no code, or an old-style fragment link goes invalid WITHOUT touching the client', async () => {
  for (const url of [
    'fantasystockapp://reset-password?flow=pkce&error=access_denied&error_code=otp_expired',
    'fantasystockapp://reset-password#error=access_denied&error_code=otp_expired',
    'fantasystockapp://reset-password',
    'fantasystockapp://reset-password?flow=pkce',
    `fantasystockapp://reset-password?rn=${'a'.repeat(64)}#access_token=at&refresh_token=rt&type=recovery`,
    `fantasystockapp://reset-password#code=${CODE}`,
  ]) {
    const h = harness();
    assertEquals(await h.handle(url), 'recovery-invalid', url);
    assertEquals(h.calls, ['recovery:false', 'route:/reset-password?status=invalid'], url);
    assertEquals(h.exchanged, [], url);
  }
});

Deno.test('recovery: works with a session already present (a reset is how a locked-out person gets back in)', async () => {
  const h = harness({ session: true, exchange: exchangeOk('PASSWORD_RECOVERY') });
  assertEquals(await h.handle(RESET_URL), 'recovery-form');
  assertEquals(h.exchanged, [CODE]);
});

Deno.test('recovery: a dead or crafted link must not close a genuine reset that is already open', async () => {
  for (const url of [
    'fantasystockapp://reset-password?flow=pkce&error=access_denied&error_code=otp_expired',
    'fantasystockapp://reset-password',
    `fantasystockapp://reset-password#access_token=at&refresh_token=rt&type=recovery`,
  ]) {
    const h = harness({ recoveryOpen: true });
    assertEquals(await h.handle(url), 'recovery-ignored', url);
    assertEquals(h.calls, [], url); // no flag change, no route change
  }
  // ...but a code still exchanges (a fresh reset replaces the open one), and with no reset open it goes invalid.
  const fresh = harness({ recoveryOpen: true, exchange: exchangeOk('PASSWORD_RECOVERY') });
  assertEquals(await fresh.handle(RESET_URL), 'recovery-form');
});

Deno.test('recovery: a well-formed JUNK code while a genuine reset is open is ignored too; a wrong-type session is still signed out', async () => {
  const open = harness({ recoveryOpen: true, exchange: exchangeFailed('bad_code_verifier') });
  assertEquals(await open.handle(RESET_URL), 'recovery-ignored');
  assertEquals(open.calls, ['exchange'], 'the open form keeps its flag and its route');
  // With nothing open the same failure still fails closed.
  const closed = harness({ recoveryOpen: false, exchange: exchangeFailed('bad_code_verifier') });
  assertEquals(await closed.handle(RESET_URL), 'recovery-invalid');
  // ...and a confirmation code (a REAL session of the wrong type) is signed out even with a reset open.
  const wrong = harness({ recoveryOpen: true, exchange: exchangeOk(null, 'someone') });
  assertEquals(await wrong.handle(RESET_URL), 'recovery-invalid');
  assert(wrong.calls.includes('signOut'));
});

Deno.test('wrong-type refusals use a local sign-out and say so when it fails (a refusal must not silently leave a session)', async () => {
  const h = harness({ exchange: exchangeOk('PASSWORD_RECOVERY'), signOutError: true });
  assertEquals(await h.handle(CONFIRM_URL), 'confirm-wrong-type');
  assertEquals(h.calls.filter((c) => c === 'warn').length, 2, 'the refusal warning and the failed-sign-out warning');
  const r = harness({ exchange: exchangeOk(null), signOutError: true });
  assertEquals(await r.handle(RESET_URL), 'recovery-invalid');
  assert(r.calls.includes('warn'));
  assert(SOURCES['app/_layout.tsx'].includes("signOut: () => supabase.auth.signOut({ scope: 'local' }),"), 'never the account\'s other devices');
  assert(SOURCES['app/_layout.tsx'].includes('isRecoveryActive: isRecoverySession,'));
});

Deno.test('handler: a link that is neither is "none" and touches nothing', async () => {
  for (const url of ['', 'fantasystockapp://join-league?code=ABC123', 'https://example.com/reset-password?code=' + CODE, 'fantasystockapp://login']) {
    const h = harness();
    assertEquals(await h.handle(url), 'none', url);
    assertEquals(h.calls, [], url);
  }
});

// ── PKCE needs a WebCrypto Hermes doesn't have ────────────────────────────

const denoCrypto = globalThis.crypto; // the real one, captured before any test swaps it
const nativeDeps = {
  getRandomValues: <T extends ArrayBufferView>(a: T) => denoCrypto.getRandomValues(a as unknown as Uint8Array) as unknown as T,
  digest: (alg: 'SHA-256', data: BufferSource) => denoCrypto.subtle.digest(alg, data),
};
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

Deno.test('pkceCrypto: installs getRandomValues + SHA-256 digest where there is no crypto; never replaces a real WebCrypto', async () => {
  const hermes: Record<string, unknown> = {};
  assertFalse(hasWebCrypto(hermes));
  installPkceCrypto(hermes, nativeDeps);
  assert(hasWebCrypto(hermes));
  const c = hermes.crypto as { getRandomValues: (a: Uint32Array) => Uint32Array; subtle: { digest: (a: unknown, d: BufferSource) => Promise<ArrayBuffer> } };
  assert(c.getRandomValues(new Uint32Array(8)).some((n) => n !== 0));
  const expected = new Uint8Array(await denoCrypto.subtle.digest('SHA-256', new TextEncoder().encode('abc')));
  assertEquals(new Uint8Array(await c.subtle.digest('SHA-256', new TextEncoder().encode('abc'))), expected);
  assertEquals(new Uint8Array(await c.subtle.digest({ name: 'sha-256' }, new TextEncoder().encode('abc'))), expected);
  // Anything but SHA-256 is refused (fail closed, never a weaker hash).
  for (const alg of ['SHA-1', 'MD5', '', undefined]) {
    let rejected = false;
    await c.subtle.digest(alg, new Uint8Array(1)).catch(() => (rejected = true));
    assert(rejected, String(alg));
  }
  // A complete WebCrypto is left exactly as it was.
  const real = { crypto: denoCrypto };
  installPkceCrypto(real, { getRandomValues: () => { throw new Error('must not be used'); }, digest: () => { throw new Error('must not be used'); } });
  assertEquals(real.crypto, denoCrypto);
  // A partial one (no subtle) is completed, keeping what it had.
  const partial: Record<string, unknown> = { crypto: { getRandomValues: () => 1, other: 'kept' } };
  installPkceCrypto(partial, nativeDeps);
  assert(hasWebCrypto(partial));
  assertEquals((partial.crypto as { other: string }).other, 'kept');
});

Deno.test('pkceCrypto: a TextEncoder shim for engines without one (UTF-8, including non-ASCII)', () => {
  const t: Record<string, unknown> = {};
  installPkceCrypto(t, nativeDeps);
  assertEquals(t.TextEncoder, Utf8TextEncoder);
  const enc = new Utf8TextEncoder();
  for (const text of ['', 'abc', 'é', 'Ā', 'Ω', 'ߺ', '€', '😀', 'verifier-0123_~.']) {
    assertEquals(enc.encode(text), new TextEncoder().encode(text), text);
  }
  const keep: Record<string, unknown> = { TextEncoder };
  installPkceCrypto(keep, nativeDeps);
  assertEquals(keep.TextEncoder, TextEncoder);
});

// auth-js's own helpers, run against the shim: proves the library takes the CSPRNG + S256 path (not
// Math.random + plain). Needs node_modules (npm ci in apps/mobile); skipped, loudly, when absent.
type Helpers = { generatePKCEVerifier: () => string; generatePKCEChallenge: (v: string) => Promise<string> };
let helpers: Helpers | null = null;
try {
  // auth-js ships CommonJS; load it as Node would. (A static import would also make Deno type-check
  // its d.ts graph, which needs DOM-only types.)
  const require = createRequire(import.meta.url);
  const specifier = ['..', 'node_modules', '@supabase', 'auth-js', 'dist', 'main', 'lib', 'helpers.js'].join('/');
  helpers = require(specifier) as Helpers;
} catch {
  console.warn('[pkce-auth-links] @supabase/auth-js not installed: the auth-js PKCE helper tests are SKIPPED');
}

async function withoutNativeCrypto<T>(install: boolean, fn: () => Promise<T>): Promise<{ result: T; warned: boolean; usedMathRandom: boolean }> {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const origRandom = Math.random;
  const origWarn = console.warn;
  let warned = false;
  let usedMathRandom = false;
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true }); // Hermes
    if (install) installPkceCrypto(globalThis as unknown as Record<string, unknown>, nativeDeps);
    Math.random = () => ((usedMathRandom = true), 0.5);
    console.warn = () => void (warned = true);
    return { result: await fn(), warned, usedMathRandom };
  } finally {
    Math.random = origRandom;
    console.warn = origWarn;
    if (desc) Object.defineProperty(globalThis, 'crypto', desc);
    else delete (globalThis as Record<string, unknown>).crypto;
  }
}

Deno.test({
  name: 'pkceCrypto + auth-js: with the shim the verifier is CSPRNG-made and the challenge is S256(verifier), not plain',
  ignore: helpers === null,
  async fn() {
    const out = await withoutNativeCrypto(true, async () => {
      const verifier = helpers!.generatePKCEVerifier();
      const challenge = await helpers!.generatePKCEChallenge(verifier);
      return { verifier, challenge };
    });
    const { verifier, challenge } = out.result;
    assertEquals(out.usedMathRandom, false, 'the verifier must not come from Math.random');
    assertEquals(out.warned, false, 'auth-js must not warn that WebCrypto is unsupported');
    assert(verifier.length >= 43, 'RFC 7636 minimum verifier length');
    assert(verifier !== challenge, 'the challenge must not be the verifier (that is the "plain" method)');
    const expected = b64url(new Uint8Array(await denoCrypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    assertEquals(challenge, expected);
    // Two verifiers differ.
    const again = await withoutNativeCrypto(true, async () => helpers!.generatePKCEVerifier());
    assert(again.result !== verifier);
  },
});

Deno.test({
  name: 'pkceCrypto + auth-js: WITHOUT the shim (what Hermes does today) auth-js uses Math.random and the plain method',
  ignore: helpers === null,
  async fn() {
    const out = await withoutNativeCrypto(false, async () => {
      const verifier = helpers!.generatePKCEVerifier();
      return { verifier, challenge: await helpers!.generatePKCEChallenge(verifier) };
    });
    assertEquals(out.usedMathRandom, true);
    assertEquals(out.warned, true);
    assertEquals(out.result.challenge, out.result.verifier); // the plain method: the reason the shim exists
  },
});

// ── the INSTALLED supabase-js, driven for real ────────────────────────────

type Json = Record<string, unknown>;
type GoTrueLike = {
  signUp(c: Json): Promise<{ data: Json; error: { code?: string } | null }>;
  resetPasswordForEmail(email: string, o?: Json): Promise<{ data: Json | null; error: { code?: string } | null }>;
  exchangeCodeForSession(code: string): Promise<{ data: Json; error: { code?: string } | null }>;
};
let GoTrueClient: (new (o: Json) => GoTrueLike) | null = null;
try {
  const req = createRequire(import.meta.url);
  const specifier = ['..', 'node_modules', '@supabase', 'auth-js', 'dist', 'main', 'GoTrueClient.js'].join('/');
  GoTrueClient = (req(specifier) as { default: new (o: Json) => GoTrueLike }).default;
} catch {
  console.warn('[pkce-auth-links] @supabase/auth-js not installed: the real-client PKCE tests are SKIPPED');
}

function realClient(storageItems = new Map<string, string>()) {
  const requests: { path: string; body: Json }[] = [];
  const user = { id: 'user-1', aud: 'authenticated', email: 'ada@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  const fakeFetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Json) : {};
    requests.push({ path: url.pathname + url.search, body });
    const ok = (json: unknown) => Promise.resolve(new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (url.pathname.endsWith('/recover')) return ok({});
    if (url.pathname.endsWith('/signup')) return ok(user);
    if (url.pathname.endsWith('/token')) return ok({ access_token: 'a.b.c', token_type: 'bearer', expires_in: 3600, refresh_token: 'r', user });
    return Promise.resolve(new Response('{}', { status: 404 }));
  };
  const client = new GoTrueClient!({
    url: 'https://example.supabase.co/auth/v1',
    headers: {},
    storageKey: 'test-auth',
    flowType: 'pkce',
    detectSessionInUrl: false,
    autoRefreshToken: false,
    persistSession: true,
    storage: {
      getItem: (k: string) => storageItems.get(k) ?? null,
      setItem: (k: string, v: string) => void storageItems.set(k, v),
      removeItem: (k: string) => void storageItems.delete(k),
    },
    fetch: fakeFetch,
    lock: (_name: string, _timeout: number, fn: () => Promise<unknown>) => fn(), // no navigator.locks under Deno
  });
  return { client, requests, storageItems };
}

Deno.test({
  name: 'real supabase-js: a reset exchanges as a recovery the app ACCEPTS, whatever spelling this version uses',
  ignore: GoTrueClient === null,
  async fn() {
    const { client, requests, storageItems } = realClient();
    const reset = await client.resetPasswordForEmail('ada@example.com', { redirectTo: 'fantasystockapp://reset-password?flow=pkce' });
    assertEquals(reset.error, null);
    const sent = requests.find((r) => r.path.includes('/recover'))!;
    assertEquals(sent.body.code_challenge_method, 's256', 'S256 under Deno (the shim gives Hermes the same)');
    assert(typeof sent.body.code_challenge === 'string' && (sent.body.code_challenge as string).length >= 43);
    const stored = storageItems.get('test-auth-code-verifier')!;
    assert(stored, 'the verifier is stored before the request, under <storageKey>-code-verifier');

    const ex = await client.exchangeCodeForSession(CODE);
    assertEquals(ex.error, null);
    const type = redirectTypeOf(ex.data);
    assert(type !== null, 'this supabase-js reports a redirectType for a reset');
    assert(isRecoveryExchange(type), `isRecoveryExchange must accept this library's recovery marker: ${type}`);
    assertFalse(isSignupExchange(type), 'and the confirm path must refuse it');
    const posted = requests.find((r) => r.path.includes('grant_type=pkce'))!;
    assertEquals(posted.body.auth_code, CODE);
    assertEquals(posted.body.code_verifier, (JSON.parse(stored) as string).split('/')[0], 'the exchange sends the verifier this device stored (auth-js JSON-encodes it in storage)');
    assertFalse(storageItems.has('test-auth-code-verifier'), 'single use: the verifier is gone after the exchange');
  },
});

Deno.test({
  name: 'real supabase-js: a sign-up exchanges as a plain confirmation the app accepts, and never as a recovery',
  ignore: GoTrueClient === null,
  async fn() {
    const { client, requests } = realClient();
    const up = await client.signUp({ email: 'ada@example.com', password: 'pw', options: { emailRedirectTo: buildConfirmRedirect() } });
    assertEquals(up.error, null);
    const sent = requests.find((r) => r.path.includes('/signup'))!;
    assertEquals(sent.body.code_challenge_method, 's256');
    assert(typeof sent.body.code_challenge === 'string');
    const ex = await client.exchangeCodeForSession(CODE);
    assertEquals(ex.error, null);
    const type = redirectTypeOf(ex.data);
    assert(isSignupExchange(type), `a sign-up must read as a confirmation: ${type}`);
    assertFalse(isRecoveryExchange(type), 'and never as a recovery');
  },
});

Deno.test({
  name: 'real supabase-js: another device (no stored verifier) cannot exchange, and never calls the network',
  ignore: GoTrueClient === null,
  async fn() {
    const { client, requests } = realClient(new Map());
    const ex = await client.exchangeCodeForSession(CODE);
    assert(ex.error !== null, 'refused');
    assertEquals(requests.filter((r) => r.path.includes('grant_type=pkce')).length, 0, 'no request without a verifier');
    assertEquals(redirectTypeOf(ex.data), null);
  },
});

Deno.test({
  name: 'real supabase-js: a sign-up and a reset share ONE verifier slot; the later flow wins (why Send again has a floor)',
  ignore: GoTrueClient === null,
  async fn() {
    const { client, storageItems } = realClient();
    await client.signUp({ email: 'ada@example.com', password: 'pw' });
    const first = storageItems.get('test-auth-code-verifier');
    await client.resetPasswordForEmail('ada@example.com');
    const second = storageItems.get('test-auth-code-verifier');
    assert(first && second && first !== second, 'the reset replaced the sign-up verifier');
    assert((JSON.parse(second) as string).includes('/'), 'and marks itself a recovery with a suffix');
  },
});

// ── the floor under "Send again" ─────────────────────────────────────────

Deno.test('resend cooldown: nothing inside GoTrue\'s interval, per address, case-insensitive, then allowed again', () => {
  let t = 1_000_000;
  const c = createResendCooldown(() => t, RESEND_COOLDOWN_MS);
  assertEquals(RESEND_COOLDOWN_MS, 60_000);
  assertEquals(c.remainingMs('ada@example.com'), 0, 'never sent: go ahead');
  c.markSent(' Ada@Example.com ');
  assertEquals(c.remainingMs('ada@example.com'), 60_000);
  t += 59_999;
  assertEquals(c.remainingMs('ADA@example.com'), 1);
  assertEquals(c.remainingMs('someone-else@example.com'), 0, 'another address is unaffected');
  t += 1;
  assertEquals(c.remainingMs('ada@example.com'), 0);
  c.markSent('');
  c.markSent('ada@example.com');
  assertEquals(c.remainingMs('ada@example.com'), 60_000, 're-marked');
  // Bounded: the oldest entry is forgotten past `max`.
  const small = createResendCooldown(() => t, 60_000, 2);
  small.markSent('a@x.io'); small.markSent('b@x.io'); small.markSent('c@x.io');
  assertEquals(small.remainingMs('a@x.io'), 0);
  assertEquals(small.remainingMs('c@x.io'), 60_000);
});

Deno.test('resend cooldown: enforced INSIDE signUp (every caller covered) and for password reset; the existing rate-limit line words it', () => {
  assertEquals(getAuthErrorMessage(RESEND_TOO_SOON, undefined, 'Stockpile'), 'Too many attempts — please wait a minute and try again.');
  const sp = SOURCES['lib/SessionProvider.tsx'];
  const signUp = sp.slice(sp.indexOf('const signUp = useCallback'), sp.indexOf('const fixtureSocial'));
  const check = signUp.indexOf('confirmationCooldown.remainingMs(email) > 0');
  assert(check > -1 && check < signUp.indexOf('supabase.auth.signUp('), 'the floor is checked BEFORE anything is sent');
  assert(signUp.includes('{ ...RESEND_TOO_SOON }'));
  assert(signUp.includes('if (!data?.session) confirmationCooldown.markSent(email);'), 'a successful send marks the address');
  // No caller needs its own copy of the rule: Create account, Check your email and Sign in all go through signUp.
  for (const f of ['components/shell/ConfirmEmailSent.tsx', 'app/login.tsx', 'app/create-account.tsx']) {
    assertFalse(SOURCES[f].includes('confirmationCooldown'), `${f} relies on signUp's floor`);
  }
  // Password reset has its own, marked only after a successful send and checked before anything is sent.
  const fp = SOURCES['app/forgot-password.tsx'];
  const resetCheck = fp.indexOf('resetCooldown.remainingMs(email) > 0');
  assert(resetCheck > -1 && resetCheck < fp.indexOf('resetPasswordForEmail('), 'the reset floor is checked first');
  assert(fp.indexOf('resetCooldown.markSent(email)') > fp.indexOf('resetPasswordForEmail('), 'and marked only after a send');
  assert(fp.includes('setError(getAuthErrorMessage(RESEND_TOO_SOON));'));
  assertFalse(fp.includes('confirmationCooldown'), 'a reset email never blocks a sign-up email, or the reverse');
});

// ── the shim's edges ─────────────────────────────────────────────────────

Deno.test('pkceCrypto: an existing partial crypto keeps its prototype methods; a locked-down global never throws and reports false', () => {
  class FakeCrypto {
    randomUUID() { return 'uuid'; }
  }
  const partial: Record<string, unknown> = { crypto: new FakeCrypto() };
  assertEquals(installPkceCrypto(partial, nativeDeps), true);
  assertEquals((partial.crypto as FakeCrypto).randomUUID(), 'uuid', 'prototype methods survive for other libraries');
  assert(hasWebCrypto(partial));

  const frozen: Record<string, unknown> = {};
  Object.defineProperty(frozen, 'crypto', { value: undefined, configurable: false, writable: false });
  assertEquals(installPkceCrypto(frozen, nativeDeps), false); // does not throw
  assertFalse(hasWebCrypto(frozen));

  const readonlyButWritable: Record<string, unknown> = {};
  Object.defineProperty(readonlyButWritable, 'crypto', { value: undefined, configurable: false, writable: true });
  assertEquals(installPkceCrypto(readonlyButWritable, nativeDeps), true, 'falls back to plain assignment');
});

Deno.test('pkceCrypto: ready means WebCrypto AND TextEncoder (auth-js degrades to "plain" without one)', () => {
  const noEncoder: Record<string, unknown> = { crypto: denoCrypto }; // a complete WebCrypto, no TextEncoder
  assert(hasWebCrypto(noEncoder));
  assertFalse(pkceReady(noEncoder));
  assertEquals(installPkceCrypto(noEncoder, nativeDeps), true, 'the shim supplies the TextEncoder');
  assert(pkceReady(noEncoder));
  const locked: Record<string, unknown> = { crypto: denoCrypto };
  Object.preventExtensions(locked); // the TextEncoder cannot be defined
  assertEquals(installPkceCrypto(locked, nativeDeps), false, 'no silent weak fallback');
  assertFalse(pkceReady(locked));
  assert(pkceReady({ crypto: denoCrypto, TextEncoder }));
  assert(pkceCryptoReady(), 'this test runtime (Deno) is ready');
  assert(SOURCES['lib/auth/pkceCrypto.ts'].includes('return hasWebCrypto(target) && typeof target.TextEncoder === \'function\';'));
});

Deno.test('pkceCrypto: fillWithRandomBytes fills EVERY element (auth-js keeps the low byte of each Uint32)', () => {
  const calls: number[] = [];
  const source = (n: number) => {
    calls.push(n);
    return Uint8Array.from({ length: n }, (_, i) => (i % 250) + 1); // never zero
  };
  const verifier = fillWithRandomBytes(new Uint32Array(56), source);
  assertEquals(calls, [224], 'asks for the whole buffer (56 elements x 4 bytes), not 56 bytes');
  assert(verifier.every((n) => n !== 0), 'no element is left zero');
  assert(Array.from(verifier, (n) => n & 0xff).every((b) => b !== 0), 'and none has a zero low byte');
  // A typed-array VIEW with an offset is filled in place, not from the start of its buffer.
  const buf = new Uint8Array(16);
  fillWithRandomBytes(buf.subarray(4, 12), (n) => new Uint8Array(n).fill(7));
  assertEquals(Array.from(buf), [0, 0, 0, 0, 7, 7, 7, 7, 7, 7, 7, 7, 0, 0, 0, 0]);
  // A short read from the source is refused, never a half-random verifier.
  let threw = false;
  try { fillWithRandomBytes(new Uint32Array(4), () => new Uint8Array(3)); } catch { threw = true; }
  assert(threw);
});

Deno.test('pkceCrypto: PKCE callers refuse to run without WebCrypto (never the weak fallback)', () => {
  const sp = SOURCES['lib/SessionProvider.tsx'];
  const signUp = sp.slice(sp.indexOf('const signUp = useCallback'), sp.indexOf('const fixtureSocial'));
  assert(signUp.indexOf('if (!pkceCryptoReady())') > -1 && signUp.indexOf('if (!pkceCryptoReady())') < signUp.indexOf('supabase.auth.signUp('));
  assert(signUp.includes('PKCE_CRYPTO_UNAVAILABLE'));
  const fp = SOURCES['app/forgot-password.tsx'];
  assert(fp.indexOf('if (!pkceCryptoReady())') > -1 && fp.indexOf('if (!pkceCryptoReady())') < fp.indexOf('resetPasswordForEmail('));
  const client = SOURCES['lib/supabase.ts'];
  assert(client.includes('fillWithRandomBytes(array, getRandomBytes)'));
  assert(/if \(\s*!installPkceCrypto\(globalThis, \{/.test(client) && client.includes("console.error('[auth] PKCE crypto is unavailable"));
});

Deno.test('legacy nonce keys are cleared on upgraded devices, best effort, never throwing', async () => {
  // Verified against the deleted modules: lib/recoveryNonce.ts STORAGE_KEY and lib/auth/confirmNonceCore.ts CONFIRM_NONCE_KEY.
  assertEquals([...LEGACY_AUTH_KEYS].sort(), ['fantasy-confirm-nonce', 'fantasy-recovery-nonce']);
  const removed: string[] = [];
  await removeLegacyAuthKeys({ removeItem: async (k) => void removed.push(k) });
  assertEquals(removed.sort(), ['fantasy-confirm-nonce', 'fantasy-recovery-nonce']);
  await removeLegacyAuthKeys({ removeItem: async () => { throw new Error('boom'); } }); // never throws
  await removeLegacyAuthKeys(null);
  assert(SOURCES['lib/SessionProvider.tsx'].includes('removeLegacyAuthKeys(require('));
});

// ── wiring ────────────────────────────────────────────────────────────────

Deno.test('wiring: the client is PKCE, and the crypto shim is installed before the client is created', () => {
  const src = SOURCES['lib/supabase.ts'];
  assert(src.includes("flowType: 'pkce'"));
  const install = src.search(/^if \(\s*!installPkceCrypto\(globalThis, \{/m); // a top-level statement, not deferred
  const create = src.indexOf('export const supabase = createClient(');
  assert(install > -1 && create > install, 'installPkceCrypto must run (synchronously, at module load) before createClient');
  assert(src.includes("from 'expo-crypto'"));
  assert(src.includes('detectSessionInUrl: false'), 'the app exchanges the code itself, once, in the link handler');
});

Deno.test('wiring: sign-up and "Send again" are PKCE: no nonce, no resend() (it sends no challenge), no username', () => {
  const sp = SOURCES['lib/SessionProvider.tsx'];
  const signUp = sp.slice(sp.indexOf('const signUp = useCallback'), sp.indexOf('const fixtureSocial'));
  assert(signUp.includes('emailRedirectTo: buildConfirmRedirect()'));
  assertFalse(/nonce|Nonce/.test(signUp.replace(/\/\/.*$/gm, '')), 'no nonce survives in sign-up');
  assertFalse(/\busername\b/.test(signUp.replace(/\/\/.*$/gm, '')));
  assert(signUp.includes('PKCE_STORAGE_UNAVAILABLE'), 'a storage failure is caught, not thrown into the UI');
  assertFalse(/auth\.resend\(/.test(sp.replace(/\/\/.*$/gm, '')), 'auth.resend() sends no code_challenge: its email would be an implicit-flow link');
  for (const f of ['app/create-account.tsx', 'app/login.tsx']) {
    assert(SOURCES[f].includes('onResend={() => signUp('), `${f}: Send again repeats signUp`);
  }
  // Sign in's own "Send again" link (after an email_not_confirmed error) repeats signUp with the typed credentials too.
  assert(SOURCES['app/login.tsx'].includes('await signUp(to, password)'));
  for (const [path, src] of Object.entries(SOURCES)) {
    assertFalse(src.replace(/\/\/.*$/gm, '').includes('resendConfirmation'), `${path} still calls resendConfirmation`);
  }
});

Deno.test('wiring: forgot-password is PKCE (no nonce); the old nonce modules are gone', () => {
  const fp = SOURCES['app/forgot-password.tsx'];
  assert(fp.includes('redirectTo: buildRecoveryRedirect()'));
  assertFalse(/recoveryNonce|generateRecoveryNonce|storeRecoveryNonce|[?&]rn=/.test(fp));
  assertEquals(
    fp.split('Could not start a secure password reset on this device. Please try again.').length - 1,
    2,
    'both refusals (no WebCrypto, and a storage failure) keep the existing copy'
  );
  for (const gone of ['lib/recoveryNonce.ts', 'lib/auth/confirmNonce.ts', 'lib/auth/confirmNonceCore.ts']) {
    assertFalse(gone in SOURCES, `${gone} should be deleted`);
  }
  for (const [path, src] of Object.entries(SOURCES)) {
    assertFalse(/verifyAndConsume(Recovery|Confirm)Nonce|clearConfirmNonce|getOrCreateConfirmNonce/.test(src), `${path} still references a nonce store`);
  }
});

Deno.test('wiring: sign-out clears BOTH the recovery flag and the just-confirmed flag (the next person starts clean)', () => {
  const sp = SOURCES['lib/SessionProvider.tsx'];
  const block = sp.slice(sp.indexOf("event === 'SIGNED_OUT'"), sp.indexOf("event === 'SIGNED_OUT'") + 900);
  assert(block.includes('setRecoverySession(false)'));
  assert(block.includes('setEmailJustConfirmed(false)'));
});

Deno.test('recovery route: every shape opens the plain screen (the code stays out of router params); look-alikes do not', () => {
  for (const p of ['/reset-password', `/reset-password?flow=pkce&code=${CODE}`, `fantasystockapp://reset-password?flow=pkce&code=${CODE}`, 'fantasystockapp:///reset-password', 'exp://h:1/--/reset-password?code=x']) {
    assert(isRecoveryRoute(p), p);
  }
  for (const p of ['/reset-passwordx', '/reset-password/evil', '/login', 'https://evil.example/reset-password', '', null, undefined]) {
    assertFalse(isRecoveryRoute(p as string), String(p));
  }
  const ni = SOURCES['app/+native-intent.tsx'];
  assert(ni.includes("if (isRecoveryRoute(path)) return '/reset-password';"));
  assert(ni.indexOf('pendingRoute.record(path)') < ni.indexOf('isRecoveryRoute(path)'), 'recorded (and rejected for resume) before the path is rewritten');
});

Deno.test('wiring: the layout binds the tested handler, with the dev fixture off and the module-level dedupe', () => {
  const layout = SOURCES['app/_layout.tsx'];
  assert(layout.includes('const handledAuthLinks = createLinkDedupe();'));
  assert(layout.includes('createAuthLinkHandler({'));
  assert(layout.includes('confirmEnabled: !SHELL_FIXTURE'));
  assert(layout.includes('exchangeCodeForSession: (code) => supabase.auth.exchangeCodeForSession(code)'));
  assert(layout.includes('dedupe: handledAuthLinks'));
  assertFalse(layout.includes('setSession('), 'no token-based sign-in from a link remains');
  assertFalse(layout.includes('access_token'));
  assert(layout.indexOf('getInitialURL') > -1 && layout.includes("Linking.addEventListener('url'"));
  assert(SOURCES['app/+native-intent.tsx'].includes("if (isConfirmRoute(path)) return '/login';"));
  // The handler never signs in from a token and always checks the session before it exchanges a confirm code.
  const h = SOURCES['lib/auth/authLinkHandlers.ts'];
  assertFalse(h.includes('setSession'));
  assert(h.indexOf('deps.getSession()') < h.indexOf('deps.exchangeCodeForSession(action.code)'));
});
