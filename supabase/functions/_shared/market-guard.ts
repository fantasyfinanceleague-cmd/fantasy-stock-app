/**
 * Caller guard for the market-data functions (quote, historical-bars,
 * ticker-quotes). Giorgio, 2026-10-08: "I don't want people to be able to
 * scrape anything." These functions spend the shared server-side Alpaca key,
 * so an unguarded one is a free, anonymous price proxy.
 *
 * WHY verify_jwt IS NOT ENOUGH: the gateway's verify_jwt accepts any JWT signed
 * by the project's legacy secret, and the PUBLIC anon key is one (config.toml,
 * "The anon key satisfies this"). Only auth.getUser() proves a real user.
 *
 * FAIL CLOSED: preview-league's limiter admits a call unless the RPC returns an
 * explicit `false`, so a limiter outage (or a resolved `{ error }`, which
 * supabase-js never throws -- CLAUDE.md success signals #5) lets everything
 * through. Here ONLY an explicit `true` admits; an error, a null, or a throw is
 * 'unavailable' and the caller gets a 503, not the data.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

export type LimitVerdict = 'ok' | 'limited' | 'unavailable';

/** One limiter result -> verdict. Only `data === true` admits. */
export function readLimitResult(r: { data?: unknown; error?: unknown } | null | undefined): LimitVerdict {
  if (!r || r.error) return 'unavailable';
  if (r.data === true) return 'ok';
  if (r.data === false) return 'limited';
  return 'unavailable';
}

/** Worst verdict wins: any unavailable -> unavailable; else any limited -> limited. */
export function combineVerdicts(verdicts: LimitVerdict[]): LimitVerdict {
  if (verdicts.length === 0 || verdicts.includes('unavailable')) return 'unavailable';
  if (verdicts.includes('limited')) return 'limited';
  return 'ok';
}

export interface LimitSubject { subject: string; limit: number }

/** Bumps every subject's counter in `bucket` (60 s fixed window) via the
 * service-role-only check_and_bump_rate_limit. Never throws. */
export async function checkRateLimits(
  // deno-lint-ignore no-explicit-any
  admin: any,
  bucket: string,
  subjects: LimitSubject[],
): Promise<LimitVerdict> {
  try {
    const results = await Promise.all(subjects.map((s) =>
      admin.rpc('check_and_bump_rate_limit', { p_bucket: bucket, p_subject: s.subject, p_limit: s.limit })
    ));
    return combineVerdicts(results.map(readLimitResult));
  } catch {
    return 'unavailable';
  }
}

/** The real signed-in user behind `authorization`, or null (no header, the
 * bare anon JWT, a publishable key, an expired token, or GoTrue unreachable). */
export async function resolveUser(
  url: string,
  publishableKey: string,
  authorization: string | null,
): Promise<{ id: string } | null> {
  if (!authorization) return null;
  const authed = createClient(url, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data, error } = await authed.auth.getUser();
    if (error || !data?.user?.id) return null;
    return { id: data.user.id };
  } catch {
    return null;
  }
}

/** First hop of x-forwarded-for (the client, as preview-league reads it). */
export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
}

/** The guard's refusal bodies. No vendor text, no internals. */
export const REFUSAL = {
  not_authenticated: { status: 401, body: { error: 'not_authenticated', message: 'Please sign in.' } },
  rate_limited: { status: 429, body: { error: 'rate_limited', message: 'Too many requests. Please wait a minute.' } },
  rate_limit_unavailable: {
    status: 503,
    body: { error: 'rate_limit_unavailable', message: 'Temporarily unavailable. Please try again.' },
  },
} as const;

export function refusalFor(v: Exclude<LimitVerdict, 'ok'>) {
  return v === 'limited' ? REFUSAL.rate_limited : REFUSAL.rate_limit_unavailable;
}

/** Normalise (trim, uppercase), drop empties, dedupe in order, cap at `max`.
 * Overflow is REPORTED, never silently dropped (the historical-bars rule). */
export function capSymbolList(raw: unknown[], max: number): { symbols: string[]; truncated: string[] } {
  const seen = new Set<string>();
  const all: string[] = [];
  for (const s of raw) {
    const v = String(s ?? '').trim().toUpperCase();
    if (v && !seen.has(v)) { seen.add(v); all.push(v); }
  }
  return { symbols: all.slice(0, max), truncated: all.slice(max) };
}
