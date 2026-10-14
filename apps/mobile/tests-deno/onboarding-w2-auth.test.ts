/**
 * Onboarding W2 (plan 2026-10-14): Sign in with Apple / Google, email confirmation ON, the
 * confirmation link's return into the app, and the create-account form without a username.
 *
 *   cd apps/mobile/tests-deno && deno test .
 *
 * The pure modules are tested directly; the React/native wiring is pinned by source scans (the
 * SOURCES manifest), each one a rule a regression would have to break on purpose.
 */
import { assert, assertEquals, assertFalse, assertThrows } from 'jsr:@std/assert';
import {
  AUTH_LINK_BASES,
  buildConfirmRedirect,
  confirmedEmailMatches,
  createLinkDedupe,
  decideConfirmLink,
  isConfirmLink,
  isConfirmRoute,
  parseConfirmLink,
  type ConfirmLinkResult,
} from '../lib/auth/confirmLink.ts';
import { CONFIRM_NONCE_KEY, CONFIRM_NONCE_TTL_MS, constantTimeEqual, createConfirmNonceStore, type NonceStorage } from '../lib/auth/confirmNonceCore.ts';
import { CONFIRM_EMAIL_COPY as COPY, confirmSentBody } from '../constants/confirmEmailCopy.ts';
import { isEmailJustConfirmed, setEmailJustConfirmed, subscribeEmailJustConfirmed } from '../lib/auth/emailConfirmed.ts';
import { isAppleCancel, isGoogleCancel, toAuthError } from '../lib/auth/socialOutcome.ts';
import { getAuthErrorMessage, isEmailNotConfirmedError, isSignupsPausedError } from '../lib/authErrors.ts';
import { createPendingRoute } from '../lib/shell/pendingRoute.ts';
import { resolveResumeTarget } from '../lib/shell/resumeTarget.ts';
import { SOURCES } from './sourceManifest.generated.ts';
import APP_CONFIG_SRC from '../app.config.js' with { type: 'text' };
import APP_JSON from '../app.json' with { type: 'json' };

const NONCE = 'a'.repeat(64);
const TOKENS = 'access_token=AT&expires_in=3600&refresh_token=RT&token_type=bearer&type=signup';

// ── the redirect and the link's shape ─────────────────────────────────────

Deno.test('confirm redirect: the scheme fallback, nonce in the query, encoded', () => {
  assertEquals(AUTH_LINK_BASES[0], 'fantasystockapp://');
  assertEquals(buildConfirmRedirect(NONCE), `fantasystockapp://auth/confirm?cn=${NONCE}`);
  assertEquals(buildConfirmRedirect('a b&c'), 'fantasystockapp://auth/confirm?cn=a%20b%26c');
  // The scheme is app.json's: a drift would send every confirmation to an app that isn't there.
  assertEquals(APP_JSON.expo.scheme + '://', AUTH_LINK_BASES[0]);
});

Deno.test('isConfirmLink: the registered origins sign in, in a release build', () => {
  for (const url of [
    `fantasystockapp://auth/confirm?cn=${NONCE}#${TOKENS}`, // host form, as GoTrue redirects
    `fantasystockapp:///auth/confirm?cn=${NONCE}`, // empty-host form
    'fantasystockapp://auth/confirm/',
  ]) {
    assert(isConfirmLink(url, false), url);
    assert(isConfirmLink(url, true), url);
  }
});

Deno.test('isConfirmLink: the bare-path and exp(s):// shapes are DEV-ONLY (a release build never signs in from them)', () => {
  for (const url of [
    'exp://127.0.0.1:8081/--/auth/confirm?cn=x', // Expo Go
    'exps://host.example:443/--/auth/confirm?cn=x',
    '/auth/confirm?cn=x', // app-relative
    '//auth/confirm',
  ]) {
    assert(isConfirmLink(url, true), `dev: ${url}`);
    assertFalse(isConfirmLink(url, false), `release: ${url}`);
    assertFalse(isConfirmLink(url), `default (no __DEV__ under Deno) must be the release rule: ${url}`);
    // ...and so the parser hands back nothing usable in a release, tokens or not.
    assertEquals(parseConfirmLink(`${url}#${TOKENS}`, false), { kind: 'none' }, url);
  }
  assertEquals(parseConfirmLink(`exp://127.0.0.1:8081/--/auth/confirm?cn=${NONCE}#${TOKENS}`, true).kind, 'tokens');
});

