// Onboarding W3 — what the NO-SESSION invite-preview edge function returns, as the app reads it.
//
// supabase/functions/invite-preview answers a person who has no session yet (the signed-out arrival
// screen, the "Check your email" screen, the web /join page) with ONLY the league's name and the
// commissioner's username:
//
//   200 { found: true,  name, inviter: string | null, reason: null | 'league_full' | 'draft_started' | 'season_completed' }
//   200 { found: false }                                  every unknown / malformed / expired code, one shape
//   429 / 5xx / network / not deployed                    -> 'unavailable'
//
// The reader is strict: anything that is not exactly one of those is 'unavailable', never a half-built
// preview. No server TEXT is shown (house rule): only the two data fields, sanitised and capped.
//
// Pure (no React Native imports) so tests-deno can exercise it hermetically.

export type InviteReason = 'league_full' | 'draft_started' | 'season_completed';

export type InvitePreview =
  | { kind: 'found'; name: string; inviter: string | null; reason: InviteReason | null }
  | { kind: 'not_found' }
  | { kind: 'unavailable' };

/** Control characters and line/paragraph separators become spaces (a char-code loop: no regex class to mis-encode). */
function stripControls(v: string): string {
  let out = '';
  for (const ch of v) {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 32 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 ? ' ' : ch;
  }
  return out;
}

/** A name from the server, made safe to draw: control characters out, trimmed, capped. Null when nothing is left. */
export function cleanName(v: unknown, max = 60): string | null {
  if (typeof v !== 'string') return null;
  const s = stripControls(v).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}

/** A reason this app doesn't know (a newer server) is 'bad': the preview is then 'unavailable', not guessed at. */
function coerceReason(v: unknown): InviteReason | null | 'bad' {
  if (v === null || v === undefined) return null;
  if (v === 'league_full' || v === 'draft_started' || v === 'season_completed') return v;
  return 'bad';
}

export function interpretInvitePreview(data: unknown, invokeError: unknown): InvitePreview {
  if (invokeError) return { kind: 'unavailable' };
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { kind: 'unavailable' };
  const d = data as Record<string, unknown>;
  if (d.found === false) return { kind: 'not_found' };
  if (d.found !== true) return { kind: 'unavailable' };
  const name = cleanName(d.name, 80);
  const reason = coerceReason(d.reason);
  if (!name || reason === 'bad') return { kind: 'unavailable' };
  return { kind: 'found', name, inviter: cleanName(d.inviter), reason };
}

/** Copy for the generic arrival line when the preview is unknown (the endpoint is down, undeployed or limited). */
export const GENERIC_INVITE_LINE = "You're invited to a league";

/** "{inviter} invited you to {league}" (decision 7), or the generic line when either name is missing. */
export function inviteHeadline(p: InvitePreview | { kind: 'idle' | 'loading' }): string {
  if (p.kind !== 'found') return GENERIC_INVITE_LINE;
  return p.inviter ? `${p.inviter} invited you to ${p.name}` : `You're invited to ${p.name}`;
}
