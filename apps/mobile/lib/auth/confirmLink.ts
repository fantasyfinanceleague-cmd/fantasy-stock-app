// Onboarding W2 — the email-confirmation return link (plan 2026-10-14, "Email confirmation").
//
// With "Confirm email" ON, supabase.auth.signUp() returns no session. The email's link goes to
// GoTrue's /verify, which confirms the address SERVER-SIDE and redirects to the `emailRedirectTo`
// this module builds, carrying a one-time code (PKCE; shared mechanics in lib/auth/authLink.ts):
//
//   fantasystockapp://auth/confirm?code=<one-time code>
//
// The app exchanges the code for a session (app/_layout.tsx) and continues where the user was (the
// username gate, then any pending route).
//
// SECURITY. A link that signs someone in is a login, so the old risk was login CSRF: an attacker's
// crafted link carrying the ATTACKER's tokens would sign the victim's app into the attacker's
// account. Under PKCE there are no tokens in the link, and the code only exchanges together with the
// code VERIFIER this device stored when the sign-up began (supabase-js, storage key
// `<storageKey>-code-verifier`); GoTrue checks it against the challenge sent with that sign-up. A
// forged, replayed, or intercepted code therefore fails. What stays here:
//   - an existing session is never replaced (a link opened while signed in does nothing, and does
//     not spend the verifier);
//   - a code that exchanges as a PASSWORD RECOVERY is refused on this path (decideConfirmExchange);
//   - the same link is handled once (createLinkDedupe).
// Cross-device (the email opened on another phone) cannot exchange: there is no verifier there, so
// the person signs in with their password (the address is already confirmed).
//
// A junk link (`?code=anything`) can still spend a pending verifier, because supabase-js removes it
// after every exchange attempt. The cost is the same as for any lost link: sign in with the password.
//
// THE BASE (scheme now, universal link later): AUTH_LINK_BASES (authLink.ts) is the one place a
// domain is added (`https://<domain>/`); the parser accepts ONLY exact prefixes, so a look-alike host
// never parses as a confirm link.

import {
  AUTH_LINK_BASES,
  createLinkDedupe,
  isDevBuild,
  linkIsPath,
  readLinkOutcome,
  type LinkOutcome,
} from './authLink';

export { AUTH_LINK_BASES, createLinkDedupe };

export const CONFIRM_PATH = 'auth/confirm';

/** The `emailRedirectTo` for signUp(): no query, no secret. The code is added by GoTrue. */
export function buildConfirmRedirect(base: string = AUTH_LINK_BASES[0]): string {
  return `${base}${CONFIRM_PATH}`;
}

/**
 * True when the URL is a confirmation return link that may SIGN SOMEONE IN (exact path; never a
 * substring match; release builds: registered origins only). `dev` defaults to the build's
 * __DEV__; tests pass it explicitly.
 */
export function isConfirmLink(url: string | null | undefined, dev: boolean = isDevBuild()): boolean {
  return linkIsPath(url, CONFIRM_PATH, dev);
}

/**
 * True when a path the ROUTER sees names the confirm route, in any shape. Navigation only
 * (+native-intent sends it to sign-in instead of a route that doesn't exist); it never signs
 * anyone in, which is why it can be broader than isConfirmLink.
 */
export function isConfirmRoute(path: string | null | undefined): boolean {
  return isConfirmLink(path, true);
}

export type ConfirmLinkResult = LinkOutcome | { kind: 'none' };

/** `none` when the URL is not a confirm link at all (the caller leaves it alone). */
export function parseConfirmLink(raw: string | null | undefined, dev: boolean = isDevBuild()): ConfirmLinkResult {
  if (!raw || !isConfirmLink(raw, dev)) return { kind: 'none' };
  return readLinkOutcome(raw.trim());
}

export type ConfirmLinkAction =
  /** Exchange this one-time code for a session. */
  | { kind: 'exchange'; code: string }
  /** Use nothing from the link: sign in with the password (the address is already confirmed). */
  | { kind: 'ignore' };

/**
 * The whole pre-exchange decision, pure. `hasSession` is whether ANY session exists right now.
 * An existing session is never replaced; only a well-formed code is ever exchanged.
 */
export function decideConfirmLink(parsed: ConfirmLinkResult, hasSession: boolean): ConfirmLinkAction {
  if (parsed.kind !== 'code') return { kind: 'ignore' };
  if (hasSession) return { kind: 'ignore' };
  return { kind: 'exchange', code: parsed.code };
}

/**
 * After the exchange: `redirectType` is supabase-js's reading of the stored verifier. A sign-up
 * confirmation is null; a password-recovery code is 'PASSWORD_RECOVERY'. A recovery session must not
 * be accepted as an email confirmation (the caller signs it out again).
 */
export function isSignupExchange(redirectType: string | null | undefined): boolean {
  return redirectType === null || redirectType === undefined || redirectType === '';
}