Deno.test('isConfirmRoute: navigation only: every shape redirects to sign-in, none of them signs anyone in', () => {
  for (const p of ['/auth/confirm', '/auth/confirm?cn=x', 'fantasystockapp://auth/confirm?cn=x', 'exp://h:1/--/auth/confirm']) {
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
    'fantasystockapp://reset-password?rn=x#access_token=a&refresh_token=b&type=recovery',
    'fantasystockapp://join-league?code=X#auth/confirm',
    'https://evil.example/auth/confirm#access_token=a&refresh_token=b&type=signup',
    'evilfantasystockapp://auth/confirm',
    'exp://127.0.0.1:8081/auth/confirm', // no /--/ marker
    '',
    null,
    undefined,
  ]) {
    assertFalse(isConfirmLink(url as string), String(url));
  }
});

Deno.test('parseConfirmLink: tokens, with the nonce from the QUERY only', () => {
  assertEquals(parseConfirmLink(`fantasystockapp://auth/confirm?cn=${NONCE}#${TOKENS}`), {
    kind: 'tokens',
    accessToken: 'AT',
    refreshToken: 'RT',
    nonce: NONCE,
  });
  // A nonce smuggled into the fragment (which the sender controls in full) is never read.
  const smuggled = parseConfirmLink(`fantasystockapp://auth/confirm#${TOKENS}&cn=${NONCE}`);
  assertEquals(smuggled.kind === 'tokens' ? smuggled.nonce : 'not tokens', null);
  // ...and a `?cn=` that sits AFTER the '#' is fragment too: it never becomes the nonce (here it
  // even spoils `type`, so the link is refused outright).
  const late = parseConfirmLink(`fantasystockapp://auth/confirm#${TOKENS}?cn=${NONCE}`);
  assertEquals(late, { kind: 'empty' });
  const lateNoType = parseConfirmLink(`fantasystockapp://auth/confirm#access_token=AT&refresh_token=RT&type=signup&x=?cn=${NONCE}`);
  assertEquals(lateNoType.kind === 'tokens' ? lateNoType.nonce : 'not tokens', null);
});

Deno.test('parseConfirmLink: the error redirect, empty links and non-signup sessions', () => {
  assertEquals(
    parseConfirmLink(`fantasystockapp://auth/confirm?cn=${NONCE}#error=access_denied&error_code=otp_expired&error_description=x`),
    { kind: 'error', code: 'otp_expired' }
  );
  assertEquals(parseConfirmLink(`fantasystockapp://auth/confirm?cn=${NONCE}`), { kind: 'empty' });
  // A recovery or magic-link session is not what this path signs in with, whatever its nonce.
  for (const type of ['recovery', 'magiclink', 'email_change', '']) {
    assertEquals(
      parseConfirmLink(`fantasystockapp://auth/confirm?cn=${NONCE}#access_token=AT&refresh_token=RT&type=${type}`),
      { kind: 'empty' },
      type
    );
  }
  assertEquals(parseConfirmLink(`fantasystockapp://auth/confirm?cn=${NONCE}#access_token=AT&type=signup`), { kind: 'empty' });
  assertEquals(parseConfirmLink(`fantasystockapp://auth/confirm?cn=${NONCE}#refresh_token=RT&type=signup`), { kind: 'empty' });
  assertEquals(parseConfirmLink('fantasystockapp://reset-password#access_token=a&refresh_token=b&type=recovery'), { kind: 'none' });
});

// ── the decision: who may sign in from a link ─────────────────────────────

Deno.test('decideConfirmLink: the full table (an existing session and a bad nonce each refuse)', () => {
  const tokens: ConfirmLinkResult = { kind: 'tokens', accessToken: 'AT', refreshToken: 'RT', nonce: NONCE };
  for (const nonceOk of [true, false]) {
    for (const hasSession of [true, false]) {
      const action = decideConfirmLink(tokens, nonceOk, hasSession);
      const expected = nonceOk && !hasSession ? 'signIn' : 'ignore';
      assertEquals(action.kind, expected, `nonceOk=${nonceOk} hasSession=${hasSession}`);
    }
  }
  assertEquals(decideConfirmLink(tokens, true, false), { kind: 'signIn', accessToken: 'AT', refreshToken: 'RT' });
  for (const other of [{ kind: 'error', code: 'otp_expired' }, { kind: 'empty' }, { kind: 'none' }] as ConfirmLinkResult[]) {
    for (const nonceOk of [true, false]) {
      for (const hasSession of [true, false]) {
        assertEquals(decideConfirmLink(other, nonceOk, hasSession).kind, 'ignore');
      }
    }
  }
});

