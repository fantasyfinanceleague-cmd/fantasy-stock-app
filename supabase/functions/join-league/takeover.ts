/**
 * Pure logic for join-league's `takeover` action (docs/plans/2026-10-21-account-deletion.md,
 * §Takeover): request parsing, the client response, and the commissioner's push copy.
 * No DB, no Deno APIs, so it is hermetically tested in takeover.test.ts.
 *
 * take_over_team (W2, SECURITY DEFINER, service_role only) owns every rule: the code,
 * the seat lock, the window, "not already a member". This file only shapes inputs and
 * outputs around it. The user id is the VERIFIED JWT's, never the body's.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * A takeover code is EXACTLY ten of A-Z0-9 (W2's contract; it is matched exactly, so a
 * lowercase code is invalid_code). Checked at the edge so a malformed guess never reaches
 * the database, answered the SAME way the SQL answers a wrong code, so nothing is learned
 * from the difference. The limiter has already counted the attempt by then.
 */
export const TAKEOVER_CODE_RE = /^[A-Z0-9]{10}$/;
const MAX_CODE = 64;
/** league_name is user-authored text returned to a signed-in stranger: bounded. Clients render it as text. */
const LEAGUE_NAME_MAX = 120;

export interface TakeoverRequest {
  code: string;
}

/** The body is a takeover only when it says so; the legacy join body has no `action`. */
export function isTakeover(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as Record<string, unknown>).action === 'takeover';
}

/**
 * Strict: a malformed takeover body is a 400, never a guessed default. The body carries
 * ONLY the code: take_over_team derives the league from it, so a league id from the client
 * is never read (a stale or forged one cannot steer the lookup).
 */
export function parseTakeoverRequest(body: unknown): TakeoverRequest | null {
  if (!isTakeover(body)) return null;
  const code = typeof (body as Record<string, unknown>).code === 'string' ? String((body as Record<string, unknown>).code).trim() : '';
  if (!code || code.length > MAX_CODE) return null;
  return { code };
}

/** The reply for a code that cannot match (the same body the SQL returns), without a lookup. */
export const MALFORMED_CODE_REFUSAL = { ok: false, reason: 'invalid_code' } as const;

// deno-lint-ignore no-explicit-any
type RpcResult = Record<string, any>;

/** A uuid string from the database, else null (never an arbitrary value to the client or a push). */
export function uuidOrNull(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}

/** Reasons take_over_team may refuse with; anything else is not forwarded. */
export const TAKEOVER_REASONS = [
  'gone', 'taken', 'invalid_code', 'not_deleted', 'window', 'already_member', 'not_eligible', 'rate_limited',
] as const;

/**
 * The HTTP status for a takeover/preview answer: 429 for the SQL's own 'rate_limited' (its global
 * miss ceiling / per-user lockout, which the edge limiter cannot enforce), 200 for every other
 * game-flow refusal and for success (leave-league / draft-control's convention).
 */
export function statusFor(body: Record<string, unknown>): number {
  return body.ok === false && body.reason === 'rate_limited' ? 429 : 200;
}

/**
 * What the CLIENT sees. Only the outcome and the league the caller just joined: the
 * notice id, the commissioner's id and the seat's names are for the push and never
 * leave the server.
 */
export function clientResponse(r: RpcResult): Record<string, unknown> {
  if (r?.status === 'taken_over') {
    return {
      ok: true,
      status: 'taken_over',
      // The league comes from the code, so its id can only come from the database.
      league: {
        id: uuidOrNull(r.league_id),
        name: typeof r.league_name === 'string' ? r.league_name.slice(0, LEAGUE_NAME_MAX) : null,
      },
    };
  }
  if (r?.status === 'refused' && (TAKEOVER_REASONS as readonly string[]).includes(r.reason)) {
    return { ok: false, reason: String(r.reason) };
  }
  return { ok: false, reason: 'unhandled' };
}

export interface TakeoverPushInput {
  leagueId: string | null;
  leagueName: string | null;
  newName: string | null;
  /** deleted_manager_label(), read from the database so the board's pick lives in one place. */
  placeholder: string | null;
}

/**
 * The push to the commissioner. COPY IS PROVISIONAL for the Design Lead (plan:
 * "{Name} took over {placeholder}'s team."). The placeholder comes from
 * deleted_manager_label(), never a literal; without it the copy says "an open team"
 * rather than guess a label the board may change.
 */
export function takeoverMessage(i: TakeoverPushInput) {
  // Bounded: both are user-authored text that ends up in a push title and body.
  const league = (i.leagueName?.trim() || 'your league').slice(0, LEAGUE_NAME_MAX);
  const who = (i.newName?.trim() || 'A new manager').slice(0, LEAGUE_NAME_MAX);
  const seat = i.placeholder?.trim() ? `${i.placeholder.trim()}'s team` : 'an open team';
  return {
    title: league,
    body: `${who} took over ${seat}.`,
    data: { type: 'seat_taken_over', league_id: i.leagueId },
  };
}

// ---- takeover_preview: the read before the take -----------------------------------

/** `takeover_preview` carries only the code: the link the person opened names the seat. */
export function isTakeoverPreview(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as Record<string, unknown>).action === 'takeover_preview';
}

export function parseTakeoverPreviewRequest(body: unknown): { code: string } | null {
  if (!isTakeoverPreview(body)) return null;
  const code = typeof (body as Record<string, unknown>).code === 'string' ? String((body as Record<string, unknown>).code).trim() : '';
  return code && code.length <= MAX_CODE ? { code } : null;
}

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/**
 * What the CLIENT sees for a preview: the league name and the seat's record, nothing
 * else (no league id, no seat holder, no uuid). takeover_preview (W2) owns every
 * rule and answers with the SAME reasons as take_over_team; its exact envelope is not
 * assumed: success is `status:'ok'` or `ok:true` WITH a league name, a refusal is
 * `status:'refused'` or `ok:false` with a whitelisted reason. Anything else, including
 * an "ok" with no league name, is unhandled, never a fabricated preview.
 */
export function previewResponse(r: RpcResult): Record<string, unknown> {
  const okShape = r?.status === 'ok' || r?.ok === true;
  const refusedShape = r?.status === 'refused' || r?.ok === false;
  if (okShape && typeof r.league_name === 'string' && r.league_name) {
    return {
      ok: true,
      league_name: r.league_name.slice(0, LEAGUE_NAME_MAX),
      wins: count(r.wins),
      losses: count(r.losses),
      rank: count(r.rank),
    };
  }
  if (refusedShape && (TAKEOVER_REASONS as readonly string[]).includes(r.reason)) {
    return { ok: false, reason: String(r.reason) };
  }
  return { ok: false, reason: 'unhandled' };
}
