// Account deletion (W4) — reading join-league's takeover replies, including the 429's TWO body shapes (W3, 2026-10-21):
//   {error:'rate_limited', message}        the EDGE limiter (a short window)   -> "Too many tries. Wait a moment, then try again."
//   {ok:false, reason:'rate_limited'}      the SQL lockout (an hour)           -> "Too many tries. Try again later."
//   anything else on a 429                                                      -> "Try again later" (never understate a lockout)
// readFunctionRefusal treats a non-2xx body with no `reason` as a TRANSPORT failure, which would turn the edge limiter's
// reply into "Couldn't reach the league…". So a 429 is read HERE first, from its body, and everything else goes through
// the shared reader unchanged. Pure (no React Native / supabase imports).

import { readFunctionRefusal, type FunctionRefusal } from '../functionRefusal';

/** How long to wait: a moment (the edge limiter) or later (the hour's lockout, or anything we can't tell). */
export type RateWait = 'moment' | 'later';

/** The reply's body decides: only the edge limiter's exact shape is "a moment". */
export function rateWaitOf(body: unknown): RateWait {
  const b = body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  return b && b.error === 'rate_limited' && b.reason === undefined && b.ok !== false ? 'moment' : 'later';
}

export type TakeoverReply = FunctionRefusal & { wait?: RateWait };

export async function readTakeoverReply(data: unknown, error: unknown): Promise<TakeoverReply> {
  const ctx = (error !== null && typeof error === 'object' ? (error as { context?: unknown }).context : null) as
    | { status?: unknown; json?: unknown }
    | null
    | undefined;
  if (ctx && ctx.status === 429 && typeof ctx.json === 'function') {
    let body: unknown = null;
    try {
      body = await (ctx.json as () => Promise<unknown>)();
    } catch {
      body = null; // a non-JSON 429 (a gateway page) is still a rate limit: wait longer
    }
    return { transport: false, status: 429, reason: 'rate_limited', body: (body && typeof body === 'object' ? body : {}) as Record<string, unknown>, wait: rateWaitOf(body) };
  }
  const r = await readFunctionRefusal(data, error);
  // A 2xx {ok:false, reason:'rate_limited'} is the SQL lockout: an hour.
  return !r.transport && r.reason === 'rate_limited' ? { ...r, wait: 'later' } : r;
}