Deno.test('the confirm link is never stored for resume, and never erases a pending link', () => {
  const link = `fantasystockapp://auth/confirm?cn=${NONCE}#${TOKENS}`;
  assertEquals(resolveResumeTarget(link), null);
  assertEquals(resolveResumeTarget(`fantasystockapp://auth/confirm?cn=${NONCE}`), null);
  const pending = createPendingRoute();
  pending.authChanged('signedOut');
  pending.record('fantasystockapp:///join-league');
  pending.record(link); // the confirmation round-trip
  assertEquals(pending.peek(), '/join-league');
  pending.authChanged('gated'); // the link signed in; the username gate shows
  assertEquals(pending.authChanged('ready'), '/join-league'); // then the waiting link resumes
});

// ── the nonce store ───────────────────────────────────────────────────────

function memoryStore(opts: { failGet?: boolean; failSet?: boolean; failRemove?: boolean; none?: boolean } = {}) {
  const data = new Map<string, string>();
  let clock = 1_000_000;
  let n = 0;
  const storage: NonceStorage = {
    getItem: (k) => (opts.failGet ? Promise.reject(new Error('get')) : Promise.resolve(data.get(k) ?? null)),
    setItem: (k, v) => (opts.failSet ? Promise.reject(new Error('set')) : (data.set(k, v), Promise.resolve())),
    removeItem: (k) => (opts.failRemove ? Promise.reject(new Error('rm')) : (data.delete(k), Promise.resolve())),
  };
  const store = createConfirmNonceStore({
    storage: () => (opts.none ? null : storage),
    random: () => `nonce-${(n++).toString().padStart(59, '0')}`,
    now: () => clock,
  });
  return { store, data, advance: (ms: number) => (clock += ms) };
}

const ADA = 'ada@example.com';

Deno.test('nonce store: a minted nonce verifies once and only once (single use)', async () => {
  const { store, data } = memoryStore();
  const nonce = await store.getOrCreate(ADA);
  assert(nonce);
  assert(data.has(CONFIRM_NONCE_KEY));
  assertEquals(await store.verifyAndConsume(nonce), ADA);
  assertEquals(await store.verifyAndConsume(nonce), null); // a replayed link
  assertFalse(data.has(CONFIRM_NONCE_KEY));
});

Deno.test('nonce store: a WRONG nonce is refused and does NOT burn the pending one (a junk link cannot DoS a sign-up)', async () => {
  const { store, data } = memoryStore();
  const nonce = (await store.getOrCreate(ADA))!;
  assertEquals(await store.verifyAndConsume('f'.repeat(nonce.length)), null);
  assertEquals(await store.verifyAndConsume('short'), null);
  assert(data.has(CONFIRM_NONCE_KEY), 'a mismatch must leave the real nonce in place');
  assertEquals(await store.verifyAndConsume(nonce), ADA); // the genuine link still works
});

Deno.test('nonce store: bound to the ADDRESS: a resend to the same address reuses it, any other address mints a new one', async () => {
  const { store } = memoryStore();
  const first = (await store.getOrCreate(ADA))!;
  assertEquals(await store.getOrCreate('  Ada@Example.com '), first); // same address (case / space-insensitive)
  const other = (await store.getOrCreate('me@gmial.com'))!; // a mistyped address, then...
  assert(other !== first);
  const corrected = (await store.getOrCreate(ADA))!; // ...the corrected one: NOT the stranger's nonce
  assert(corrected !== other, 'the nonce minted for the mistyped address must not be reused');
  assertEquals(await store.verifyAndConsume(other), null); // and it no longer works
  assertEquals(await store.verifyAndConsume(corrected), ADA);
  assertEquals(await store.getOrCreate(''), null);
});

Deno.test('nonce store: 1 h TTL (GoTrue\'s link expiry): stale never verifies and is deleted; a resend mints a new one', async () => {
  assertEquals(CONFIRM_NONCE_TTL_MS, 60 * 60 * 1000);
  const { store, advance, data } = memoryStore();
  const first = (await store.getOrCreate(ADA))!;
  advance(CONFIRM_NONCE_TTL_MS - 1);
  assertEquals(await store.getOrCreate(ADA), first);
  advance(2);
  assertEquals(await store.verifyAndConsume(first), null);
  assertFalse(data.has(CONFIRM_NONCE_KEY), 'a stale record is cleaned up');
  const again = memoryStore();
  const old = (await again.store.getOrCreate(ADA))!;
  again.advance(CONFIRM_NONCE_TTL_MS + 1);
  const fresh = (await again.store.getOrCreate(ADA))!;
  assert(fresh !== old, 'an expired nonce must not be reused');
  assertEquals(await again.store.verifyAndConsume(fresh), ADA);
});

