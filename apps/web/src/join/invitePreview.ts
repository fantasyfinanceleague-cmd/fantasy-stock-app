import { cleanDisplay } from './displayText';
import { coerceBlock, type JoinBlock } from './joinCopy';
import { INVITE_PREVIEW_URL, PUBLISHABLE_KEY } from './config';

/**
 * Onboarding W3's no-session preview, `invite-preview`: POST {code} ->
 *   200 {found:true, name, inviter: string|null, reason: null|league_full|draft_started|season_completed}
 *   200 {found:false}                 (unknown, malformed, expired or missing: all the same)
 *   429 {error:'rate_limited'} / 500 {error:'unavailable'}
 * League NAME + INVITER only; counts, dates and stakes come after sign-in.
 *
 * It may be undeployed (Giorgio can veto it), so EVERY failure (network, a
 * non-200, 429, an unparseable or oddly-shaped body, a timeout) is `unknown`
 * and the page says "You're invited to a league". It is never an error page,
 * and no server text is ever shown.
 */
export type InvitePreview =
  | { kind: 'found'; name: string; inviter: string | null; block: JoinBlock | null }
  | { kind: 'not_found' }
  | { kind: 'unknown' };

const UNKNOWN: InvitePreview = { kind: 'unknown' };

/** Status + body to a preview; anything unexpected is `unknown`. */
export function parseInvitePreview(status: number, body: unknown): InvitePreview {
  if (status !== 200 || body === null || typeof body !== 'object' || Array.isArray(body)) return UNKNOWN;
  const b = body as Record<string, unknown>;
  if (b.found === false) return { kind: 'not_found' };
  if (b.found !== true) return UNKNOWN;
  const name = cleanDisplay(b.name);
  if (!name) return UNKNOWN;
  const reason = b.reason;
  return {
    kind: 'found',
    name,
    inviter: cleanDisplay(b.inviter),
    // An unknown reason from a newer server is a refusal we have no line for, never "joinable".
    block: reason === null || reason === undefined ? null : coerceBlock(reason),
  };
}

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  url?: string | null;
  key?: string | null;
}

/** Never throws. The code travels in the POST body, never in a URL. */
export async function fetchInvitePreview(code: string, opts: FetchOptions = {}): Promise<InvitePreview> {
  const url = opts.url === undefined ? INVITE_PREVIEW_URL : opts.url;
  if (!url) return UNKNOWN;
  const key = opts.key === undefined ? PUBLISHABLE_KEY : opts.key;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), opts.timeoutMs ?? 5000);
  const onAbort = () => timeout.abort();
  opts.signal?.addEventListener('abort', onAbort);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { apikey: key } : {}) },
      body: JSON.stringify({ code }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: timeout.signal,
    });
    const body = await res.json().catch(() => null);
    return parseInvitePreview(res.status, body);
  } catch {
    return UNKNOWN;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
