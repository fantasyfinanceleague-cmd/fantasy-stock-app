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
    return results.every((r: any) => r.data !== false);   // any false = over limit
  } catch {
    return true;   // FAIL-OPEN: a limiter error must not block legitimate users
  }
}

Deno.serve(async (req: Request) => {
  requestOrigin = req.headers.get('Origin') || '';
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(requestOrigin) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const PUBLISHABLE_KEY = Deno.env.get('SB_PUBLISHABLE_KEY')!;
  const SECRET_KEY = Deno.env.get('SB_SECRET_KEY_INTERNAL')!;

  // Authed client -> resolve caller identity from the JWT.
  const authed = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  // Admin client (secret key) -> RLS-bypassing by-code lookup.
  const admin = createClient(SUPABASE_URL, SECRET_KEY);

  try {
    const { data: auth } = await authed.auth.getUser();
    const user = auth?.user;
    if (!user) return json({ error: 'not_authenticated', message: 'Please sign in to view this league.' }, 401);

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    if (!(await rateLimitOk(admin, 'preview-league', user.id, ip))) {
      return json({ error: 'rate_limited', message: 'Too many attempts. Please wait a minute.' }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!code) return json({ error: 'bad_request', message: 'code required' }, 400);

    // Resolve code: leagues.invite_code FIRST, else league_invites.code.
    let { data: league } = await admin.from('leagues').select('*').eq('invite_code', code).maybeSingle();
    let invite: any = null;
    if (!league) {
      const { data: inv } = await admin.from('league_invites').select('*').eq('code', code).maybeSingle();
      if (inv) {
        invite = inv;
        const { data: lg } = await admin.from('leagues').select('*').eq('id', inv.league_id).maybeSingle();
        league = lg;
      }
    }
    if (!league) return json({ found: false, reason: 'invalid_code' }, 200);

    // Commissioner display name only (username) — never commissioner_id.
    const { data: commish } = await admin
      .from('user_profiles').select('username').eq('user_id', league.commissioner_id).maybeSingle();

    // Current member count.
    const { count: memberCount } = await admin
      .from('league_members').select('*', { count: 'exact', head: true }).eq('league_id', league.id);

    // Already a member?
    const { data: existing } = await admin
      .from('league_members').select('user_id').eq('league_id', league.id).eq('user_id', user.id).maybeSingle();

    // joinable + reason. Draft-started is SOFT (not a block) — the UI warns via draft_status.
    const current = memberCount ?? 0;
    let reason: string | null = null;
    if (existing) reason = 'already_member';
    else if (league.season_status === 'completed') reason = 'season_completed';
    else if (invite && (invite.status !== 'pending'
             || (invite.expires_at && new Date(invite.expires_at) < new Date()))) reason = 'invite_expired';
    else if (current >= league.num_participants) reason = 'league_full';

    // Return ONLY the displayed fields — no id / commissioner_id / invite_code.
    return json({
      found: true,
      joinable: reason === null,
      reason,
      league: {
        name: league.name,
        commissioner_name: commish?.username ?? 'Unknown',
        league_type: league.league_type,
        num_participants: league.num_participants,
        current_members: current,
        budget_mode: league.budget_mode,
        budget_amount: league.budget_amount,
        duration_days: league.duration_days,
        num_weeks: league.num_weeks,
        draft_date: league.draft_date,
        draft_status: league.draft_status,
      },
    }, 200);
  } catch (_e) {
    return json({ error: 'unhandled', message: 'Something went wrong. Please try again.' }, 500);
  }
});