Deno.test('nonce store: clear() forgets a pending nonce (every sign-in and sign-out)', async () => {
  const { store, data } = memoryStore();
  const nonce = (await store.getOrCreate(ADA))!;
  await store.clear();
  assertFalse(data.has(CONFIRM_NONCE_KEY));
  assertEquals(await store.verifyAndConsume(nonce), null);
  await memoryStore({ failRemove: true }).store.clear(); // never throws
  await memoryStore({ none: true }).store.clear();
});

Deno.test('nonce store: fail closed on every storage failure and on garbage', async () => {
  assertEquals(await memoryStore({ none: true }).store.getOrCreate(ADA), null);
  assertEquals(await memoryStore({ none: true }).store.verifyAndConsume('x'), null);
  assertEquals(await memoryStore({ failSet: true }).store.getOrCreate(ADA), null); // no email without a stored nonce
  assertEquals(await memoryStore({ failGet: true }).store.getOrCreate(ADA), null);
  const { store: s1, data: d1 } = memoryStore();
  const n1 = (await s1.getOrCreate(ADA))!;
  assertEquals(await memoryStore({ failGet: true }).store.verifyAndConsume(n1), null);
  const { store: s2, data: d2 } = memoryStore({ failRemove: true });
  d2.set(CONFIRM_NONCE_KEY, JSON.stringify({ nonce: 'abc', email: ADA, createdAt: 1_000_000 }));
  assertEquals(await s2.verifyAndConsume('abc'), null); // could not consume => not accepted
  for (const junk of ['not json', '{}', '{"nonce":1,"createdAt":2}', '{"nonce":"abc"}', '{"nonce":"abc","createdAt":1000000}', 'null']) {
    d1.set(CONFIRM_NONCE_KEY, junk);
    assertEquals(await s1.verifyAndConsume('abc'), null, junk);
  }
  assertEquals(await s1.verifyAndConsume(''), null);
  assertEquals(await s1.verifyAndConsume(null), null);
});

Deno.test('nonce store: the compare is exact and length-checked', () => {
  assert(constantTimeEqual('abc', 'abc'));
  assertFalse(constantTimeEqual('abc', 'abd'));
  assertFalse(constantTimeEqual('abc', 'abcd'));
  assertFalse(constantTimeEqual('', 'a'));
  const src = SOURCES['lib/auth/confirmNonceCore.ts'];
  assert(src.includes('constantTimeEqual(stored.nonce, inbound)'), 'the verify path must use the constant-time compare');
  assertFalse(/stored\.nonce\s*===?\s*inbound/.test(src));
});

