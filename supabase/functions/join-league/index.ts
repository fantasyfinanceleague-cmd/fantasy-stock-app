import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

    const body = await req.json().catch(() => ({}));
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
