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
import { AUTH_FETCH_TIMEOUT_MS, createAuthFetch } from '../lib/auth/authFetch.ts';
import {
  AUTH_STORAGE_KEY,
  classifyVerifier,
  RECOVERY_VERIFIER_MARKERS,
  restoreVerifierIfAbsent,
  verifierKey,
  withVerifierKept,
  withVerifierLock,
  type VerifierSlot,
} from '../lib/auth/verifierSlot.ts';
import { isRecoveryHold, isRecoveryInProgress, isRecoverySession, setRecoveryInProgress, setRecoverySession, subscribeRecoverySession } from '../lib/auth/recoverySession.ts';
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

// ── the handler: every outcome, with a fake client AND a fake verifier slot ──

const exchangeOk = (redirectType: string | null, id = 'user-1'): ExchangeResult =>
  ({ data: { session: { access_token: 't' }, user: { id }, redirectType }, error: null }) as unknown as ExchangeResult;
const exchangeFailed = (code = 'flow_state_not_found', name?: string): ExchangeResult => ({
  data: { session: null, user: null },
  error: { code, name },
});
const exchangeNoSession: ExchangeResult = { data: { session: null, user: null }, error: null };

// What auth-js stores: JSON-encoded "<verifier>" (sign-up) or "<verifier>/<MARKER>" (reset).
const SIGNUP_SLOT = JSON.stringify('9f8e7d6c5b4a39281706f5e4d3c2b1a0');
const RESET_SLOT = JSON.stringify('9f8e7d6c5b4a39281706f5e4d3c2b1a0/PASSWORD_RECOVERY');
const RESET_SLOT_NEW = JSON.stringify('9f8e7d6c5b4a39281706f5e4d3c2b1a0/recovery');