Deno.test('wiring: the nonce is address-bound at both senders, cleared on sign-in / sign-out, and a failed sign-out is not swallowed', () => {
  const sp = SOURCES['lib/SessionProvider.tsx'];
  assertEquals(sp.split('getOrCreateConfirmNonce(email)').length - 1, 2, 'signUp and resend both pass the address');
  assert(sp.includes("if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') clearConfirmNonce();"));
  const out = sp.slice(sp.indexOf('const signOut = useCallback'));
  assert(out.includes('const { error: signOutError } = await supabase.auth.signOut();'));
  assert(out.includes('if (signOutError) {') && out.indexOf('if (signOutError) {') < out.indexOf('await signOutOfGoogle()'), 'Google is left only after Supabase signed out');
  assert(/if \(signOutError\) \{[^}]*return;/.test(out), 'a failed sign-out returns before touching Google');
  // Google signed in natively but returned no token: the native session is closed too.
  const g = SOURCES['lib/auth/socialSignIn.ts'];
  assert(/if \(!idToken\) \{\s*await signOutOfGoogle\(\);/.test(g));
});

Deno.test('email binding: the session a link produced must belong to the address the nonce was minted for', () => {
  assert(confirmedEmailMatches('ada@example.com', 'ada@example.com'));
  assert(confirmedEmailMatches('ada@example.com', '  Ada@Example.COM '));
  assertFalse(confirmedEmailMatches('ada@example.com', 'mallory@example.com'));
  assertFalse(confirmedEmailMatches('ada@example.com', 'ada@example.com.evil'));
  for (const missing of [null, undefined, '', '   ']) {
    assertFalse(confirmedEmailMatches('ada@example.com', missing), `actual ${String(missing)}`);
    assertFalse(confirmedEmailMatches(missing, 'ada@example.com'), `bound ${String(missing)}`);
    assertFalse(confirmedEmailMatches(missing, missing), 'two blanks never match');
  }
});

Deno.test('nonce store hands back the bound address, lowercased, only on a match', async () => {
  const { store } = memoryStore();
  const nonce = (await store.getOrCreate('  Ada@Example.com '))!;
  assertEquals(await store.verifyAndConsume('f'.repeat(nonce.length)), null);
  assertEquals(await store.verifyAndConsume(nonce), 'ada@example.com');
  assertEquals(await store.verifyAndConsume(nonce), null);
});

Deno.test('dedupe: a cold-start link delivered twice is handled once; distinct links each get one run; bounded', () => {
  const d = createLinkDedupe(3);
  const a = `fantasystockapp://auth/confirm?cn=${NONCE}#${TOKENS}`;
  assertEquals(d.firstTime(a), true);
  assertEquals(d.firstTime(a), false); // getInitialURL + the 'url' event
  assertEquals(d.firstTime(a), false);
  assertEquals(d.firstTime(`fantasystockapp://auth/confirm?cn=${'b'.repeat(64)}`), true);
  for (const k of ['k1', 'k2', 'k3']) d.firstTime(k); // pushes `a` out of the 3-entry window
  assertEquals(d.firstTime(a), true, 'the window is bounded (oldest forgotten)');
});

Deno.test('wiring: the link handler dedupes before awaiting, checks the session address, and signs out on a mismatch', () => {
  const src = SOURCES['app/_layout.tsx'];
  assert(src.includes('const handledConfirmLinks = createLinkDedupe();'));
  assert(src.includes('if (handledConfirmLinks.firstTime(event.url)) await handleConfirmLink(confirm);'));
  const body = src.slice(src.indexOf('const handleConfirmLink'), src.indexOf('const handleDeepLink'));
  const set = body.indexOf('supabase.auth.setSession');
  const match = body.indexOf('confirmedEmailMatches(boundEmail, set.user?.email)');
  const out = body.indexOf('await supabase.auth.signOut()');
  const flag = body.indexOf('setEmailJustConfirmed(true)');
  assert(set > -1 && match > set && out > match && flag > out, 'order: setSession -> address match -> signOut on mismatch -> flag');
  assert(/if \(!confirmedEmailMatches\([^)]*\)\) \{[\s\S]*?await supabase\.auth\.signOut\(\);\s*return;\s*\}/.test(body), 'a mismatch signs out and returns before the flag');
  assert(body.includes('const boundEmail = hasSession ? null : await verifyAndConsumeConfirmNonce(parsed.nonce);'));
  assert(body.includes('decideConfirmLink(parsed, boundEmail !== null, hasSession)'));
  assert(body.includes('removePushToken(set.user.id)'), "the refused account's push token is not left registered");
});

Deno.test('wiring: the push token is never logged (presence only)', () => {
  const n = SOURCES['lib/notifications.ts'];
  assertFalse(/console\.\w+\([^)]*[^!]tokenData\.data\s*\)/.test(n), 'no console call is handed the token');
  assertFalse(n.includes("console.log('Push token:'"));
  assert(n.includes("console.log('Push token obtained:', !!tokenData.data)"));
});

// ── the social half ───────────────────────────────────────────────────────

Deno.test('social: cancel detection (Apple by code; Google by the native module\'s codes)', () => {
  assert(isAppleCancel({ code: 'ERR_REQUEST_CANCELED' }));
  assertFalse(isAppleCancel({ code: 'ERR_REQUEST_FAILED' }));
  assertFalse(isAppleCancel(null));
  const codes = { cancelled: '-5', inProgress: 'ASYNC_OP_IN_PROGRESS' };
  assert(isGoogleCancel({ code: '-5' }, codes));
  assert(isGoogleCancel({ code: 'ASYNC_OP_IN_PROGRESS' }, codes));
  assertFalse(isGoogleCancel({ code: '-4' }, codes));
  assertFalse(isGoogleCancel({}, { cancelled: undefined, inProgress: undefined }));
  assertFalse(isGoogleCancel(undefined, codes));
});

