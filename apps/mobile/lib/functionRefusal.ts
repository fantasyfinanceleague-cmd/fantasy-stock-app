/**
 * readFunctionRefusal: what an edge-function call actually said, read the same
 * way everywhere (shared by the game screens and 3e's money screens, so the
 * two can't diverge; lifted from 3e's recordTradeOutcome on ui/mobile-money).
 * Pure and dependency-free (no supabase import), so tests-deno sees it.
 *
 * supabase-js `functions.invoke` resolves { data, error } (CLAUDE.md
 * success-signal #5):
 * - a 2xx: `data` is the body, a game-flow refusal is `{ ok: false, reason }`;
 * - a non-2xx: `error` is a FunctionsHttpError whose `context` is the Response,
 *   so the body is NOT lost: `await error.context.json()` gives `{ reason, … }`
 *   (rate_limited 429, not_a_member 403, calendar_unavailable 503 …);
 * - a network failure (FunctionsFetchError / FunctionsRelayError, no Response),
 *   or a non-JSON body, or a body with no reason, is TRANSPORT: the call's
 *   outcome is unknown, never "refused" and never "ok".
 *
 * The result keeps the HTTP status (null on a 2xx: supabase-js doesn't expose
 * it there) so a caller can apply its own rule, e.g. "a 5xx may have written".
 */
export type FunctionRefusal =
  | { transport: true }
  | {
    transport: false;
    /** The HTTP status of a non-2xx; null for a 2xx. */
    status: number | null;
    /** The server's reason; null when the call succeeded (2xx, not ok:false). */
    reason: string | null;
    body: Record<string, unknown>;
  };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export async function readFunctionRefusal(data: unknown, error: unknown): Promise<FunctionRefusal> {
  if (!error) {
    const body = asRecord(data) ?? {};
    if (body.ok === false) {
      return { transport: false, status: null, reason: typeof body.reason === 'string' ? body.reason : 'unhandled', body };
    }
    return { transport: false, status: null, reason: null, body };
  }
  const ctx = asRecord(asRecord(error)?.context) as { status?: unknown; json?: unknown } | null;
  if (!ctx || typeof ctx.json !== 'function') return { transport: true };
  let parsed: unknown = null;
  try {
    parsed = await (ctx.json as () => Promise<unknown>)();
  } catch {
    return { transport: true }; // a non-JSON body (a gateway page, an empty 502)
  }
  const body = asRecord(parsed);
  if (!body || typeof body.reason !== 'string') return { transport: true };
  return { transport: false, status: typeof ctx.status === 'number' ? ctx.status : null, reason: body.reason, body };
}

/** The call succeeded: a 2xx that isn't a refusal. */
export function functionOk(r: FunctionRefusal): r is Extract<FunctionRefusal, { transport: false }> & { reason: null } {
  return !r.transport && r.reason === null;
}
