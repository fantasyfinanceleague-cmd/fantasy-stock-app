// Phase 3b-1 — which deep links may be resumed after sign-in.
//
// The spec's guard rule: a signed-out deep link goes to sign-in, then
// continues to the intended target. Stack.Protected (app/_layout.tsx) does
// the first half — a guarded screen is simply unavailable while signed out,
// so the router falls back to sign-in. This module does the safety half of
// the second: it turns an incoming URL into an internal path the app is
// willing to open on the user's behalf later, or null.
//
// Pure (no React Native imports) so tests-deno can exercise it hermetically.
//
// Deliberately an ALLOWLIST, not a denylist. A resumed link runs after the
// user has authenticated, so anything not explicitly listed here — auth
// screens, the password-recovery link (which has its own nonce-checked
// handler in app/_layout.tsx), dev screens, unknown paths — is refused.

/** Route → the query params that route actually reads (everything else is dropped). */
const RESUMABLE: Record<string, readonly string[]> = {
  'create-league': [],
  'join-league': [],
  'trade-history': [],
  'league-settings': ['leagueId'],
  'player-portfolio': ['userId', 'username'],
  // Tabs (expo-router serves them with or without the "(tabs)" group segment).
  matchup: [],
  league: [],
  portfolio: [],
};

const APP_SCHEME = 'fantasystockapp:';
const EXPO_GO_SCHEMES = new Set(['exp:', 'exps:']);

/** Splits a raw deep link into its app-relative path and query string. */
function toAppRelative(raw: string): { path: string; query: string } | null {
  if (raw.startsWith('/')) {
    const q = raw.indexOf('?');
    return q === -1 ? { path: raw, query: '' } : { path: raw.slice(0, q), query: raw.slice(q + 1) };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // The recovery link carries tokens in the fragment; no resumable route
  // uses one, and it must never be stored.
  if (url.hash) return null;

  if (url.protocol === APP_SCHEME) {
    // fantasystockapp://create-league puts the first segment in the host;
    // fantasystockapp:///create-league leaves the host empty.
    return { path: `/${url.host}${url.pathname}`.replace(/^\/\//, '/'), query: url.search.slice(1) };
  }

  if (EXPO_GO_SCHEMES.has(url.protocol)) {
    // exp://127.0.0.1:8081/--/create-league
    const marker = url.pathname.indexOf('/--/');
    if (marker === -1) return null;
    return { path: url.pathname.slice(marker + 3), query: url.search.slice(1) };
  }

  // http(s), javascript:, anything else: this app has no universal links.
  return null;
}

/**
 * Returns a normalised internal path ("/create-league",
 * "/league-settings?leagueId=…") that is safe to open after sign-in, or
 * null when the link must not be resumed.
 */
export function resolveResumeTarget(raw: string): string | null {
  if (!raw) return null;
  const parts = toAppRelative(raw.trim());
  if (!parts) return null;

  const segments = parts.path.split('/').slice(1); // drop the leading ""
  if (segments[0] === '(tabs)') segments.shift();
  if (segments.length !== 1) return null; // no nesting, no "..", no empty segments

  const route = segments[0];
  if (!Object.prototype.hasOwnProperty.call(RESUMABLE, route)) return null;

  const allowed = RESUMABLE[route];
  const incoming = new URLSearchParams(parts.query);
  const kept = new URLSearchParams();
  for (const key of allowed) {
    const value = incoming.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `/${route}?${query}` : `/${route}`;
}