Deno.test('social: errors read existing copy, never the server\'s or the SDK\'s own words', () => {
  const brand = 'Stockpile';
  for (const raw of [
    'Unacceptable audience in id_token: [x]',
    'Passed nonce and nonce in id_token should either both exist or not.',
    'Provider (issuer "https://appleid.apple.com") is not enabled',
    'The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1000.)',
    '',
  ]) {
    assertEquals(getAuthErrorMessage(toAuthError({ message: raw }), undefined, brand), 'Something went wrong. Please try again.', raw);
  }
  // The signups gate's refusal on a first Apple/Google sign-in reads Giorgio's text.
  const paused = { message: 'Stockpile is not open for new signups yet — check back soon. Existing accounts can still sign in.' };
  assert(isSignupsPausedError(paused));
  assertEquals(getAuthErrorMessage(paused, undefined, brand), paused.message);
  assertEquals(getAuthErrorMessage({ message: 'Network request failed' }), 'Network error — check your connection and try again.');
  assertEquals(toAuthError('boom'), { message: '', code: undefined });
  assertEquals(toAuthError({ message: 'm', code: 7 }), { message: 'm', code: undefined });
});

Deno.test('email confirmation: the unconfirmed sign-in is recognised by code and by message', () => {
  assert(isEmailNotConfirmedError({ code: 'email_not_confirmed', message: '' }));
  assert(isEmailNotConfirmedError({ message: 'Email not confirmed' }));
  assertFalse(isEmailNotConfirmedError({ code: 'invalid_credentials', message: 'Invalid login credentials' }));
  assertEquals(getAuthErrorMessage({ code: 'email_not_confirmed' }), 'Please verify your email before signing in.');
});

Deno.test('privacy: the app never asserts a false fact about Google\'s claims; it says exactly what is and is not stored', () => {
  // The Google SDK always adds openid + email + profile, so the id token DOES carry name / picture
  // claims, and GoTrue stores them in the auth schema and in every JWT's user_metadata.
  const g = SOURCES['lib/auth/socialSignIn.ts'];
  for (const [path, src] of Object.entries(SOURCES)) {
    assertFalse(
      /(carries|has|contains|sends|includes|with)\s+no\s+(name|picture|profile)\s+(or\s+picture\s+)?claims?/i.test(src),
      `${path} claims the Google token has no name claims, which is false`
    );
    assertFalse(/no profile scope\s*(→|->|=>)/i.test(src), path);
  }
  assert(g.includes('the Google SDK ALWAYS adds openid + email + profile'));
  assert(g.includes('auth.users.raw_user_meta_data') && g.includes('auth.identities.identity_data'));
  assert(g.includes('user_metadata inside every JWT'));
  assert(g.includes('the only SQL reader of that metadata is the signup trigger, and it reads the `username` key'));
  assert(g.includes("Apple's identity token carries no name"), 'the Apple side stays accurate');
});