function harness(
  o: {
    /** A counter shared across harnesses, to see whether exchanges overlap (the lock is module-wide). */
    counter?: { live: number; max: number };
    session?: boolean;
    /** getSession answers 'no session' this many times, then 'a session exists' (somebody signed in while we waited). */
    sessionAppearsAfter?: number;
    /** The Nth getSession() call (1-based) resolves { session: null, error }, as auth-js does when a refresh fails. */
    sessionErrorAtCall?: number;
    exchange?: ExchangeResult;
    throws?: boolean;
    confirmEnabled?: boolean;
    keepPushError?: boolean;
    recoveryOpen?: boolean;
    signOutError?: boolean;
    /** The stored verifier item; default: the matching kind for whichever link is handled. */
    verifier?: string | null;
    /** Runs inside the exchange, after auth-js would have deleted the slot (simulates a newer flow). */
    duringExchange?: (set: (raw: string | null) => void) => void;
  } = {}
) {
  const calls: string[] = [];
  const exchanged: string[] = [];
  let stored: string | null = null;
  let loaded = false;
  let sessionCalls = 0;
  const counter = o.counter ?? { live: 0, max: 0 };
  const dedupe = createLinkDedupe();
  const deps: AuthLinkDeps = {
    confirmEnabled: o.confirmEnabled ?? true,
    getSession: async () => {
      sessionCalls++;
      if (o.sessionErrorAtCall === sessionCalls) return { data: { session: null }, error: { code: 'refresh_failed' } };
      const appeared = o.sessionAppearsAfter !== undefined && sessionCalls > o.sessionAppearsAfter;
      return { data: { session: o.session || appeared ? { access_token: 'existing' } : null } };
    },
    readVerifier: async () => {
      if (!loaded) {
        loaded = true;
        stored = o.verifier !== undefined ? o.verifier : currentUrl.includes('reset-password') ? RESET_SLOT : SIGNUP_SLOT;
      }
      return stored;
    },
    writeVerifier: async (raw) => {
      calls.push('write');
      stored = raw;
    },
    exchangeCodeForSession: async (code) => {
      exchanged.push(code);
      calls.push('exchange');
      counter.live++;
      counter.max = Math.max(counter.max, counter.live);
      await new Promise((r) => setTimeout(r, 1)); // a real request takes time: overlapping callers would interleave here
      counter.live--;
      stored = null; // auth-js deletes the verifier after EVERY attempt, success or failure
      o.duringExchange?.((raw) => (stored = raw));
      if (o.throws) throw new Error('network down');
      return o.exchange ?? exchangeOk(null);
    },
    signOut: async () => {
      calls.push('signOut');
      return { error: o.signOutError ? { code: 'network' } : null };
    },
    isRecoveryActive: () => !!o.recoveryOpen,
    setRecoveryInProgress: (v) => void calls.push(`hold:${v}`),
    removePushToken: async (id) => {
      calls.push(`removePushToken:${id}`);
      if (o.keepPushError) throw new Error('boom');
    },
    setEmailJustConfirmed: (v) => void calls.push(`confirmed:${v}`),
    setRecoverySession: (v) => void calls.push(`recovery:${v}`),
    replaceRoute: (p) => void calls.push(`route:${p}`),
    warn: () => void calls.push('warn'),
    dedupe,
  };
  let currentUrl = '';
  const inner = createAuthLinkHandler(deps);
  return {
    handle: (url: string) => {
      currentUrl = url;
      return inner(url);
    },
    calls,
    exchanged,
    slot: () => stored,
    setSlot: (raw: string | null) => {
      loaded = true;
      stored = raw;
    },
    maxConcurrentExchanges: () => counter.max,
  };
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

Deno.test('confirm: NO verifier here (another device, already spent): refused WITHOUT an exchange, quietly', async () => {
  for (const verifier of [null, '', JSON.stringify(''), JSON.stringify('/PASSWORD_RECOVERY')]) {
    const h = harness({ verifier });
    assertEquals(await h.handle(CONFIRM_URL), 'confirm-failed', String(verifier));
    assertEquals(h.exchanged, [], 'nothing reaches GoTrue, so nothing is consumed');
    assertEquals(h.calls, ['warn']);
  }
});

Deno.test('confirm: a pending PASSWORD RESET (either marker spelling) is left untouched by a confirm link', async () => {
  for (const verifier of [RESET_SLOT, RESET_SLOT_NEW, JSON.stringify('abc/unknown-marker')]) {
    const h = harness({ verifier });
    assertEquals(await h.handle(CONFIRM_URL), 'confirm-wrong-type', verifier);
    assertEquals(h.exchanged, [], 'refused BEFORE any exchange, so no session can exist and the reset verifier survives');
    assertEquals(h.slot(), verifier);
    assertFalse(h.calls.includes('signOut'));
  }
});

Deno.test('confirm: a forged / spent / expired code is refused, and the genuine pending verifier is RESTORED (a junk link cannot burn it)', async () => {
  for (const code of ['flow_state_not_found', 'validation_failed', 'bad_code_verifier', '']) {
    const h = harness({ exchange: exchangeFailed(code) });
    assertEquals(await h.handle(CONFIRM_URL), 'confirm-failed', code);
    assertEquals(h.slot(), SIGNUP_SLOT, `auth-js deleted it; the app put it back (${code})`);
    assertEquals(h.calls, ['exchange', 'write', 'warn'], code); // no flag, no sign-out, no route change
  }
  const odd = harness({ exchange: exchangeNoSession });
  assertEquals(await odd.handle(CONFIRM_URL), 'confirm-failed');
  assertEquals(odd.slot(), SIGNUP_SLOT);
  assertFalse(odd.calls.includes('confirmed:true'));
});

Deno.test('restore never overwrites a NEWER verifier (a successful new flow wrote its own meanwhile)', async () => {
  const newer = JSON.stringify('1111111111111111/PASSWORD_RECOVERY');
  const h = harness({ exchange: exchangeFailed(), duringExchange: (set) => set(newer) });
  assertEquals(await h.handle(CONFIRM_URL), 'confirm-failed');
  assertEquals(h.slot(), newer);
  assertFalse(h.calls.includes('write'));
});

Deno.test('confirm: a failure on the NETWORK releases the dedupe mark (the genuine link can be retried); a definitive refusal does not', async () => {
  for (const [label, h] of [
    ['AuthRetryableFetchError', harness({ exchange: exchangeFailed('', 'AuthRetryableFetchError') })],
    ['a throw', harness({ throws: true })],
  ] as const) {
    assertEquals(await h.handle(CONFIRM_URL), 'confirm-failed', label);
    assertEquals(h.slot(), SIGNUP_SLOT, `${label}: the verifier is restored`);
    assertEquals(await h.handle(CONFIRM_URL), 'confirm-failed', `${label}: tried AGAIN, not 'duplicate'`);
    assertEquals(h.exchanged.length, 2, label);
  }
  const definitive = harness({ exchange: exchangeFailed('flow_state_not_found') });
  assertEquals(await definitive.handle(CONFIRM_URL), 'confirm-failed');
  assertEquals(await definitive.handle(CONFIRM_URL), 'duplicate', 'a definitive refusal is not retried');
});

Deno.test('confirm: BACKSTOP: a recovery exchange that gets through the slot check is still signed back out', async () => {
  const h = harness({ exchange: exchangeOk('PASSWORD_RECOVERY', 'attacker-or-owner') });
  assertEquals(await h.handle(CONFIRM_URL), 'confirm-wrong-type');
  assertEquals(h.calls, ['exchange', 'warn', 'removePushToken:attacker-or-owner', 'signOut']);
  const h2 = harness({ exchange: exchangeOk('recovery'), keepPushError: true });
  assertEquals(await h2.handle(CONFIRM_URL), 'confirm-wrong-type');
  assert(h2.calls.includes('signOut'), 'even if dropping the push token throws');
});

Deno.test('confirm: an error redirect, a link with no code, and the dev fixture exchange nothing', async () => {
  for (const url of [
    'fantasystockapp://auth/confirm?error=access_denied&error_code=otp_expired',
    'fantasystockapp://auth/confirm',
    'fantasystockapp://auth/confirm?code=short',
    `fantasystockapp://auth/confirm?code=${'a'.repeat(36)}`, // not a UUID
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

Deno.test('recovery: a PASSWORD_RECOVERY exchange (either spelling) sets the flag, opens the form, and holds around the exchange', async () => {
  for (const [slot, type] of [[RESET_SLOT, 'PASSWORD_RECOVERY'], [RESET_SLOT_NEW, 'recovery']] as const) {
    const h = harness({ verifier: slot, exchange: exchangeOk(type) });
    assertEquals(await h.handle(RESET_URL), 'recovery-form', type);
    // The hold is up BEFORE the exchange (SIGNED_IN fires inside it) and only drops AFTER the flag is set.
    assertEquals(h.calls, ['hold:true', 'exchange', 'recovery:true', 'route:/reset-password', 'hold:false'], type);
  }
});

Deno.test('recovery: the hold drops on EVERY exit (success, refusal, wrong type, throw)', async () => {
  const exits: [string, ReturnType<typeof harness>][] = [
    ['refused', harness({ exchange: exchangeFailed() })],
    ['no session', harness({ exchange: exchangeNoSession })],
    ['wrong type', harness({ exchange: exchangeOk(null) })],
    ['throw', harness({ throws: true })],
    ['network', harness({ exchange: exchangeFailed('', 'AuthRetryableFetchError') })],
  ];
  for (const [label, h] of exits) {
    await h.handle(RESET_URL);
    const up = h.calls.indexOf('hold:true');
    const down = h.calls.lastIndexOf('hold:false');
    assert(up > -1 && down > up, `${label}: hold raised and dropped`);
    assertEquals(h.calls.filter((c) => c === 'hold:true').length, h.calls.filter((c) => c === 'hold:false').length, label);
  }
  // A refusal BEFORE the exchange never raises it.
  const pre = harness({ verifier: null });
  await pre.handle(RESET_URL);
  assertFalse(pre.calls.some((c) => c.startsWith('hold:')));
});

Deno.test('recovery: fail closed: an expired / used / forged code lands on the invalid screen with no flag, and the pending reset verifier is restored', async () => {
  for (const code of ['flow_state_not_found', 'validation_failed', 'bad_code_verifier', '']) {
    const h = harness({ exchange: exchangeFailed(code) });
    assertEquals(await h.handle(RESET_URL), 'recovery-invalid', code);
    assertEquals(h.slot(), RESET_SLOT, `restored (${code})`);
    assertEquals(h.calls, ['hold:true', 'exchange', 'write', 'recovery:false', 'route:/reset-password?status=invalid', 'hold:false'], code);
  }
});

Deno.test('recovery: NO reset verifier here (another device / spent / the pending flow is a sign-up): refused WITHOUT an exchange', async () => {
  for (const verifier of [null, '', SIGNUP_SLOT, JSON.stringify('abc/unknown-marker')]) {
    const h = harness({ verifier });
    assertEquals(await h.handle(RESET_URL), 'recovery-invalid', String(verifier));
    assertEquals(h.exchanged, [], 'no exchange: no session can exist and a pending sign-up verifier is not burned');
    assertEquals(h.slot(), verifier);
    assertEquals(h.calls, ['recovery:false', 'route:/reset-password?status=invalid']);
  }
});

Deno.test('recovery: a failure on the NETWORK releases the dedupe mark and restores the verifier', async () => {
  const h = harness({ exchange: exchangeFailed('', 'AuthRetryableFetchError') });
  assertEquals(await h.handle(RESET_URL), 'recovery-invalid');
  assertEquals(h.slot(), RESET_SLOT);
  assertEquals(await h.handle(RESET_URL), 'recovery-invalid', 'retried, not duplicate');
  assertEquals(h.exchanged.length, 2);
});

Deno.test('recovery: BACKSTOP: a session of the wrong type that gets through the slot check is refused AND signed back out', async () => {
  const h = harness({ exchange: exchangeOk(null, 'someone') });
  assertEquals(await h.handle(RESET_URL), 'recovery-invalid');
  assertEquals(h.calls, ['hold:true', 'exchange', 'removePushToken:someone', 'signOut', 'recovery:false', 'route:/reset-password?status=invalid', 'hold:false']);
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

Deno.test('recovery: a GOOD code still exchanges while a reset form is open (a fresh reset replaces the open one)', async () => {
  const h = harness({ recoveryOpen: true, exchange: exchangeOk('PASSWORD_RECOVERY') });
  assertEquals(await h.handle(RESET_URL), 'recovery-form');
  assertEquals(h.exchanged, [CODE]);
  assert(h.calls.includes('recovery:true'));
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
});

Deno.test('recovery: a well-formed JUNK code while a genuine reset is open is ignored too (before AND after the slot check)', async () => {
  // The genuine exchange already spent its verifier, so the slot is empty: refused without an exchange.
  const spent = harness({ recoveryOpen: true, verifier: null });
  assertEquals(await spent.handle(RESET_URL), 'recovery-ignored');
  assertEquals(spent.calls, []);
  // A pending reset verifier is still there (a second reset requested): a failing exchange is ignored too.
  const failing = harness({ recoveryOpen: true, exchange: exchangeFailed('bad_code_verifier') });
  assertEquals(await failing.handle(RESET_URL), 'recovery-ignored');
  assertEquals(failing.slot(), RESET_SLOT, 'and its verifier is put back');
  assertFalse(failing.calls.includes('route:/reset-password?status=invalid'));
  // With nothing open the same failure still fails closed.
  const closed = harness({ recoveryOpen: false, exchange: exchangeFailed('bad_code_verifier') });
  assertEquals(await closed.handle(RESET_URL), 'recovery-invalid');
});

Deno.test('recovery: an exchange that resolves { error: null, session: null } with a reset open is IGNORED, with NO sign-out', async () => {
  const h = harness({ recoveryOpen: true, exchange: exchangeNoSession });
  assertEquals(await h.handle(RESET_URL), 'recovery-ignored');
  assertFalse(h.calls.includes('signOut'), 'there is no session to sign out');
  assertFalse(h.calls.some((c) => c.startsWith('removePushToken')));
  const closed = harness({ recoveryOpen: false, exchange: exchangeNoSession });
  assertEquals(await closed.handle(RESET_URL), 'recovery-invalid');
  assertFalse(closed.calls.includes('signOut'));
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
  // BEFORE install it is NOT a complete WebCrypto (no subtle). Asserted from the object itself, not only through
  // hasWebCrypto, so a checker that ignored `subtle` could not pass this vacuously.
  assertEquals(typeof (partial.crypto as { subtle?: unknown }).subtle, 'undefined');
  assertFalse(hasWebCrypto(partial));
  assertFalse(hasWebCrypto({ crypto: { getRandomValues: () => 1 } }));
  assertFalse(hasWebCrypto({ crypto: { subtle: { digest: () => 1 } } }), 'and getRandomValues is required too');
  assertFalse(hasWebCrypto({ crypto: { getRandomValues: () => 1, subtle: {} } }), 'subtle.digest is required');
  installPkceCrypto(partial, nativeDeps);
  // AFTER install, independently of hasWebCrypto: the pieces are really there and really work.
  const installed = partial.crypto as { other: string; getRandomValues: unknown; subtle: { digest: (a: string, d: BufferSource) => Promise<ArrayBuffer> } };
  assertEquals(typeof installed.subtle.digest, 'function');
  assertEquals(typeof installed.getRandomValues, 'function');
  assertEquals(installed.other, 'kept');
  const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
  assertEquals(
    hex(await installed.subtle.digest('SHA-256', new TextEncoder().encode('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', // the FIPS 180-2 SHA-256("abc") vector
  );
  assert(hasWebCrypto(partial));
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

function realClient(storageItems = new Map<string, string>(), opts: { failSignup?: boolean; failToken?: boolean } = {}) {
  const requests: { path: string; body: Json }[] = [];
  const user = { id: 'user-1', aud: 'authenticated', email: 'ada@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  const fakeFetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Json) : {};
    requests.push({ path: url.pathname + url.search, body });
    const ok = (json: unknown) => Promise.resolve(new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (url.pathname.endsWith('/recover')) return ok({});
    if (url.pathname.endsWith('/signup')) {
      if (opts.failSignup) return Promise.resolve(new Response(JSON.stringify({ code: 429, error_code: 'over_email_send_rate_limit', msg: 'rate limit' }), { status: 429, headers: { 'content-type': 'application/json' } }));
      return ok(user);
    }
    if (url.pathname.endsWith('/token')) {
      if (opts.failToken) return Promise.resolve(new Response(JSON.stringify({ code: 400, error_code: 'flow_state_not_found', msg: 'invalid flow state' }), { status: 400, headers: { 'content-type': 'application/json' } }));
      return ok({ access_token: 'a.b.c', token_type: 'bearer', expires_in: 3600, refresh_token: 'r', user });
    }
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
  assert(signUp.includes('if (!res.error && !res.data?.session) confirmationCooldown.markSent(email);'), 'a successful send marks the address');
  // No caller needs its own copy of the rule: Create account, Check your email and Sign in all go through signUp.
  for (const f of ['components/shell/ConfirmEmailSent.tsx', 'app/login.tsx', 'app/create-account.tsx']) {
    assertFalse(SOURCES[f].includes('confirmationCooldown'), `${f} relies on signUp's floor`);
  }
  // Password reset has its own, marked only after a successful send and checked before anything is sent.
  const fp = SOURCES['app/forgot-password.tsx'];
  const resetCheck = fp.indexOf('resetCooldown.remainingMs(email) > 0');
  assert(resetCheck > -1 && resetCheck < fp.indexOf('resetPasswordForEmail('), 'the reset floor is checked first');
  assert(fp.indexOf('resetCooldown.markSent(email)') > fp.indexOf('resetPasswordForEmail('), 'and marked only after a send');
  assert(fp.includes('if (!r.error) resetCooldown.markSent(email);'), 'a SUCCESSFUL send marks the floor (not only the throw path)');
  assertEquals(fp.split('resetCooldown.remainingMs(email) > 0').length - 1, 2, 'checked on the fast path AND again inside the critical section');
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

// ── the verifier slot ────────────────────────────────────────────────────

Deno.test('verifier slot: the key, and every stored shape classified (sign-up / reset under BOTH marker spellings / unknown / absent)', () => {
  assertEquals(AUTH_STORAGE_KEY, 'fantasy-finance-auth');
  assertEquals(verifierKey(), 'fantasy-finance-auth-code-verifier');
  assertEquals(verifierKey('x'), 'x-code-verifier');
  assertEquals(classifyVerifier(JSON.stringify('abc123')), { kind: 'signup' });
  assertEquals(classifyVerifier('abc123'), { kind: 'signup' }, 'an unencoded value works too');
  assertEquals(classifyVerifier(JSON.stringify('abc123/PASSWORD_RECOVERY')), { kind: 'recovery' }); // auth-js 2.89
  assertEquals(classifyVerifier(JSON.stringify('abc123/recovery')), { kind: 'recovery' }); // auth-js 2.108
  assertEquals(classifyVerifier('abc123/recovery'), { kind: 'recovery' });
  assertEquals(classifyVerifier(JSON.stringify('abc123/')), { kind: 'signup' }, 'an empty marker is a plain verifier');
  for (const unknown of ['abc/magiclink', 'abc/RECOVERY', 'abc/password_recovery', 'abc/x/y']) {
    assertEquals(classifyVerifier(JSON.stringify(unknown)), { kind: 'unknown' }, unknown);
  }
  for (const absent of [null, undefined, '', JSON.stringify(''), JSON.stringify('/PASSWORD_RECOVERY'), JSON.stringify(5), 'null']) {
    assertEquals(classifyVerifier(absent as string | null), { kind: 'absent' }, String(absent));
  }
  for (const marker of RECOVERY_VERIFIER_MARKERS) assertEquals(classifyVerifier(JSON.stringify(`v/${marker}`)), { kind: 'recovery' });
  assert(SOURCES['lib/supabase.ts'].includes('storageKey: AUTH_STORAGE_KEY'), 'the client and the slot name one key');
});

function memorySlot(initial: string | null) {
  let stored = initial;
  const log: string[] = [];
  const slot: VerifierSlot = {
    read: async () => stored,
    write: async (raw) => {
      log.push('write');
      stored = raw;
    },
  };
  return { slot, log, get: () => stored, set: (v: string | null) => (stored = v) };
}

Deno.test('verifier slot: restore puts the snapshot back only into an EMPTY slot, never over a newer one, never throws', async () => {
  const empty = memorySlot(null);
  assertEquals(await restoreVerifierIfAbsent(empty.slot, 'snap'), true);
  assertEquals(empty.get(), 'snap');
  const newer = memorySlot('newer');
  assertEquals(await restoreVerifierIfAbsent(newer.slot, 'snap'), false);
  assertEquals(newer.get(), 'newer');
  assertEquals(await restoreVerifierIfAbsent(memorySlot(null).slot, null), false, 'nothing to restore');
  assertEquals(await restoreVerifierIfAbsent(memorySlot(null).slot, ''), false);
  const broken: VerifierSlot = { read: async () => { throw new Error('x'); }, write: async () => { throw new Error('y'); } };
  assertEquals(await restoreVerifierIfAbsent(broken, 'snap'), false);
});

Deno.test('verifier slot: withVerifierKept restores after a FAILED call or a throw, and leaves a SUCCESSFUL new flow alone', async () => {
  const OLD = JSON.stringify('old/PASSWORD_RECOVERY');
  // Failed call: auth-js deleted the slot (the library does that on error); the guard puts the old one back.
  const failed = memorySlot(OLD);
  const r1 = await withVerifierKept(failed.slot, async () => { failed.set(null); return { error: 'rate limited' }; }, (r) => !!r.error);
  assertEquals(r1, { error: 'rate limited' });
  assertEquals(failed.get(), OLD);
  // Thrown: restored, and the throw still propagates to the caller.
  const thrown = memorySlot(OLD);
  let caught = false;
  try {
    await withVerifierKept(thrown.slot, async () => { thrown.set(null); throw new Error('storage'); }, () => true);
  } catch { caught = true; }
  assert(caught);
  assertEquals(thrown.get(), OLD);
  // Success: the new flow's verifier stays; the old one is superseded on purpose.
  const ok = memorySlot(OLD);
  await withVerifierKept(ok.slot, async () => { ok.set(JSON.stringify('fresh')); return { error: null }; }, (r) => !!r.error);
  assertEquals(ok.get(), JSON.stringify('fresh'));
  // Failed but a NEWER value is present: left alone.
  const newer = memorySlot(OLD);
  await withVerifierKept(newer.slot, async () => { newer.set('newer'); return { error: 'x' }; }, (r) => !!r.error);
  assertEquals(newer.get(), 'newer');
  // Nothing pending before: a failure restores nothing.
  const none = memorySlot(null);
  await withVerifierKept(none.slot, async () => ({ error: 'x' }), (r) => !!r.error);
  assertEquals([none.get(), none.log], [null, []]);
});

Deno.test({
  name: 'real supabase-js: the verifier slot key, both flows\' shapes, and the library\'s deletions are exactly what the guard assumes',
  ignore: GoTrueClient === null,
  async fn() {
    const { client, storageItems, requests } = realClient();
    // Make the server refuse the next sign-up (rate limit) so auth-js takes its error path.
    await client.resetPasswordForEmail('ada@example.com');
    const key = verifierKey('test-auth');
    const resetRaw = storageItems.get(key)!;
    assert(resetRaw, `auth-js stores under ${key}`);
    assertEquals(classifyVerifier(resetRaw), { kind: 'recovery' }, 'the INSTALLED library\'s reset marker is one the app recognises');
    const marker = (JSON.parse(resetRaw) as string).split('/')[1];
    assert(RECOVERY_VERIFIER_MARKERS.includes(marker), `installed marker ${marker}`);

    // Its sign-up verifier carries no marker.
    const second = realClient();
    await second.client.signUp({ email: 'ada@example.com', password: 'pw' });
    assertEquals(classifyVerifier(second.storageItems.get(key)!), { kind: 'signup' });

    // The problem, against the real library: a FAILED sign-up deletes the pending reset's verifier ...
    const failing = realClient(new Map([[key, resetRaw]]), { failSignup: true });
    const bare = await failing.client.signUp({ email: 'x@example.com', password: 'pw' });
    assert(bare.error !== null, 'the server refused');
    assertFalse(failing.storageItems.has(key), 'auth-js deleted the pending verifier on the error path');
    // ... and the guard restores it.
    const guarded = realClient(new Map([[key, resetRaw]]), { failSignup: true });
    const slot: VerifierSlot = {
      read: async () => guarded.storageItems.get(key) ?? null,
      write: async (raw) => void guarded.storageItems.set(key, raw),
    };
    const res = await withVerifierKept(slot, () => guarded.client.signUp({ email: 'x@example.com', password: 'pw' }), (r) => !!r.error);
    assert(res.error !== null);
    assertEquals(guarded.storageItems.get(key), resetRaw, 'the pending reset survives a failed sign-up');
    assert(requests.length > 0);

    // A failed EXCHANGE deletes it too, and the full handler (real client) puts it back.
    const live = realClient(new Map([[key, resetRaw]]), { failToken: true });
    const handler = createAuthLinkHandler({
      confirmEnabled: true,
      getSession: async () => ({ data: { session: null } }),
      exchangeCodeForSession: (c) => live.client.exchangeCodeForSession(c) as unknown as Promise<ExchangeResult>,
      readVerifier: async () => live.storageItems.get(key) ?? null,
      writeVerifier: async (raw) => void live.storageItems.set(key, raw),
      signOut: async () => ({ error: null }),
      isRecoveryActive: () => false,
      setRecoveryInProgress: () => {},
      removePushToken: async () => {},
      setEmailJustConfirmed: () => {},
      setRecoverySession: () => {},
      replaceRoute: () => {},
      warn: () => {},
      dedupe: createLinkDedupe(),
    });
    assertEquals(await handler(RESET_URL), 'recovery-invalid');
    assertEquals(live.storageItems.get(key), resetRaw, 'a junk code does not burn the genuine pending reset');
    // And with NO reset pending, the handler never reaches the network at all.
    const empty = realClient(new Map());
    const noNet = createAuthLinkHandler({
      confirmEnabled: true,
      getSession: async () => ({ data: { session: null } }),
      exchangeCodeForSession: (c) => empty.client.exchangeCodeForSession(c) as unknown as Promise<ExchangeResult>,
      readVerifier: async () => empty.storageItems.get(key) ?? null,
      writeVerifier: async () => {},
      signOut: async () => ({ error: null }),
      isRecoveryActive: () => false,
      setRecoveryInProgress: () => {},
      removePushToken: async () => {},
      setEmailJustConfirmed: () => {},
      setRecoverySession: () => {},
      replaceRoute: () => {},
      warn: () => {},
      dedupe: createLinkDedupe(),
    });
    assertEquals(await noNet(RESET_URL), 'recovery-invalid');
    assertEquals(empty.requests.length, 0);
  },
});

Deno.test('code shape: a GoTrue PKCE auth code is a UUID, in either case; nothing else is a code', () => {
  const upper = CODE.toUpperCase();
  assertEquals(readLinkOutcome(`fantasystockapp://auth/confirm?code=${upper}`), { kind: 'code', code: upper });
  for (const bad of ['a'.repeat(36), 'a'.repeat(8), 'g0f1e2d3-4b5a-6978-8796-a5b4c3d2e1f0', `${CODE}0`, CODE.slice(1), CODE.replace(/-/g, ''), `${CODE} `, ` ${CODE}`]) {
    assertEquals(readLinkOutcome(`fantasystockapp://auth/confirm?code=${encodeURIComponent(bad)}`), { kind: 'empty' }, bad);
  }
});

// ── one queue for everything that touches the slot ───────────────────────

Deno.test('verifier lock: callers run strictly one after another, in order; a rejection never blocks the next', async () => {
  const order: string[] = [];
  const job = (name: string, ms: number, fail = false) =>
    withVerifierLock(async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}:end`);
      if (fail) throw new Error(name);
      return name;
    });
  const results = await Promise.allSettled([job('a', 10), job('b', 1, true), job('c', 1)]);
  assertEquals(order, ['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  assertEquals(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
});

Deno.test('verifier lock: two OVERLAPPING sign-ups cannot restore a stale snapshot over the newer verifier (the race)', async () => {
  // A fake of auth-js: it writes its new verifier first, and DELETES the slot when its request fails.
  const box = memorySlot(JSON.stringify('S1'));
  const signUp = (verifier: string, ok: boolean) => async () => {
    box.set(JSON.stringify(verifier));
    await new Promise((r) => setTimeout(r, 2));
    if (!ok) box.set(null);
    return { error: ok ? null : 'rate limited' };
  };
  const [first, second] = await Promise.all([
    withVerifierKept(box.slot, signUp('S2', true), (r) => !!r.error), // succeeds: the delivered email carries S2's challenge
    withVerifierKept(box.slot, signUp('S3', false), (r) => !!r.error), // fails: auth-js deletes the slot
  ]);
  assertEquals([first.error, second.error], [null, 'rate limited']);
  // Serialized: the failing call's snapshot was S2 (the latest), so S2 is what comes back, never the stale S1.
  assertEquals(box.get(), JSON.stringify('S2'));
});

Deno.test('verifier lock: the link handler\'s read + exchange is one critical section (no two exchanges overlap, even across handlers)', async () => {
  const counter = { live: 0, max: 0 };
  const a = harness({ exchange: exchangeFailed(), counter });
  const b = harness({ exchange: exchangeFailed(), counter });
  const c = harness({ exchange: exchangeFailed(), counter }); // its own slot: a pending password reset
  await Promise.all([
    a.handle(CONFIRM_URL),
    a.handle('fantasystockapp://auth/confirm?code=11111111-2222-3333-4444-555555555555'),
    b.handle('fantasystockapp://auth/confirm?code=22222222-3333-4444-5555-666666666666'),
    c.handle(RESET_URL),
  ]);
  assertEquals(a.exchanged.length + b.exchanged.length + c.exchanged.length, 4, 'all four really exchanged');
  assertEquals(counter.max, 1, 'never two exchanges in flight at once');
  // Without the lock the same four calls DO overlap (this is the control that proves the counter can see overlap).
  const control = { live: 0, max: 0 };
  await Promise.all([1, 2, 3].map(async () => { control.live++; control.max = Math.max(control.max, control.live); await new Promise((r) => setTimeout(r, 1)); control.live--; }));
  assertEquals(control.max, 3);
});

Deno.test('pre-check refusals release the dedupe mark: nothing was spent, so a re-tap of the genuine link may proceed', async () => {
  const h = harness({ verifier: null });
  assertEquals(await h.handle(CONFIRM_URL), 'confirm-failed');
  h.setSlot(SIGNUP_SLOT); // the slot comes back (e.g. a failed sign-up's restore finished)
  assertEquals(await h.handle(CONFIRM_URL), 'confirm-signed-in', 'the same URL is handled again, not "duplicate"');
  const r = harness({ verifier: SIGNUP_SLOT, exchange: exchangeOk('PASSWORD_RECOVERY') });
  assertEquals(await r.handle(RESET_URL), 'recovery-invalid'); // a sign-up verifier is pending: refused before any exchange
  r.setSlot(RESET_SLOT);
  assertEquals(await r.handle(RESET_URL), 'recovery-form');
  const w = harness({ verifier: RESET_SLOT });
  assertEquals(await w.handle(CONFIRM_URL), 'confirm-wrong-type');
  w.setSlot(SIGNUP_SLOT);
  assertEquals(await w.handle(CONFIRM_URL), 'confirm-signed-in');
});

Deno.test('confirm: a session that appears WHILE the link waits for the lock is never replaced (re-checked right before the exchange)', async () => {
  const h = harness({ sessionAppearsAfter: 1 }); // the first check (before the queue) sees nobody; the second sees a sign-in
  assertEquals(await h.handle(CONFIRM_URL), 'confirm-ignored');
  assertEquals(h.exchanged, [], 'no exchange: the verifier is not spent either');
  assertEquals(h.slot(), SIGNUP_SLOT);
  assertFalse(h.calls.includes('confirmed:true'));
  // And with nobody signing in, the same link still exchanges.
  const ok = harness({});
  assertEquals(await ok.handle(CONFIRM_URL), 'confirm-signed-in');
  const src = SOURCES['lib/auth/authLinkHandlers.ts'];
  const lockAt = src.indexOf('await withVerifierLock(async () => {');
  assert(src.indexOf('await deps.getSession()', lockAt) > lockAt, 'the second session check is INSIDE the critical section');
});

Deno.test('auth fetch: only /auth/v1/ requests are aborted after the timeout; a hung one ENDS so the queue frees; the timer is cleared', async () => {
  assertEquals(AUTH_FETCH_TIMEOUT_MS, 25_000);
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const deps = {
    setTimeout: (fn: () => void, ms: number) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimeout: (h: unknown) => { (h as { cleared: boolean }).cleared = true; },
    AbortController,
  };
  // A fetch that never answers on its own but honours its signal (as the real one does).
  const hung = (_: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  const f = createAuthFetch(hung, 25_000, deps);
  const pending = f('https://x.supabase.co/auth/v1/signup', { method: 'POST' });
  assertEquals(timers.length, 1);
  assertEquals(timers[0].ms, 25_000);
  timers[0].fn(); // the timeout fires
  let name = '';
  await pending.catch((e: Error) => (name = e.name));
  assertEquals(name, 'AbortError', 'the hung request ENDS');
  assert(timers[0].cleared, 'and its timer is cleared');
  // A fast request: passes through, timer cleared, no abort.
  const fast = createAuthFetch(async () => 'ok', 25_000, deps);
  assertEquals(await fast('https://x.supabase.co/auth/v1/token?grant_type=pkce'), 'ok');
  assert(timers[1].cleared);
  // Everything else is untouched: no timer at all.
  const before = timers.length;
  const seen: unknown[] = [];
  const other = createAuthFetch(async (i: unknown, n: unknown) => (seen.push([i, n]), 'rest'), 25_000, deps);
  assertEquals(await other('https://x.supabase.co/rest/v1/user_profiles', { method: 'GET' }), 'rest');
  assertEquals(await other('https://x.supabase.co/functions/v1/join-league'), 'rest');
  assertEquals(timers.length, before);
  assertEquals((seen[0] as unknown[])[1], { method: 'GET' });
  // The caller's own signal still aborts.
  const own = new AbortController();
  const g = createAuthFetch(hung, 25_000, deps);
  const p2 = g(new URL('https://x.supabase.co/auth/v1/recover'), { signal: own.signal });
  own.abort();
  let n2 = '';
  await p2.catch((e: Error) => (n2 = e.name));
  assertEquals(n2, 'AbortError');
  // Wiring: only the auth client gets it, and the timeout is the exported constant.
  const client = SOURCES['lib/supabase.ts'];
  assert(client.includes('global: { fetch: authFetch }') && client.includes('AUTH_FETCH_TIMEOUT_MS'));
});

Deno.test('confirm: an UNREADABLE session (a failed refresh) is "unknown", never "signed out": no exchange, at either read', async () => {
  for (const call of [1, 2]) {
    const h = harness({ sessionErrorAtCall: call });
    assertEquals(await h.handle(CONFIRM_URL), 'confirm-ignored', `read #${call}`);
    assertEquals(h.exchanged, [], `read #${call}: nothing exchanged, so nothing spent`);
    if (call === 2) assertEquals(h.slot(), SIGNUP_SLOT, 'the verifier was read and left alone');
    assertFalse(h.calls.includes('confirmed:true'));
    // Nothing was spent, so the SAME link may be tried again once the session can be read.
    assertEquals(await h.handle(CONFIRM_URL), 'confirm-signed-in', `read #${call}: the re-tap is not "duplicate"`);
  }
  // With no error the same link still exchanges.
  assertEquals(await harness({}).handle(CONFIRM_URL), 'confirm-signed-in');
  const src = SOURCES['lib/auth/authLinkHandlers.ts'];
  assertEquals(src.split('.error) {').length - 1 >= 2, true);
});

Deno.test('restore: a write that FAILS reports false (the signal is not a lie); verifierStorage.write surfaces failure', async () => {
  let stored: string | null = null;
  const writeFails: VerifierSlot = { read: async () => stored, write: async () => { throw new Error('disk full'); } };
  assertEquals(await restoreVerifierIfAbsent(writeFails, 'snap'), false);
  assertEquals(stored, null);
  const ok: VerifierSlot = { read: async () => stored, write: async (raw) => { stored = raw; } };
  assertEquals(await restoreVerifierIfAbsent(ok, 'snap'), true);
  assertEquals(stored, 'snap');
  const vs = SOURCES['lib/auth/verifierStorage.ts'];
  const write = vs.slice(vs.indexOf('async write(raw)'));
  assertFalse(/catch/.test(write.replace(/\/\/.*$/gm, '')), 'write() must not swallow its own failure');
  assert(write.includes("if (!store) throw new Error('no storage for the verifier');"));
  assert(write.includes('await store.setItem('));
});

Deno.test('Cancel: signs out BEFORE the recovery hold is released, so the deferred push setup never runs for the cancelled account', () => {
  // The model of SessionProvider's deferred setup: a subscriber that runs setup when the hold ends and a user exists.
  const run = (order: 'signOutFirst' | 'flagFirst') => {
    let userId: string | null = 'u1';
    const pushed: string[] = [];
    setRecoverySession(true);
    const off = subscribeRecoverySession(() => {
      if (isRecoveryHold() || !userId) return;
      pushed.push(userId);
    });
    const signOut = () => {
      userId = null; // userIdRef is updated at SIGNED_OUT, before...
      setRecoverySession(false); // ...the SIGNED_OUT handler clears the flag
    };
    if (order === 'flagFirst') { setRecoverySession(false); signOut(); } else { signOut(); setRecoverySession(false); }
    off();
    setRecoverySession(false);
    return pushed;
  };
  assertEquals(run('flagFirst'), ['u1'], 'the OLD order: the hold ended while the user still existed (the race)');
  assertEquals(run('signOutFirst'), [], 'the NEW order: no user left to set up');
  // The real code.
  const rp = SOURCES['app/reset-password.tsx'];
  const cancel = rp.slice(rp.indexOf('async function handleCancel'), rp.indexOf('async function updatePassword'));
  const drop = cancel.indexOf('pendingRoute.dropHeld()');
  const out = cancel.indexOf('await signOut()');
  const flag = cancel.indexOf('setRecoverySession(false)');
  assert(drop > -1 && out > drop && flag > out, 'dropHeld -> signOut -> clear the flag');
  const sp = SOURCES['lib/SessionProvider.tsx'];
  const listener = sp.slice(sp.indexOf('supabase.auth.onAuthStateChange('));
  const idAt = listener.indexOf('userIdRef.current = session?.user?.id ?? null;');
  assert(idAt > -1 && idAt < listener.indexOf("event === 'SIGNED_OUT'"), 'the user id is cleared before the SIGNED_OUT handler clears the flag');
  assertFalse(/setTimeout\(\(\) => \{ userIdRef\.current/.test(listener), 'and not deferred past it');
  assertFalse(cancel.includes('setupPushNotifications'), 'Cancel never sets up push itself');
  // Robust: a rejected sign-out still clears the flag and leaves; a second tap while it runs does nothing.
  assert(/try \{\s*await signOut\(\);\s*\} catch \{[\s\S]*?\} finally \{[\s\S]*?setRecoverySession\(false\);\s*\}/.test(cancel), 'signOut in try/catch, the flag cleared in finally');
  assert(cancel.includes('if (cancelling.current) return;') && cancel.includes('cancelling.current = true;') && cancel.includes('cancelling.current = false;'));
  assert(cancel.indexOf('cancelling.current = false;') < cancel.indexOf("router.replace('/')"));
});

Deno.test('docs: the junk-link comment no longer claims a junk link can spend the verifier', () => {
  const cl = SOURCES['lib/auth/confirmLink.ts'];
  assertFalse(cl.includes('can still spend a pending verifier'));
  assert(cl.includes('does NOT spend a pending verifier'));
  const vs = SOURCES['lib/auth/verifierSlot.ts'];
  for (const phrase of ['KNOWN LIMITS (accepted', 'delete-then-restore window', 'without sending an email', 'aborted sign-up', 'stuck recovery flag']) {
    assert(vs.includes(phrase), phrase);
  }
  assert(SOURCES['lib/auth/authFetch.ts'].includes('SUBSTRING match') && SOURCES['lib/auth/authFetch.ts'].includes('body that then stalls'));
  assert(SOURCES['lib/auth/recoverySession.ts'].includes('"Password updated"') && SOURCES['lib/auth/recoverySession.ts'].includes('second recovery session'));
});

// ── the recovery hold, and what waits on it ──────────────────────────────

Deno.test('recovery hold: in-progress OR an open form holds; either ending notifies; nothing holds by default', () => {
  assertFalse(isRecoveryHold());
  let notified = 0;
  const off = subscribeRecoverySession(() => notified++);
  setRecoveryInProgress(true);
  assert(isRecoveryHold() && isRecoveryInProgress() && !isRecoverySession());
  setRecoveryInProgress(true); // no change
  assertEquals(notified, 1);
  setRecoverySession(true); // the flag takes over
  setRecoveryInProgress(false);
  assert(isRecoveryHold(), 'the open form still holds');
  setRecoverySession(false);
  assertFalse(isRecoveryHold());
  assertEquals(notified, 4);
  off();
});

Deno.test('pending route: a held deep link is KEPT while a reset is in progress, released once, and dropped on sign-out', () => {
  const p = createPendingRoute();
  p.authChanged('signedOut');
  p.record('fantasystockapp:///join-league');
  assertEquals(p.authChanged('ready', true), null, 'not replayed over the reset form');
  assertEquals(p.peek(), null);
  assertEquals(p.releaseHold(), '/join-league', 'handed back when the hold ends');
  assertEquals(p.releaseHold(), null, 'once');
  // Without a hold the behaviour is unchanged.
  const q = createPendingRoute();
  q.authChanged('signedOut');
  q.record('fantasystockapp:///join-league');
  assertEquals(q.authChanged('ready'), '/join-league');
  // A cancelled reset (sign-out) ends the held link with the session.
  const r = createPendingRoute();
  r.authChanged('signedOut');
  r.record('fantasystockapp:///create-league');
  r.authChanged('ready', true);
  r.authChanged('signedOut');
  assertEquals(r.releaseHold(), null);
  // Cancel drops a kept link explicitly, before the hold ends.
  const d = createPendingRoute();
  d.authChanged('signedOut');
  d.record('fantasystockapp:///create-league');
  d.authChanged('ready', true);
  d.dropHeld();
  assertEquals(d.releaseHold(), null);
  // A hold with nothing recorded holds nothing.
  const t = createPendingRoute();
  t.authChanged('signedOut');
  assertEquals(t.authChanged('ready', true), null);
  assertEquals(t.releaseHold(), null);
});

Deno.test('wiring: push setup and deep-link replay both WAIT for the recovery hold, and run when it ends', () => {
  const sp = SOURCES['lib/SessionProvider.tsx'];
  assert(sp.includes("event === 'SIGNED_IN' && session?.user && !notificationsSetup.current && !isRecoveryHold()"));
  const release = sp.slice(sp.indexOf('subscribeRecoverySession(() => {'));
  assert(release.includes('if (isRecoveryHold() || !id || notificationsSetup.current) return;'));
  assert(release.includes('setupPushNotifications(id, false)'));
  assert(sp.includes('userIdRef.current = session?.user?.id ?? null;'));
  const layout = SOURCES['app/_layout.tsx'];
  assert(layout.includes('pendingRoute.authChanged(shownPhase, isRecoveryHold())'));
  assert(layout.includes('pendingRoute.releaseHold()') && layout.includes('if (isRecoveryHold()) return;'));
});

Deno.test('wiring: Cancel drops the kept link BEFORE the hold ends; sign-out drops it; handler rejections are caught; double taps are guarded by refs', () => {
  const rp = SOURCES['app/reset-password.tsx'];
  const cancel = rp.slice(rp.indexOf('async function handleCancel'), rp.indexOf('async function updatePassword'));
  assert(cancel.indexOf('pendingRoute.dropHeld()') > -1 && cancel.indexOf('pendingRoute.dropHeld()') < cancel.indexOf('setRecoverySession(false)'));
  const sp = SOURCES['lib/SessionProvider.tsx'];
  const out = sp.slice(sp.indexOf("event === 'SIGNED_OUT'"), sp.indexOf("event === 'SIGNED_OUT'") + 700);
  assert(out.indexOf('pendingRoute.dropHeld()') > -1 && out.indexOf('pendingRoute.dropHeld()') < out.indexOf('setRecoverySession(false)'));
  const layout = SOURCES['app/_layout.tsx'];
  assertEquals(layout.split("handleDeepLink(").length - 1 >= 2, true);
  assertEquals(layout.split(".catch(() => console.warn('[auth] link handler failed', ''))").length - 1, 2, 'both delivery paths catch');
  assert(SOURCES['components/shell/ConfirmEmailSent.tsx'].includes('if (inFlight.current) return;'));
  assert(/\} finally \{\s*inFlight\.current = false;/.test(SOURCES['components/shell/ConfirmEmailSent.tsx']), 'released in a finally, so a throwing onResend cannot wedge the guard');
  assert(SOURCES['app/create-account.tsx'].includes("if (status !== 'idle' || creating.current) return;"));
  assert(SOURCES['app/create-account.tsx'].includes('creating.current = false;'));
});

Deno.test('wiring: sign-up and reset keep the pending verifier on failure, and hold their floor on a throw', () => {
  const sp = SOURCES['lib/SessionProvider.tsx'];
  const signUp = sp.slice(sp.indexOf('const signUp = useCallback'), sp.indexOf('const fixtureSocial'));
  assert(signUp.includes('withVerifierKept('));
  assert(signUp.includes('(r) => r.tooSoon || !!r.res.error'), 'an ERROR result triggers the restore');
  assert(signUp.indexOf('withVerifierKept(') < signUp.indexOf('supabase.auth.signUp('));
  assert(/catch \(e\) \{[^}]*confirmationCooldown\.markSent\(email\);[^}]*throw e;/.test(signUp), 'a throw may follow a request that went out: the throw path itself holds the floor');
  const fp = SOURCES['app/forgot-password.tsx'];
  assert(fp.includes('withVerifierKept(') && fp.indexOf('withVerifierKept(') < fp.indexOf('supabase.auth.resetPasswordForEmail('));
  assert(fp.includes('(x) => x.tooSoon || !!x.r.error'), 'an ERROR result triggers the restore');
  assert(/catch \(e\) \{[^}]*resetCooldown\.markSent\(email\);[^}]*throw e;/.test(fp), 'the throw path itself holds the floor');
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
  const getSession = h.indexOf('deps.getSession()');
  const readSlot = h.indexOf('await deps.readVerifier()');
  const exchangeCall = h.indexOf('await exchange(url, action.code, snapshot)');
  assert(getSession > -1 && readSlot > getSession && exchangeCall > readSlot, 'session check -> slot read -> exchange');
  // Both link kinds read the slot before any exchange can happen.
  assertEquals(h.split('await deps.readVerifier()').length - 1, 2);
  assert(h.indexOf('await deps.readVerifier()', readSlot + 1) < h.indexOf('await exchange(url, parsed.code, snapshot)'));
  // The layout hands the handler the real slot and the hold.
  assert(layout.includes('readVerifier: verifierSlot.read,') && layout.includes('writeVerifier: verifierSlot.write,'));
  assert(layout.includes('setRecoveryInProgress,'));
});
