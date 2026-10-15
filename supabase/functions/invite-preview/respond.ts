// Pure half of invite-preview, extracted out of index.ts so every rule is hermetically testable (no DB, no
// Deno.serve). See supabase/migrations/20261124000000_invite_preview.sql for the other half (the lookup and
// the limiter, in one SQL call).
//
// THE CONTRACT (the web page W5 and the apps depend on it; do not widen it without the Planner):
//   200 { found: true, name, inviter: string | null, reason: null | 'league_full' | 'draft_started' | 'season_completed' }
//   200 { found: false }                      EVERY unknown / malformed / expired / revoked code, byte-identical
//   429 { error: 'rate_limited' }             per-IP requests, per-IP misses (10/hour), the global miss ceiling and request
//                                             ceiling, CONTENTION (the database's try-lock was busy; retried once first), OR
//                                             the limiter's Vault salt missing (it fails closed). A shared network (campus,
//                                             office NAT) can reach the per-IP miss limit after a few typos, so the web
//                                             and the apps MUST treat 429, like any non-200 or network error, as "preview
//                                             unknown" and show "You're invited to a league", never an error page.
//   405 { error: 'method_not_allowed' } · 500 { error: 'unavailable' }
// Nothing else leaves: no counts, dates, stakes, ids, invite codes or member names. The raw facts the SQL
// returns (season/draft status, draft date, member count) are used HERE to compute `reason` and are dropped.

import { WEB_ORIGIN } from '../_shared/web-origin.ts';
import { previewJoinReason } from '../preview-league/reason.ts';

/** Every response (found, refusal, rate-limited) takes at least this long, so timing does not tell a hit from a miss. */
export const RESPONSE_FLOOR_MS = 400;

/**
 * trim + ASCII shape + upper-case, or null. The shape is checked BEFORE folding case: toUpperCase() maps some
 * non-ASCII letters onto ASCII ones (dotless 'ı' -> 'I'), which must not turn into a valid-looking code. A null
 * still goes to the SQL, which counts it as a miss.
 */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  return /^[A-Za-z0-9]{4,12}$/.test(code) ? code.toUpperCase() : null;
}

function parseV4(s: string): number[] | null {
  const m = s.match(/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
}

/** Eight 16-bit groups, or null when `s` is not a well-formed IPv6 address (an embedded IPv4 tail is allowed). */
function parseV6(s: string): number[] | null {
  if (!/^[0-9a-fA-F:.]+$/.test(s)) return null;
  let work = s;
  const tail = work.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (tail) {
    const v4 = parseV4(tail[1]);
    if (!v4) return null;
    work = work.slice(0, -tail[1].length) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = work.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if ([...head, ...rest].some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  if (halves.length === 1) return head.length === 8 ? head.map((g) => parseInt(g, 16)) : null;
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return null; // '::' stands for at least one group
  return [...head.map((g) => parseInt(g, 16)), ...Array<number>(fill).fill(0), ...rest.map((g) => parseInt(g, 16))];
}

/**
 * The limiter's key for a raw address, or '' when it is not an address. IPv4: as is (a ":port" is stripped).
 * IPv4-mapped IPv6 (::ffff:a.b.c.d): the IPv4 address. IPv6: the /64 prefix (a client owns a whole /64, so a
 * per-address bucket would hand it 2^64 fresh buckets), written canonically. A "[v6]:port" is unwrapped, a zone id dropped.
 */
export function normalizeIp(raw: string): string {
  let s = raw.trim();
  const bracket = s.match(/^\[([^\]]+)\](?::\d{1,5})?$/);
  if (bracket) s = bracket[1];
  else if (/^[0-9.]+:\d{1,5}$/.test(s)) s = s.slice(0, s.lastIndexOf(':'));
  s = s.split('%')[0];
  const v4 = parseV4(s);
  if (v4) return v4.join('.');
  const g = parseV6(s);
  if (!g) return '';
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

/**
 * The caller's address, for the limiter. `cf-connecting-ip` is set by Cloudflare in front of the Supabase edge
 * and replaces any client-sent value; otherwise the RIGHT-most x-forwarded-for hop (the one the nearest proxy
 * appended; the left-most is whatever the client chose to send, which is what the other functions read).
 * Each is normalised (normalizeIp); anything that is not an address is ignored. '' when nothing usable: every
 * such caller then shares one bucket, which is the strict direction. Which header Supabase really sets is
 * confirmed after deploy (docs/security/invite-preview-effect-test.sql PART 3); the global miss ceiling bounds the
 * damage if it is wrong.
 */
export function clientIp(headers: Headers): string {
  const cf = normalizeIp(headers.get('cf-connecting-ip') ?? '');
  if (cf) return cf;
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  return hops.length ? normalizeIp(hops[hops.length - 1]) : '';
}

const LOCALHOST = /^http:\/\/localhost:\d{2,5}$/;

/** The web origin, plus localhost for dev. NOT any *.vercel.app (unlike the session functions): one config value. */
export function corsHeaders(origin: string): Record<string, string> {
  const allowed = origin === WEB_ORIGIN || LOCALHOST.test(origin) ? origin : WEB_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export interface Shaped {
  status: number;
  body: Record<string, unknown>;
  /**
   * Which limit tripped (a 429 only): for the function LOG, never the response. The body of every 429 is the same
   * bytes whatever the cause, so a caller learns nothing about which ceiling it hit.
   */
  limit?: LimitKey;
}

export const LIMIT_KEYS = ['ip', 'miss-ip', 'miss-all', 'req-all', 'contention', 'salt'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** The longest inviter returned. A username is 3-20 characters, so anything longer is junk and reads as no name. */
export const INVITER_MAX = 40;

const UNAVAILABLE: Shaped = { status: 500, body: { error: 'unavailable' } };
const NOT_FOUND: Shaped = { status: 200, body: { found: false } };

function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** invite_preview_lookup's jsonb -> the public response. Anything unexpected is a 500, never a half-built 200. */
export function toResponse(rpc: unknown, now: Date = new Date()): Shaped {
  const r = rec(rpc);
  if (!r) return UNAVAILABLE;
  if (r.status === 'rate_limited') {
    const limit = (LIMIT_KEYS as readonly unknown[]).includes(r.limit) ? (r.limit as LimitKey) : undefined;
    return { status: 429, body: { error: 'rate_limited' }, limit };
  }
  if (r.status === 'not_found') return NOT_FOUND;
  if (r.status !== 'found') return UNAVAILABLE;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  const members = Number(r.current_members);
  const max = Number(r.num_participants);
  if (!name || typeof r.season_status !== 'string' || typeof r.draft_status !== 'string' || !Number.isFinite(members) || !Number.isFinite(max)) {
    return UNAVAILABLE;
  }
  const rawInviter = typeof r.inviter === 'string' ? r.inviter.trim() : '';
  const inviter = rawInviter && rawInviter.length <= INVITER_MAX ? rawInviter : null; // text only; clients escape too
  // The reason is NOT re-implemented: preview-league's own pure function (which holds the T-1h rule via
  // _shared/draft-start-policy) over the same facts. A stranger is never "already a member" and an invite
  // that is expired or revoked never reaches here (the SQL counts it as a miss).
  const { reason } = previewJoinReason(
    {
      isExistingMember: false,
      seasonStatus: r.season_status,
      draftStatus: r.draft_status,
      draftDate: typeof r.draft_date === 'string' ? r.draft_date : null,
      invite: null,
      currentMembers: members,
      numParticipants: max,
    },
    now,
  );
  return { status: 200, body: { found: true, name, inviter, reason } };
}