Deno.test('privacy: THIS APP never requests (beyond the SDK basics), passes, copies or logs a name (Giorgio, 2026-10-14); what GoTrue stores from Google\'s token is not the app\'s doing and is documented, not denied', () => {
  const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const social = stripComments(SOURCES['lib/auth/socialSignIn.ts']);
  // Apple: the email scope and nothing else.
  assert(social.includes('requestedScopes: [apple.AppleAuthenticationScope.EMAIL]'));
  assertFalse(/FULL_NAME|fullName|givenName|familyName/.test(social));
  // Google: we ask for the email scope. That does NOT keep name / picture claims out of the id token
  // (the SDK always adds openid + email + profile, and GoTrue stores whatever the token carries in
  // the auth schema); what this test pins is only what the APP does: it asks for nothing more.
  assert(social.includes("scopes: ['email']"));
  assertFalse(/profile/.test(social.replace(/\/\/.*$/gm, '')), 'the app must not ask for the profile scope itself');
  // No metadata or profile write after a sign-in, and nothing sensitive in a log line.
  assertFalse(/updateUser|user_profiles|\.upsert\(|\.insert\(|options:\s*\{\s*data/.test(social));
  assertFalse(/console\.(log|info|debug|warn|error)/.test(social), 'the social sign-in module logs nothing');
  // Every file that handles the sign-in or the sign-up carries no name field into a write.
  for (const f of ['lib/auth/socialSignIn.ts', 'lib/auth/socialOutcome.ts', 'components/shell/SocialSignIn.tsx', 'lib/SessionProvider.tsx', 'app/create-account.tsx', 'app/login.tsx']) {
    const src = stripComments(SOURCES[f]);
    assertFalse(/given_name|family_name|full_name|givenName|familyName|fullName/.test(src), `${f} touches a name field`);
  }
  // signUp sends no auth metadata at all (the username used to travel there).
  const sp = SOURCES['lib/SessionProvider.tsx'];
  const signUp = stripComments(sp.slice(sp.indexOf('const signUp = useCallback'), sp.indexOf('const resendConfirmation')));
  assertFalse(/\bdata:/.test(signUp));
});

// ── app.config.js: the Google URL scheme ──────────────────────────────────

function loadAppConfig() {
  const module = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', 'process', APP_CONFIG_SRC)(module, module.exports, { env: {} });
  // deno-lint-ignore no-explicit-any
  return module.exports as any;
}

Deno.test('app.config.js: the reversed iOS client ID, or no Google plugin at all', () => {
  const cfg = loadAppConfig();
  assertEquals(cfg.googleIosUrlScheme('123456-abc123.apps.googleusercontent.com'), 'com.googleusercontent.apps.123456-abc123');
  for (const bad of ['', 'abc', '123456-abc123.apps.googleusercontent.com.evil', 'x.apps.googleusercontent.com', null]) {
    assertEquals(cfg.googleIosUrlScheme(bad), null, String(bad));
  }
  const base = { name: 'x', plugins: ['expo-router', '@react-native-google-signin/google-signin'] };
  // Unset: the plugin is removed (it throws without a scheme), so the build still works.
  assertEquals(cfg.withGoogleSignIn(base, undefined).plugins, ['expo-router']);
  // Set: added once, with the derived scheme.
  assertEquals(cfg.withGoogleSignIn(base, '1-a.apps.googleusercontent.com').plugins, [
    'expo-router',
    ['@react-native-google-signin/google-signin', { iosUrlScheme: 'com.googleusercontent.apps.1-a' }],
  ]);
  // Set but malformed: fail the build loudly rather than ship a scheme that can't work.
  assertThrows(() => cfg.withGoogleSignIn(base, 'not-a-client-id'));
  // The default export is what Expo calls; with no env var it is a no-op on app.json's plugins.
  const app = APP_JSON.expo;
  assertEquals(cfg({ config: app }).plugins, app.plugins);
});

Deno.test('app.json: Sign in with Apple entitlement and plugin; no bare Google plugin', () => {
  const app = APP_JSON.expo;
  assertEquals(app.ios.usesAppleSignIn, true);
  assert(app.plugins.includes('expo-apple-authentication'));
  assertFalse(JSON.stringify(app.plugins).includes('google-signin'), 'the Google plugin is added by app.config.js only');
});

// ── source scans: the wiring ──────────────────────────────────────────────

Deno.test('wiring: sign-up sends no username, and its confirmation link is nonce-bound', () => {
  const src = SOURCES['lib/SessionProvider.tsx'];
  const signUp = src.slice(src.indexOf('const signUp = useCallback'), src.indexOf('const resendConfirmation'));
  assertFalse(/username/.test(signUp.replace(/\/\/.*$/gm, '')), 'signUp must not send a username any more');
  assert(signUp.includes('emailRedirectTo: buildConfirmRedirect(nonce)'));
  assert(signUp.includes('if (!nonce) return'), 'no nonce, no email (fail closed)');
  const resend = src.slice(src.indexOf('const resendConfirmation'), src.indexOf('const fixtureSocial'));
  assert(resend.includes("type: 'signup'") && resend.includes('emailRedirectTo: buildConfirmRedirect(nonce)'));
  assert(src.includes('await signOutOfGoogle()'), 'sign-out also leaves Google');
});

Deno.test('copy: Check your email, Giorgio\'s approved words, both variants and the interpolation', () => {
  // Verbatim (approved 2026-10-14).
  assertEquals(confirmSentBody('ada@example.com', 'Stock Scudetto'), 'We sent a link to ada@example.com. Tap it to finish joining Stock Scudetto.');
  assertEquals(confirmSentBody('ada@example.com'), 'We sent a link to ada@example.com. Tap it to finish creating your account.');
  // A missing / blank / non-string league is the no-invite sentence, never "joining undefined".
  for (const none of [undefined, null, '', '   '] as (string | null | undefined)[]) {
    assertEquals(confirmSentBody('ada@example.com', none), 'We sent a link to ada@example.com. Tap it to finish creating your account.');
  }
  // Both values land in the sentence exactly as given (the league trimmed; special characters kept).
  assertEquals(confirmSentBody('o\'brien+x@mail.co.uk', '  The "A" League & Co.  '), 'We sent a link to o\'brien+x@mail.co.uk. Tap it to finish joining The "A" League & Co..');
  assertEquals(COPY.title, 'Check your email');
  assertEquals(COPY.back, 'Back to sign in');
  assertEquals(COPY.resend, "Didn't receive it? Send again");
  assertEquals(COPY.confirmedChip, '✓ EMAIL CONFIRMED');
});

Deno.test('copy: one module; no screen hard-codes the words, and the old placeholder is gone', () => {
  for (const f of ['components/shell/ConfirmEmailSent.tsx', 'app/login.tsx', 'app/create-account.tsx']) {
    const src = SOURCES[f];
    assertFalse(src.includes('Account created!'), `${f} still has the old placeholder body`);
    assertFalse(src.includes('We sent a link'), `${f} hard-codes the approved body`);
    assertFalse(/Didn(&apos;|')t receive it/.test(src.replace(/\/\/.*$/gm, '')), `${f} hard-codes the resend label`);
  }
  const sent = SOURCES['components/shell/ConfirmEmailSent.tsx'];
  assert(sent.includes("from '@/constants/confirmEmailCopy'") && sent.includes('confirmSentBody(email, league)'));
  assertFalse(SOURCES['constants/confirmEmailCopy.ts'].includes('Account created!'));
});

Deno.test('just-confirmed flag: set only after a successful link sign-in; cleared on sign-out', () => {
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

  const layout = SOURCES['app/_layout.tsx'];
  const body = layout.slice(layout.indexOf('const handleConfirmLink'), layout.indexOf('const handleDeepLink'));
  assert(body.indexOf('supabase.auth.setSession') < body.indexOf('setEmailJustConfirmed(true)'));
  // ...and only past BOTH refusals: a failed setSession and a session for a different address.
  assert(/if \(error\) \{[^}]*return;\s*\}/.test(body), 'a failed setSession returns before the flag');
  assert(body.indexOf('confirmedEmailMatches(') < body.indexOf('setEmailJustConfirmed(true)'));
  const sp = SOURCES['lib/SessionProvider.tsx'];
  assert(sp.slice(sp.indexOf("event === 'SIGNED_OUT'")).includes('setEmailJustConfirmed(false)'));
});

Deno.test('wiring: Create account has no username field and shows Check your email', () => {
  const src = SOURCES['app/create-account.tsx'];
  assertFalse(src.includes('label="Username"'));
  assertFalse(src.includes('Alert.alert'), 'the old success Alert is now the Check your email state');
  assert(src.includes('if (sentTo) return <ConfirmEmailSent'), 'success must render Check your email, not fall through');
  assert(src.includes('setSentTo(email.trim())'));
  assert(src.includes('<SocialSignIn onPaused={showPaused} />'));
  assert(SOURCES['app/login.tsx'].includes('<SocialSignIn />'));
});

Deno.test('wiring: the root layout checks the session before consuming the nonce, then decides', () => {
  const src = SOURCES['app/_layout.tsx'];
  const body = src.slice(src.indexOf('const handleConfirmLink'), src.indexOf('const handleDeepLink'));
  const getSession = body.indexOf('supabase.auth.getSession()');
  const verify = body.indexOf('verifyAndConsumeConfirmNonce');
  const decide = body.indexOf('decideConfirmLink(');
  const set = body.indexOf('supabase.auth.setSession');
  assert(getSession > -1 && verify > getSession && decide > verify && set > decide, 'order: session → nonce → decide → setSession');
  assert(body.includes('hasSession ? null : await verifyAndConsumeConfirmNonce'));
  assert(body.includes("if (action.kind !== 'signIn') return;"));
  // The confirm link is handled BEFORE (and instead of) the recovery parser.
  const handler = src.slice(src.indexOf('const handleDeepLink'));
  assert(handler.indexOf('parseConfirmLink') < handler.indexOf('parseRecoveryLink'));
  assert(SOURCES['app/+native-intent.tsx'].includes("if (isConfirmRoute(path)) return '/login';"));
});

Deno.test('wiring: the native sign-in modules are only ever required lazily', () => {
  for (const [path, src] of Object.entries(SOURCES)) {
    for (const mod of ['expo-apple-authentication', '@react-native-google-signin/google-signin']) {
      const staticImport = new RegExp(`^import[^;]*from ['"]${mod.replace('/', '\\/')}['"]`, 'm');
      assertFalse(staticImport.test(src), `${path} imports ${mod} statically (crashes a binary without it)`);
    }
  }
  const social = SOURCES['lib/auth/socialSignIn.ts'];
  assert(social.includes("require('expo-apple-authentication')"));
  assert(social.includes("require('@react-native-google-signin/google-signin')"));
  // Apple's nonce: the HASH goes to Apple, the RAW value to Supabase.
  assert(social.includes('nonce: hashedNonce'));
  assert(social.includes('nonce: rawNonce'));
});
