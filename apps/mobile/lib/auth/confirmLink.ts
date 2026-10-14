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

/** React Native's `__DEV__`, read off globalThis so this pure module also loads under Deno. */
function isDevBuild(): boolean {
  return (globalThis as { __DEV__?: boolean }).__DEV__ === true;
}

/**
 * The link's path relative to its accepted base, or null when the URL is not on an accepted
 * origin. A release build accepts ONLY the registered origins (AUTH_LINK_BASES: the scheme's host
 * form fantasystockapp://auth/confirm and its empty-host form fantasystockapp:///auth/confirm).
 * The two conveniences below exist for development and tests and are off in a release, where a
 * link can only arrive through a registered origin: a bare app-relative path (what a router hands
 * +native-intent in some shapes) and Expo Go's exp(s)://host:port/--/auth/confirm.
 */
function relativePath(url: string, dev: boolean): string | null {
  const end = url.search(/[?#]/);
  const head = end === -1 ? url : url.slice(0, end);
  for (const base of AUTH_LINK_BASES) {
    if (head.startsWith(base)) return head.slice(base.length).replace(/^\/+/, '');
  }
  if (!dev) return null;
  if (head.startsWith('/')) return head.replace(/^\/+/, '');
  if (/^exps?:\/\//.test(head)) {
    const marker = head.indexOf('/--/');
    return marker === -1 ? null : head.slice(marker + 4);
  }
  return null;
}

/**
 * True when the URL is a confirmation return link that may SIGN SOMEONE IN (exact path; never a
 * substring match; release builds: registered origins only, see relativePath). `dev` defaults to
 * the build's __DEV__; tests pass it explicitly.
 */
export function isConfirmLink(url: string | null | undefined, dev: boolean = isDevBuild()): boolean {
  if (!url) return false;
  const path = relativePath(url.trim(), dev);
  return path !== null && path.replace(/\/+$/, '') === CONFIRM_PATH;
}

/**
 * True when a path the ROUTER sees names the confirm route, in any shape. Navigation only
 * (+native-intent sends it to sign-in instead of a route that doesn't exist); it never signs
 * anyone in, which is why it can be broader than isConfirmLink.
 */
export function isConfirmRoute(path: string | null | undefined): boolean {
  return isConfirmLink(path, true);
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

export function parseConfirmLink(raw: string | null | undefined, dev: boolean = isDevBuild()): ConfirmLinkResult {
  if (!raw || !isConfirmLink(raw, dev)) return { kind: 'none' };
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

/**
 * After setSession: the session the link produced must belong to the address this device signed up
 * with (the email stored beside the nonce). A mismatch means the tokens are someone else's, so the
 * caller signs out again and does not show "email confirmed". Case-insensitive; a missing address
 * on either side is a mismatch.
 */
export function confirmedEmailMatches(bound: string | null | undefined, actual: string | null | undefined): boolean {
  const norm = (e: string | null | undefined) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
  const a = norm(bound);
  return a !== '' && a === norm(actual);
}

/**
 * In-memory "have we handled this link already". On a cold start the same link can arrive twice
 * (getInitialURL AND the 'url' event); the handler must run once, because the nonce is single use
 * and the second run would find it gone. Bounded, oldest first. Returns true the FIRST time a key
 * is seen (the caller proceeds) and false on any repeat. Mark BEFORE awaiting anything: the two
 * deliveries race.
 */
export function createLinkDedupe(max = 20) {
  const seen: string[] = [];
  return {
    firstTime(key: string): boolean {
      if (seen.includes(key)) return false;
      seen.push(key);
      if (seen.length > max) seen.shift();
      return true;
    },
  };
}
