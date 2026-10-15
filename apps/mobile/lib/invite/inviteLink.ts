// Onboarding W3 — the invite link: what Share sends, and the strict reader for what arrives.
//
//   https://<domain>/join/<CODE>       universal link (the web page when the app is absent)
//   fantasystockapp://join/<CODE>      the scheme fallback (also fantasystockapp:///join/<CODE>)
//
// The CODE is the sole capability join_league_by_code needs, so a link is a bearer token: it is read
// from the PATH only (never a query or fragment), must be the SHAPE a code can have, and anything else
// is refused rather than repaired. The origin is matched as an exact prefix, so a look-alike host
// (https://fantasy-stock-app.vercel.app.evil.com/..., a userinfo '@' trick) never parses.
//
// Pure (no React Native imports) so tests-deno can exercise it hermetically.

import { AUTH_LINK_BASES, isDevBuild, linkRelativePath } from '../auth/authLink';
import { WEB_BASE } from '../links/webDomain';

export const JOIN_PATH = 'join';

/**
 * A code, as the server mints them: 10 characters of A-Z (no I/O) and 2-9 today; the earliest leagues have
 * 6-character A-Z0-9 codes. 4-12 upper-case letters and digits covers both and nothing odd.
 */
export const INVITE_CODE_SHAPE = /^[A-Z0-9]{4,12}$/;

/**
 * Trim, check the shape on ASCII ONLY, then upper-case. The order matters: toUpperCase() maps some non-ASCII
 * letters onto ASCII ones (dotless 'ı' -> 'I', long 's' -> 'S', 'ß' -> 'SS'), so folding first would let a code
 * the person never typed pass the shape test. The join functions upper-case the same way; the difference is that
 * nothing non-ASCII reaches them from here.
 */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  return /^[A-Za-z0-9]{4,12}$/.test(code) ? code.toUpperCase() : null;
}

/** The link Share sends. Null when the code can't be a link (a legacy code of an odd shape). */
export function buildInviteUrl(code: string): string | null {
  const ok = normalizeInviteCode(code);
  return ok ? `${WEB_BASE}${JOIN_PATH}/${ok}` : null;
}

/**
 * What Share sends. Giorgio's approved sentence, verbatim, then the link on its own line (decision 2:
 * "The share text keeps the code too"). A code that can't be a link falls back to the sentence alone.
 */
export function inviteShareMessage(code: string): string {
  const sentence = `Join my league with code ${code}`;
  const url = buildInviteUrl(code);
  return url ? `${sentence}\n${url}` : sentence;
}

/** Lower-cases A-Z only. String.toLowerCase() also folds non-ASCII letters onto ASCII ones (U+212A KELVIN SIGN -> 'k'). */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

function relativeToBase(url: string, dev: boolean): string | null {
  const direct = linkRelativePath(url, dev);
  if (direct !== null) return direct;
  // linkRelativePath matches bases case-sensitively; retry with the origin folded so
  // HTTPS://FANTASY-STOCK-APP.VERCEL.APP/join/X (a host is case-insensitive) is not lost.
  for (const base of AUTH_LINK_BASES) {
    const head = url.slice(0, base.length);
    if (asciiLower(head) === asciiLower(base) && head !== base) {
      return linkRelativePath(base + url.slice(base.length), dev);
    }
  }
  return null;
}

/** Which kind of link brought the invite: the SHARED https universal link, or anything else (the custom scheme, Expo Go's exp://, a dev path). */
export type InviteOrigin = 'https' | 'scheme';

export interface InviteArrival {
  code: string;
  origin: InviteOrigin;
}

/**
 * The invite in a system link, with its ORIGIN, decided here once and carried with the pending invite (Planner,
 * decision 18). `https` is the link people actually share (https://<domain>/join/<CODE>); it keeps the zero-tap
 * auto-join. Everything else is `scheme`: fantasystockapp://join/<CODE>, which any other app or redirect can fire
 * silently, and the dev-only exp:// and bare-path shapes. A scheme link that arrives while the person is signed in
 * never joins without their tap.
 */
export function parseInviteArrival(raw: string | null | undefined, dev: boolean = isDevBuild()): InviteArrival | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  // Origin match is case-insensitive for the registered bases only (hosts and schemes are); the code is
  // case-folded by the shape check below, so a lower-cased link works too.
  const rel = relativeToBase(url, dev);
  if (rel === null) return null;
  // The https base is the only registered base that starts with 'https': a link that matched it arrived over https.
  const origin: InviteOrigin = asciiLower(url).startsWith(asciiLower(WEB_BASE)) ? 'https' : 'scheme';
  const parts = rel.replace(/\/+$/, '').split('/');
  if (parts.length !== 2 || parts[0] !== JOIN_PATH) return null;
  // Raw ASCII letters and digits only: a percent-escape, a backslash, a space, a dot, unicode: all refused.
  const code = normalizeInviteCode(parts[1]);
  return code ? { code, origin } : null;
}

/**
 * The invite code in a system link, or null for anything that is not exactly an invite link. The code
 * is read from the path only; the query and fragment are cut off and ignored. `dev` adds Expo Go's
 * exp://host/--/join/CODE and a bare /join/CODE (off in a release, where a link can only arrive through
 * a registered origin: lib/auth/authLink.ts).
 */
export function parseInviteLink(raw: string | null | undefined, dev: boolean = isDevBuild()): string | null {
  return parseInviteArrival(raw, dev)?.code ?? null;
}
