// Onboarding W2 — Sign in with Apple and Google, native sheet → supabase.auth.signInWithIdToken.
//
// Both native modules are required LAZILY, inside try/catch, never imported at the top:
// - A binary built before this change has neither module, and runtimeVersion is
//   `appVersion` (app.json), so JS shipped by `eas update` to such a binary would crash at import
//   time on a top-level import. Lazily, the buttons simply don't render there.
// - Expo Go has no Google module; the dev client gets both only after a rebuild.
//
// PRIVACY (Giorgio, 2026-10-14): this app requests, copies, shows and logs no name. What it does
// and does not control, exactly:
// - Apple: asked for the email scope only. Apple's identity token carries no name (the name only
//   ever arrives in the separate fullName credential, which is not requested), so GoTrue has none.
// - Google: asked for the email scope, but the Google SDK ALWAYS adds openid + email + profile, so
//   the id token DOES carry name / picture claims. GoTrue stores them in auth.users.raw_user_meta_data
//   and auth.identities.identity_data, rewrites them on every sign-in, and puts them in
//   user_metadata inside every JWT. The app never reads them and no app table or RPC copies them;
//   the only SQL reader of that metadata is the signup trigger, and it reads the `username` key
//   only. Whether to accept that residue or scrub it is a decision for Giorgio (not built).
// - Nothing here writes user metadata or a profile (no updateUser, no profile upsert).
//
// Apple carries a nonce end to end (the id token's `nonce` is SHA-256(raw); GoTrue re-hashes the
// raw value we send and compares), so a captured Apple token can't be replayed. Google: the free
// @react-native-google-signin API can't pass a nonce, and on iOS the Google SDK may stamp one we
// can't see, so the Google provider runs with Supabase's "Skip nonce checks" (Giorgio's dashboard
// step; the hand-back explains the trade-off). The audience check (our client IDs only) still holds.
//
// Signups stay closed server-side: a first Apple/Google sign-in CREATES a user, and GoTrue runs
// the Before User Created hook (restrict_new_signups, 20260815000000) on that path exactly as on
// email sign-up (supabase/auth internal/api/token_oidc.go → triggerBeforeUserCreatedExternal),
// so the refusal arrives here as an ordinary auth error with Giorgio's message.

import { Platform } from 'react-native';
import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytes } from 'expo-crypto';

import { supabase } from '../supabase';
import { isAppleCancel, isGoogleCancel, toAuthError, type SocialSignInResult } from './socialOutcome';

type AppleModule = typeof import('expo-apple-authentication');
type GoogleModule = typeof import('@react-native-google-signin/google-signin');

let appleModule: AppleModule | null | undefined;
let googleModule: GoogleModule | null | undefined;

export function loadApple(): AppleModule | null {
  if (appleModule !== undefined) return appleModule;
  if (Platform.OS !== 'ios') return (appleModule = null);
  try {
    appleModule = require('expo-apple-authentication') as AppleModule;
  } catch {
    appleModule = null;
  }
  return appleModule;
}

function loadGoogle(): GoogleModule | null {
  if (googleModule !== undefined) return googleModule;
  try {
    googleModule = require('@react-native-google-signin/google-signin') as GoogleModule;
  } catch {
    googleModule = null;
  }
  return googleModule;
}

// Public OAuth client IDs (not secrets: they ship in every Google-enabled app). Read literally so
// Metro inlines them. The iOS one also drives the native URL scheme (app.config.js), so a build
// without it gets neither the scheme nor the button.
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';

function googleConfigured(): boolean {
  return Platform.OS === 'ios' ? !!GOOGLE_IOS_CLIENT_ID && !!GOOGLE_WEB_CLIENT_ID : !!GOOGLE_WEB_CLIENT_ID;
}

export async function isAppleSignInAvailable(): Promise<boolean> {
  const apple = loadApple();
  if (!apple) return false;
  try {
    return await apple.isAvailableAsync();
  } catch {
    return false;
  }
}

export function isGoogleSignInAvailable(): boolean {
  return googleConfigured() && loadGoogle() !== null;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export async function signInWithApple(): Promise<SocialSignInResult> {
  const apple = loadApple();
  if (!apple) return { kind: 'unavailable' };

  const rawNonce = toHex(getRandomBytes(32));
  let credential: Awaited<ReturnType<AppleModule['signInAsync']>>;
  try {
    const hashedNonce = await digestStringAsync(CryptoDigestAlgorithm.SHA256, rawNonce);
    credential = await apple.signInAsync({
      requestedScopes: [apple.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
  } catch (e) {
    if (isAppleCancel(e)) return { kind: 'cancelled' };
    return { kind: 'error', error: toAuthError(e) };
  }
  if (!credential.identityToken) return { kind: 'error', error: { message: '' } };

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) return { kind: 'error', error: { message: error.message, code: error.code } };

  return { kind: 'signedIn' };
}

let googleConfiguredOnce = false;

function configureGoogle(google: GoogleModule): void {
  if (googleConfiguredOnce) return;
  google.GoogleSignin.configure({
    // `scopes` is ADDITIONAL to the SDK's own openid + email + profile, so this does NOT keep name or
    // picture claims out of the id token: GoTrue stores them in the auth schema regardless (see the
    // PRIVACY note at the top of this file). It only avoids asking for anything beyond the basics.
    scopes: ['email'],
    webClientId: GOOGLE_WEB_CLIENT_ID,
    ...(Platform.OS === 'ios' ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
  });
  googleConfiguredOnce = true;
}

/** Called on app sign-out (and after a refused sign-in): the next person picks their own account. */
export async function signOutOfGoogle(): Promise<void> {
  if (!googleConfigured()) return;
  const google = loadGoogle();
  if (!google) return;
  try {
    configureGoogle(google);
    // The SDK keeps its last account across launches; only clear it when it holds one.
    if (google.GoogleSignin.hasPreviousSignIn()) await google.GoogleSignin.signOut();
  } catch {
    // Best effort.
  }
}

export async function signInWithGoogle(): Promise<SocialSignInResult> {
  const google = loadGoogle();
  if (!google || !googleConfigured()) return { kind: 'unavailable' };
  const { GoogleSignin, statusCodes, isCancelledResponse } = google;
  const codes = { cancelled: statusCodes.SIGN_IN_CANCELLED, inProgress: statusCodes.IN_PROGRESS };

  let idToken: string | null = null;
  try {
    configureGoogle(google);
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (isCancelledResponse(response)) return { kind: 'cancelled' };
    idToken = response.data.idToken;
  } catch (e) {
    if (isGoogleCancel(e, codes)) return { kind: 'cancelled' };
    return { kind: 'error', error: toAuthError(e) };
  }
  if (!idToken) {
    await signOutOfGoogle(); // Google signed in natively but gave us nothing to exchange
    return { kind: 'error', error: { message: '' } };
  }

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) {
    // Leave Google's own session too, so the next attempt can pick a different account.
    await signOutOfGoogle();
    return { kind: 'error', error: { message: error.message, code: error.code } };
  }
  return { kind: 'signedIn' };
}
