// Onboarding W2 (PKCE) — what every auth return link has in common: the confirmation link
// (lib/auth/confirmLink.ts) and the password-recovery link (lib/recoveryLink.ts).
//
// With flowType 'pkce' (lib/supabase.ts) GoTrue redirects the email link to
//   https://<domain>/auth/confirm?code=<one-time code>              (sign-up confirmation; the universal link, opened by
//                                                                   the app when installed. The scheme form
//                                                                   fantasystockapp://auth/confirm?code=… is the fallback.)
//   fantasystockapp://reset-password?flow=pkce&code=<one-time code> (password recovery)
// and the app calls supabase.auth.exchangeCodeForSession(code). The exchange succeeds only on the
// device that holds the code VERIFIER stored when the flow began, so a crafted link, a replayed link
// and a link intercepted by another app registering this scheme all fail. That replaced the old
// "tokens in the fragment + a nonce we stored" scheme, whose nonce existed to stop exactly that.
//
// Pure (no React Native imports) so tests-deno can exercise it hermetically.

import { WEB_BASE } from '../links/webDomain';

/** The scheme fallback. Kept in step with app.json's `expo.scheme`. */
export const APP_SCHEME_BASE = 'fantasystockapp://';

/**
 * Every origin a link may arrive on. The scheme is first and is what the password-reset email carries
 * (lib/recoveryLink.ts pins it); the https universal link (W3; app.json associatedDomains + the web app's
 * apple-app-site-association) is what the sign-up confirmation email carries (lib/auth/confirmLink.ts).
 */
export const AUTH_LINK_BASES: readonly string[] = [APP_SCHEME_BASE, WEB_BASE];

/** React Native's `__DEV__`, read off globalThis so this pure module also loads under Deno. */
export function isDevBuild(): boolean {
  return (globalThis as { __DEV__?: boolean }).__DEV__ === true;
}

/**
 * The link's path relative to its accepted base, or null when the URL is not on an accepted origin.
 * A release build accepts ONLY the registered origins (AUTH_LINK_BASES: the scheme's host form
 * fantasystockapp://auth/confirm and its empty-host form fantasystockapp:///auth/confirm). Two
 * conveniences exist for development and tests and are off in a release, where a link can only
 * arrive through a registered origin: a bare app-relative path, and Expo Go's
 * exp(s)://host:port/--/auth/confirm.
 */
export function linkRelativePath(url: string, dev: boolean, bases: readonly string[] = AUTH_LINK_BASES): string | null {
  const end = url.search(/[?#]/);
  const head = end === -1 ? url : url.slice(0, end);
  for (const base of bases) {
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

/** True when the URL's path (relative to an accepted origin) is exactly `path`. */
export function linkIsPath(
  url: string | null | undefined,
  path: string,
  dev: boolean,
  bases: readonly string[] = AUTH_LINK_BASES
): boolean {
  if (!url) return false;
  const rel = linkRelativePath(url.trim(), dev, bases);
  return rel !== null && rel.replace(/\/+$/, '') === path;
}

/** A GoTrue PKCE auth code is a UUID. Anything else (empty, huge, odd characters) is not a code. */
const CODE_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LinkOutcome =
  /** A well-formed one-time code, read from the QUERY only. */
  | { kind: 'code'; code: string }
  /** GoTrue's expired / used / invalid redirect (error_code=otp_expired, access_denied ...). */
  | { kind: 'error'; code: string }
  /** The right path, but nothing usable on it. */
  | { kind: 'empty' };

/**
 * Reads the outcome off an auth link that already matched its path. The CODE comes only from the
 * query string (strictly before any '#'); the fragment is attacker-shapeable and is never a source
 * of one. An error may arrive in either place (GoTrue puts a PKCE flow's in the query, an implicit
 * one's in the fragment) and always wins over a code, because it carries no session.
 */
export function readLinkOutcome(url: string): LinkOutcome {
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const query = new URLSearchParams(
    queryIndex !== -1 && (hashIndex === -1 || queryIndex < hashIndex)
      ? url.substring(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex)
      : ''
  );
  const fragment = new URLSearchParams(hashIndex === -1 ? '' : url.substring(hashIndex + 1));

  const errorCode = query.get('error_code') || query.get('error') || fragment.get('error_code') || fragment.get('error');
  if (errorCode) return { kind: 'error', code: errorCode };

  const code = query.get('code');
  if (code && CODE_SHAPE.test(code)) return { kind: 'code', code };
  return { kind: 'empty' };
}

/**
 * supabase-js's exchangeCodeForSession adds `redirectType` to its result at runtime (it reads the stored
 * verifier: 'PASSWORD_RECOVERY' for a reset, null for a sign-up), but its TypeScript result type doesn't
 * declare it. Read it through here so the one `unknown` cast lives in a tested place.
 */
export function redirectTypeOf(result: unknown): string | null {
  const t = (result as { redirectType?: unknown } | null | undefined)?.redirectType;
  return typeof t === 'string' ? t : null;
}

/**
 * In-memory "have we handled this link already". On a cold start the same link can arrive twice
 * (getInitialURL AND the 'url' event); the handler must run once, because a code is single use and
 * the second exchange would fail (and, on the recovery path, flip a working reset to "invalid").
 * Bounded, oldest first. Returns true the FIRST time a key is seen (the caller proceeds) and false
 * on any repeat. Mark BEFORE awaiting anything: the two deliveries race.
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
    /**
     * Forget a key, so the SAME link may be handled again. Used only when the exchange failed on the
     * network (nothing reached GoTrue, the code is not spent): the genuine link can then be retried.
     */
    release(key: string): void {
      const at = seen.indexOf(key);
      if (at !== -1) seen.splice(at, 1);
    },
  };
}
