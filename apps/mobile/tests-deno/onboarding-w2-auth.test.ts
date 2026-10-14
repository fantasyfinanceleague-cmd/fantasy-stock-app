/**
 * Onboarding W2 (plan 2026-10-14): Sign in with Apple / Google, the approved Check-your-email copy,
 * privacy, the Google/Apple native config, and the create-account form without a username.
 * The email-link side (PKCE code exchange, recovery) is in pkce-auth-links.test.ts.
 *
 *   cd apps/mobile/tests-deno && deno test .
 *
 * The pure modules are tested directly; the React/native wiring is pinned by source scans (the
 * SOURCES manifest), each one a rule a regression would have to break on purpose.
 */
import { assert, assertEquals, assertFalse, assertThrows } from 'jsr:@std/assert';
import { CONFIRM_EMAIL_COPY as COPY, confirmSentBody } from '../constants/confirmEmailCopy.ts';
import { isAppleCancel, isGoogleCancel, toAuthError } from '../lib/auth/socialOutcome.ts';
import { getAuthErrorMessage, isEmailNotConfirmedError, isSignupsPausedError } from '../lib/authErrors.ts';
import { SOURCES } from './sourceManifest.generated.ts';
import APP_CONFIG_SRC from '../app.config.js' with { type: 'text' };
import APP_JSON from '../app.json' with { type: 'json' };

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

Deno.test('wiring: Create account has no username field and shows Check your email', () => {
  const src = SOURCES['app/create-account.tsx'];
  assertFalse(src.includes('label="Username"'));
  assertFalse(src.includes('Alert.alert'), 'the old success Alert is now the Check your email state');
  assert(/if \(sentTo\) \{\s*return \(\s*<ConfirmEmailSent/.test(src), 'success must render Check your email, not fall through');
  assert(src.includes('setSentTo(email.trim())'));
  assert(src.includes('<SocialSignIn onPaused={showPaused} />'));
  assert(SOURCES['app/login.tsx'].includes('<SocialSignIn />'));
});

Deno.test('nonce: Apple sends its nonce (hash to Apple, raw to Supabase); Google sends none, by Giorgio\'s decision, with the risk written at the call site', () => {
  const raw = SOURCES['lib/auth/socialSignIn.ts'];
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // Apple: the SHA-256 of a CSPRNG value goes into the request; the raw value goes to signInWithIdToken.
  assert(code.includes('nonce: hashedNonce'));
  assert(/signInWithIdToken\(\{\s*provider: 'apple',\s*token: credential\.identityToken,\s*nonce: rawNonce,\s*\}\)/.test(code));
  assert(code.includes('digestStringAsync(CryptoDigestAlgorithm.SHA256, rawNonce)'));
  assert(code.includes('getRandomBytes(32)'));
  // Google: exactly provider + token. Nothing else rides along (no nonce, no options).
  assert(code.includes("signInWithIdToken({ provider: 'google', token: idToken })"));
  const googleCalls = code.match(/signInWithIdToken\(\{[^}]*provider: 'google'[^}]*\}\)/g) ?? [];
  assertEquals(googleCalls.length, 1);
  assertFalse(/nonce/i.test(googleCalls[0] ?? "nonce"));
  // The decision and its bounded risk are written down where the call is made (comments are not stripped here).
  assert(raw.includes('No nonce, deliberately'));
  assert(raw.includes('"Skip nonce checks" ON'));
  assert(raw.includes('replayed to') && raw.includes('validity window'));
  assert(raw.includes('audience') && raw.includes('exactly those two and nothing else'));
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
