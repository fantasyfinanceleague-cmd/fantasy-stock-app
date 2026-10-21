import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { clientIp } from '../invite-preview/respond.ts';
import { deliverNotice } from '../_shared/notice-delivery.ts';
import {
  clientResponse,
  isTakeover,
  isTakeoverPreview,
  MALFORMED_CODE_REFUSAL,
  parseTakeoverPreviewRequest,
  parseTakeoverRequest,
  previewResponse,
  statusFor,
  TAKEOVER_CODE_RE,
  takeoverMessage,
  uuidOrNull,
} from './takeover.ts';

// ---- CORS / response helpers (same pattern as place-order) -----------------
function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (origin.endsWith('.vercel.app') && origin.startsWith('https://')) return true;
  if (origin.startsWith('http://localhost:')) return true;
  return false;
}
function getCorsHeaders(origin: string) {
  const allowedOrigin = isAllowedOrigin(origin) ? origin : 'https://fantasy-stock-app.vercel.app';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
let requestOrigin = '';
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(requestOrigin) },
  });
}

// ---- Fail-open rate limit: per-user (10/min) + per-IP (30/min) --------------
async function rateLimitOk(admin: any, bucket: string, userId: string, ip: string): Promise<boolean> {
  try {
    const calls = [
      admin.rpc('check_and_bump_rate_limit', { p_bucket: bucket, p_subject: `user:${userId}`, p_limit: 10 }),
    ];
    if (ip) {
      calls.push(admin.rpc('check_and_bump_rate_limit', { p_bucket: bucket, p_subject: `ip:${ip}`, p_limit: 30 }));
    }
    const results = await Promise.all(calls);
    return results.every((r: any) => r.data !== false);
  } catch {
    return true;   // FAIL-OPEN
  }
}

/**
 * The takeover surface's OWN limiter (a code-guessing surface), on top of the shared one
 * above. Differences, each deliberate:
 *   - FAIL-CLOSED: the shared limiter fails open (an rpc error reads as allowed), which is
 *     right for joining by a code a person was handed, and wrong for guessing. An error
 *     here refuses ('unavailable'), it does not wave the request through.
 *   - The IP is the RIGHT-most forwarded hop (invite-preview's clientIp), not the left-most
 *     one the shared limiter reads, which is whatever the client chose to send. '' (no
 *     usable address) shares ONE strict bucket instead of skipping the check.
 *   - The user bucket is farmable with free accounts, so it is not the control: the code's
 *     entropy and the SQL's own miss accounting are (docs/testing/account-deletion-effect-test.md).
 */
async function takeoverLimit(admin: any, userId: string, ip: string): Promise<'ok' | 'limited' | 'unavailable'> {
  try {
    const results = await Promise.all([
      admin.rpc('check_and_bump_rate_limit', { p_bucket: 'join-league-takeover', p_subject: `user:${userId}`, p_limit: 10 }),
      admin.rpc('check_and_bump_rate_limit', { p_bucket: 'join-league-takeover', p_subject: `ip:${ip || 'unknown'}`, p_limit: 30 }),
    ]);
    if (results.some((r: any) => r.error || typeof r.data !== 'boolean')) return 'unavailable';
    return results.every((r: any) => r.data === true) ? 'ok' : 'limited';
  } catch {
    return 'unavailable';
  }
}

