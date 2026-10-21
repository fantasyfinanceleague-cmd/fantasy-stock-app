// Account deletion (W4) — the takeover link: what "Find a new manager" shares, and the strict reader for what arrives.
//
//   https://<domain>/take/<CODE>       universal link (the web's "Get the app" page when the app is absent)
//   fantasystockapp://take/<CODE>      the scheme fallback (also fantasystockapp:///take/<CODE>)
//
// Its OWN path, not /join/ (Orchestrator, 2026-10-21): a takeover code gives a SEAT WITH ITS RECORD and an invite
// code gives a NEW SEAT, two different capabilities, and they must not share a parser path. Everything else is
// inviteLink.ts's discipline, reused (the same exact-prefix origin match, the same ASCII-first code shape): the code
// is read from the PATH only (never a query or fragment), anything off-shape is refused rather than repaired, and a
// look-alike host or a userinfo '@' trick never parses.
//
// ORIGIN does not gate anything here (unlike an invite's zero-tap auto-join): a takeover always waits for the
// person's tap on "Take the team", whichever link brought it.
//
// Pure (no React Native imports) so tests-deno can exercise it hermetically.

import { isDevBuild } from '../auth/authLink';
import { WEB_BASE } from '../links/webDomain';
import { takeoverShareSentence } from '../account/deleteCopy';
import { asciiLower, normalizeInviteCode, relativeToBase, type InviteOrigin } from './inviteLink';

export const TAKEOVER_PATH = 'take';

/** The link "Find a new manager" shares. Null when the code can't be a link. */
export function buildTakeoverUrl(code: string): string | null {
  const ok = normalizeInviteCode(code);
  return ok ? `${WEB_BASE}${TAKEOVER_PATH}/${ok}` : null;
}

/** What Share sends: "Take over a team in {league}" (approved verbatim), then the link on its own line. Null when there is no valid link. */
export function takeoverShareMessage(leagueName: string, code: string): string | null {
  const url = buildTakeoverUrl(code);
  return url ? `${takeoverShareSentence(leagueName)}\n${url}` : null;
}

export interface TakeoverArrival {
  code: string;
  origin: InviteOrigin;
}

/** The takeover in a system link, with its origin, or null for anything that is not exactly a takeover link. */
export function parseTakeoverArrival(raw: string | null | undefined, dev: boolean = isDevBuild()): TakeoverArrival | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  const rel = relativeToBase(url, dev);
  if (rel === null) return null;
  const origin: InviteOrigin = asciiLower(url).startsWith(asciiLower(WEB_BASE)) ? 'https' : 'scheme';
  const parts = rel.replace(/\/+$/, '').split('/');
  if (parts.length !== 2 || parts[0] !== TAKEOVER_PATH) return null;
  const code = normalizeInviteCode(parts[1]);
  return code ? { code, origin } : null;
}

export function parseTakeoverLink(raw: string | null | undefined, dev: boolean = isDevBuild()): string | null {
  return parseTakeoverArrival(raw, dev)?.code ?? null;
}
