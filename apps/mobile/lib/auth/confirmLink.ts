// Onboarding W2 — the email-confirmation return link (plan 2026-10-14, "Email confirmation").
//
// With "Confirm email" ON, supabase.auth.signUp() returns no session. The email's link goes to
// GoTrue's /verify, which confirms the address SERVER-SIDE and then redirects to the
// `emailRedirectTo` this module builds, with the new session in the fragment (implicit flow,
// lib/supabase.ts):
//
//   fantasystockapp://auth/confirm?cn=<nonce>#access_token=…&refresh_token=…&type=signup
//
// The app signs in from that link and continues where the user was (the username gate, then any
// pending route). Pure (no React Native imports) so tests-deno can exercise it hermetically.
//
// SECURITY, the same rule as the recovery link (lib/recoveryLink.ts, lib/recoveryNonce.ts, F2):
// a link that carries tokens is a login. An attacker's crafted link with the ATTACKER's tokens
// would silently sign the victim's app into the attacker's account (login CSRF). So the tokens
// are only used when the link carries a nonce THIS device generated for a sign-up it started
// (`cn`, read strictly from the QUERY — never the fragment, which the sender controls in full),
// and app/_layout.tsx never replaces an existing session with one. Everything else is refused
// and harmless: the address is already confirmed by the time the redirect happens, so the
// person signs in with their password (the email confirmed on another device is exactly this).
//
// THE BASE (scheme now, universal link later): until W3/W5 land the web domain, the redirect is
// the app scheme. AUTH_LINK_BASES is the one place a domain is added (`https://<domain>/`); the
// parser accepts ONLY these exact prefixes, so a look-alike host never parses as a confirm link.

/** The scheme fallback. Kept in step with app.json's `expo.scheme`. */
export const APP_SCHEME_BASE = 'fantasystockapp://';

/** Every origin a confirmation link may arrive on; the first one is what new emails carry. */
export const AUTH_LINK_BASES: readonly string[] = [APP_SCHEME_BASE];

export const CONFIRM_PATH = 'auth/confirm';

/** The query key carrying the device nonce (cf. `rn` on the recovery link). */
export const CONFIRM_NONCE_PARAM = 'cn';

/** The `emailRedirectTo` for signUp() and resend(). */
export function buildConfirmRedirect(nonce: string, base: string = AUTH_LINK_BASES[0]): string {
  return `${base}${CONFIRM_PATH}?${CONFIRM_NONCE_PARAM}=${encodeURIComponent(nonce)}`;
}

/**
 * The link's path relative to its accepted base, or null when the URL is not on an accepted
 * origin. Handles the scheme's host form (fantasystockapp://auth/confirm), its empty-host form
 * (fantasystockapp:///auth/confirm) and a DEV Expo Go form (exp://host:port/--/auth/confirm).
 */
function relativePath(url: string): string | null {
  const end = url.search(/[?#]/);
  const head = end === -1 ? url : url.slice(0, end);
  // Already app-relative (expo-router hands +native-intent a path in some shapes).
  if (head.startsWith('/')) return head.replace(/^\/+/, '');
  for (const base of AUTH_LINK_BASES) {
    if (head.startsWith(base)) return head.slice(base.length).replace(/^\/+/, '');
  }
  if (/^exps?:\/\//.test(head)) {
    const marker = head.indexOf('/--/');
    return marker === -1 ? null : head.slice(marker + 4);
  }
  return null;
}

/** True when the URL is a confirmation return link (exact path; never a substring match). */
export function isConfirmLink(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = relativePath(url.trim());
  return path !== null && path.replace(/\/+$/, '') === CONFIRM_PATH;
}

export type ConfirmLinkResult =
  /** A session to set, IF the nonce verifies. */
  | { kind: 'tokens'; accessToken: string; refreshToken: string; nonce: string | null }
  /** GoTrue's expired / used / invalid redirect (#error=…&error_code=otp_expired). */
  | { kind: 'error'; code: string }
  /** A confirm link with nothing usable (no fragment, wrong type, missing token). */
  | { kind: 'empty' }
  /** Not a confirmation link at all: the caller leaves it alone. */
  | { kind: 'none' };

export function parseConfirmLink(raw: string | null | undefined): ConfirmLinkResult {
  if (!raw || !isConfirmLink(raw)) return { kind: 'none' };
  const url = raw.trim();

  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  let nonce: string | null = null;
  if (queryIndex !== -1 && (hashIndex === -1 || queryIndex < hashIndex)) {
    const query = url.substring(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex);
    nonce = new URLSearchParams(query).get(CONFIRM_NONCE_PARAM) || null;
  }
  if (hashIndex === -1) return { kind: 'empty' };

  const params = new URLSearchParams(url.substring(hashIndex + 1));
  const errorCode = params.get('error_code') || params.get('error');
  if (errorCode) return { kind: 'error', code: errorCode };

  // Only a sign-up confirmation signs in from this path. A recovery or magic-link session
  // pasted onto it (whatever its nonce) is not what this handler is for.
  if (params.get('type') !== 'signup') return { kind: 'empty' };

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return { kind: 'empty' };
  return { kind: 'tokens', accessToken, refreshToken, nonce };
}

export type ConfirmLinkAction =
  /** Set the session from the link's tokens. */
  | { kind: 'signIn'; accessToken: string; refreshToken: string }
  /** Use nothing from the link. The address is confirmed (or the link is dead): sign in. */
  | { kind: 'ignore' };

/**
 * The whole decision, pure. `nonceOk` is the result of the single-use, fail-closed check against
 * the nonce this device stored at sign-up; `hasSession` is whether ANY session exists right now.
 * Precedence: an existing session is never replaced (whoever is signed in stays signed in), then
 * the nonce must match, then the link must actually carry tokens.
 */
export function decideConfirmLink(parsed: ConfirmLinkResult, nonceOk: boolean, hasSession: boolean): ConfirmLinkAction {
  if (parsed.kind !== 'tokens') return { kind: 'ignore' };
  if (hasSession) return { kind: 'ignore' };
  if (!nonceOk) return { kind: 'ignore' };
  return { kind: 'signIn', accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
}