Deno.serve(async (req: Request) => {
  requestOrigin = req.headers.get('Origin') || '';
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(requestOrigin) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const PUBLISHABLE_KEY = Deno.env.get('SB_PUBLISHABLE_KEY')!;
  const SECRET_KEY = Deno.env.get('SB_SECRET_KEY_INTERNAL')!;

  // Authed client -> JWT-verified caller identity.
  const authed = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  // Admin client (secret key = service_role) -> the ONLY role allowed to call
  // join_league_by_code (EXECUTE revoked from public/authenticated/anon).
  const admin = createClient(SUPABASE_URL, SECRET_KEY);

  try {
    const { data: auth } = await authed.auth.getUser();
    const user = auth?.user;
    if (!user) return json({ error: 'not_authenticated', message: 'Please sign in to join a league.' }, 401);

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    if (!(await rateLimitOk(admin, 'join-league', user.id, ip))) {
      return json({ error: 'rate_limited', message: 'Too many attempts. Please wait a minute.' }, 429);
    }

    // `?? {}`: a literal JSON null body is a bad request, not a crash on `body.code` below.
    const body = (await req.json().catch(() => ({}))) ?? {};

    // BOTH takeover actions (a code-guessing surface) sit behind takeoverLimit, on top of
    // the shared limiter above: fail-closed, right-most forwarded hop. It runs BEFORE any
    // parsing or lookup, so no path reaches take_over_team / takeover_preview around it.
    if (isTakeoverPreview(body) || isTakeover(body)) {
      const limit = await takeoverLimit(admin, user.id, clientIp(req.headers));
      if (limit === 'limited') return json({ error: 'rate_limited', message: 'Too many attempts. Please wait a minute.' }, 429);
      if (limit === 'unavailable') return json({ error: 'unavailable', message: 'Please try again in a moment.' }, 503);
    }

    // TAKEOVER PREVIEW: the read before the take (the landing screen shows the league and
    // the seat's record). takeover_preview is service_role only; the user id is the
    // VERIFIED JWT's. A pure read: no push, no write.
    if (isTakeoverPreview(body)) {
      const t = parseTakeoverPreviewRequest(body);
      if (!t) return json({ error: 'bad_request', message: 'code required' }, 400);
      if (!TAKEOVER_CODE_RE.test(t.code)) return json(MALFORMED_CODE_REFUSAL, 200);
      const { data, error } = await admin.rpc('takeover_preview', { p_code: t.code, p_user_id: user.id });
      if (error) {
        console.error('takeover_preview failed', error.code ?? '');
        return json({ error: 'unhandled', message: 'Failed to look up the team. Please try again.' }, 500);
      }
      const shaped = previewResponse(data);
      return json(shaped, statusFor(shaped));
    }

    // TAKEOVER (account deletion, plan §Takeover): the seat of a deleted manager.
    // take_over_team owns every rule and is EXECUTE service_role only; we pass the
    // VERIFIED user id, never one from the body. The legacy join body (just `code`)
    // is untouched below.
    if (isTakeover(body)) {
      const t = parseTakeoverRequest(body);
      if (!t) return json({ error: 'bad_request', message: 'code required' }, 400);
      // A malformed code can never match: refuse it like the SQL refuses a wrong one,
      // without a lookup.
      if (!TAKEOVER_CODE_RE.test(t.code)) return json(MALFORMED_CODE_REFUSAL, 200);
      // supabase-js resolves .rpc() to { data, error } and does NOT throw on a
      // Postgres error (CLAUDE.md "success signals" #5): check it.
      const { data, error } = await admin.rpc('take_over_team', {
        p_code: t.code,
        p_user_id: user.id,
      });
      if (error) {
        console.error('take_over_team failed', error.code ?? '');
        return json({ error: 'unhandled', message: 'Failed to take over the team. Please try again.' }, 500);
      }
      // The push goes out AFTER the commit and never fails the action: the WHOLE block
      // is contained, copy building included, so an unexpected value from the database
      // can never turn a committed takeover into a 500.
      if (data?.status === 'taken_over' && data?.notice_id && data?.notify_user_id) {
        try {
          const str = (v: unknown) => (typeof v === 'string' ? v : null);
          // take_over_team returns the label it used (seat_label); otherwise read it from the database,
          // never a literal (the board's pick lives in one SQL function).
          let placeholder: string | null = str(data.seat_label);
          if (!placeholder) {
            try {
              const { data: label, error: labelErr } = await admin.rpc('deleted_manager_label');
              if (!labelErr && typeof label === 'string') placeholder = label;
            } catch { /* copy falls back to "an open team" */ }
          }
          const pushed = await deliverNotice(admin, 'seat_taken_over', String(data.notice_id), String(data.notify_user_id),
            takeoverMessage({
              leagueId: uuidOrNull(data.league_id),
              leagueName: str(data.league_name),
              newName: str(data.new_name),
              placeholder,
            }));
          console.log('seat_taken_over', JSON.stringify({ notice: data.notice_id, push_status: pushed }));
        } catch (e) {
          console.error('seat_taken_over push threw', e instanceof Error ? e.name : 'error');
        }
      }
      // 200 for game-flow refusals (leave-league / draft-control's convention).
      const shaped = clientResponse(data);
      return json(shaped, statusFor(shaped));
    }

    const code = String(body.code ?? '').trim().toUpperCase();
    if (!code) return json({ error: 'bad_request', message: 'code required' }, 400);

    // Entire join is atomic inside the RPC (row-locked capacity check,
    // re-validation, member insert, invite accept). We pass the VERIFIED user id.
    const { data, error } = await admin.rpc('join_league_by_code', { p_code: code, p_user_id: user.id });
    if (error) return json({ error: 'unhandled', message: 'Failed to join league. Please try again.' }, 500);

    // data: { ok:true, league:{id,name} } | { ok:false, reason, league? }
    return json(data, 200);
  } catch (_e) {
    return json({ error: 'unhandled', message: 'Something went wrong. Please try again.' }, 500);
  }
});
