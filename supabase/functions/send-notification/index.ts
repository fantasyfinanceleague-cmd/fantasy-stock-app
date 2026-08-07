import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * send-notification — server-side push dispatch (scan findings F7 + F8, spec L2).
 *
 * WHY THIS EXISTS. An Expo push token is a BEARER CAPABILITY, not an identifier:
 * https://exp.host/--/api/v2/push/send accepts `{ to: <token>, title, body, data }`
 * with NO Authorization header and no secret of any kind. Possession alone delivers
 * an arbitrary titled / bodied / deep-linked push to that device.
 *
 * Before this function, the app sent notifications CLIENT-TO-CLIENT: user A's
 * device read user B's token out of user_profiles and POSTed to Expo directly. That
 * required every authenticated user to be able to read every other user's token,
 * which is exactly what F7/F8 flag. Two independent problems followed:
 *
 *   F7 — NO AUTHORIZATION OF ANY KIND. Any user could push to any other user,
 *        leaguemate or not, because the only thing needed was a token.
 *   F8 — THE TOKEN WAS BROADCAST. user_profiles' SELECT is `TO authenticated
 *        USING (true)` AND the table is in the supabase_realtime publication, so
 *        tokens leaked over both PostgREST and Realtime.
 *
 * This function closes F7. It is the PREREQUISITE for closing F8: once no client
 * needs to read a token, the column can physically leave user_profiles (a column
 * REVOKE is insufficient — Realtime authorizes by RLS and is blind to column
 * grants, so while the column sits on a published table it keeps broadcasting).
 * See docs/migrations/STAGED_L2_push_token_capability.sql.
 *
 * TWO THINGS ARE AUTHORIZED HERE, and the second is the one that is easy to miss:
 *
 *   1. THE TARGET — caller and target must share a league. Prevents pushing to
 *      strangers.
 *   2. THE CONTENT — title/body/data are derived SERVER-SIDE from a closed
 *      NOTIFICATION_TYPES map. The client sends a `type` and ids, never strings.
 *      Authorizing only the target would still let any user send arbitrary
 *      phishing text ("Your account needs re-verification") to a real leaguemate,
 *      which is the actual primitive the finding is about. Note the OLD client
 *      passed `leagueName` as a caller-supplied string that went straight into the
 *      body; the league name is now looked up from league_id instead.
 */

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

/**
 * THE CLOSED SET. Adding a notification means adding an entry HERE, server-side —
 * that is the point. `build` receives only server-verified values.
 *
 * Inventory as of 2026-07-30 (grep of every notify* caller in the repo):
 *   draft_turn      — LIVE. Sole notification the app actually sends today
 *                     (apps/mobile/app/(tabs)/draft.tsx -> notifyDraftTurn).
 *   matchup_result  — DESIGNED, NOT BUILT. Named in the notification_log schema
 *                     comment (migration 20260122000000) but never implemented.
 *   league_invite   — DESIGNED, NOT BUILT. Same.
 * The latter two are defined here so the shape is settled, but nothing calls them
 * yet; they are inert until a caller exists.
 */
const NOTIFICATION_TYPES: Record<
  string,
  { build: (ctx: { leagueName: string }) => { title: string; body: string; data: Record<string, unknown> } }
> = {
  draft_turn: {
    // Reproduces the pre-existing copy verbatim so the cutover is invisible to users.
    build: ({ leagueName }) => ({
      title: "It's Your Turn! 🏈",
      body: `Time to make your pick in ${leagueName}`,
      data: { type: 'draft_turn', screen: 'draft' },
    }),
  },
  matchup_result: {
    build: ({ leagueName }) => ({
      title: 'Matchup Results Are In',
      body: `See how you did this week in ${leagueName}`,
      data: { type: 'matchup_result', screen: 'matchup' },
    }),
  },
  league_invite: {
    build: ({ leagueName }) => ({
      title: 'League Invite',
      body: `You've been invited to join ${leagueName}`,
      data: { type: 'league_invite', screen: 'leagues' },
    }),
  },
};

// Fail-open rate limit, same shape as preview-league / join-league.
async function rateLimitOk(admin: any, userId: string, ip: string): Promise<boolean> {
  try {
    const calls = [
      admin.rpc('check_and_bump_rate_limit', { p_bucket: 'send-notification', p_subject: `user:${userId}`, p_limit: 30 }),
    ];
    if (ip) {
      calls.push(admin.rpc('check_and_bump_rate_limit', { p_bucket: 'send-notification', p_subject: `ip:${ip}`, p_limit: 60 }));
    }
    const results = await Promise.all(calls);
    return results.every((r: any) => r.data !== false);
  } catch {
    return true; // FAIL-OPEN: a limiter outage must not silence notifications
  }
}

/**
 * Read the target's push token.
 *
 * Prefers the owner-scoped push_tokens table and falls back to the legacy
 * user_profiles column, so THIS FUNCTION WORKS BOTH BEFORE AND AFTER the phase-2
 * relocation migration. That is deliberate: phase 1 (this function + the client
 * cutover) must ship and be verified BEFORE the column moves, or the app loses
 * notifications in the gap. Delete the fallback once the migration has landed.
 */
async function getTargetToken(
  admin: any,
  targetUserId: string,
): Promise<{ token: string | null; enabled: boolean }> {
  const { data: row } = await admin
    .from('push_tokens').select('token').eq('user_id', targetUserId).maybeSingle();

  // notifications_enabled stays on user_profiles — it is a preference flag, not a
  // capability, and the profile screen renders it.
  const { data: prof } = await admin
    .from('user_profiles').select('expo_push_token, notifications_enabled').eq('id', targetUserId).maybeSingle();

  return {
    token: row?.token ?? prof?.expo_push_token ?? null,
    enabled: prof?.notifications_enabled !== false,
  };
}

Deno.serve(async (req: Request) => {
  requestOrigin = req.headers.get('Origin') || '';
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(requestOrigin) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const PUBLISHABLE_KEY = Deno.env.get('SB_PUBLISHABLE_KEY')!;
  const SECRET_KEY = Deno.env.get('SB_SECRET_KEY_INTERNAL')!;

  // Authed client -> caller identity from the JWT. Admin client -> RLS-bypassing
  // reads of membership and the token. The caller NEVER supplies their own id.
  const authed = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const admin = createClient(SUPABASE_URL, SECRET_KEY);

  try {
    const { data: auth } = await authed.auth.getUser();
    const caller = auth?.user;
    if (!caller) return json({ error: 'not_authenticated' }, 401);

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    if (!(await rateLimitOk(admin, caller.id, ip))) {
      return json({ error: 'rate_limited', message: 'Too many notifications. Please wait.' }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const type = String(body.type ?? '');
    const leagueId = String(body.league_id ?? '');
    const targetUserId = String(body.target_user_id ?? '');

    // Closed-set check FIRST: an unknown type never reaches a lookup or a send.
    const spec = NOTIFICATION_TYPES[type];
    if (!spec) return json({ error: 'bad_request', message: 'unknown notification type' }, 400);
    if (!leagueId || !targetUserId) {
      return json({ error: 'bad_request', message: 'league_id and target_user_id required' }, 400);
    }

    // Bots have no device. Cheap reject before any DB work.
    if (targetUserId.startsWith('bot-')) return json({ ok: true, sent: false, reason: 'bot_target' }, 200);

    // ---- AUTHORIZE THE TARGET -------------------------------------------------
    // Both caller and target must belong to the league. Two separate reads rather
    // than one `.in()` so a caller cannot satisfy the check by being counted twice.
    const { data: callerMember } = await admin
      .from('league_members').select('user_id')
      .eq('league_id', leagueId).eq('user_id', caller.id).maybeSingle();
    if (!callerMember) return json({ error: 'forbidden', message: 'not a member of this league' }, 403);

    const { data: targetMember } = await admin
      .from('league_members').select('user_id')
      .eq('league_id', leagueId).eq('user_id', targetUserId).maybeSingle();
    if (!targetMember) return json({ error: 'forbidden', message: 'target is not a member of this league' }, 403);

    // ---- DERIVE THE CONTENT ---------------------------------------------------
    // League name comes from the DB, never from the request. This is what stops a
    // caller smuggling arbitrary text into the body via a forged league name.
    const { data: league } = await admin
      .from('leagues').select('name').eq('id', leagueId).maybeSingle();
    if (!league) return json({ error: 'bad_request', message: 'league not found' }, 400);

    const { title, body: msgBody, data } = spec.build({ leagueName: league.name });

    // ---- SEND -----------------------------------------------------------------
    const { token, enabled } = await getTargetToken(admin, targetUserId);
    // Not an error: the target may simply have no device or have opted out. Report
    // it truthfully rather than as success-with-no-effect.
    if (!token || !enabled) return json({ ok: true, sent: false, reason: 'no_token_or_disabled' }, 200);

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: token, sound: 'default', title, body: msgBody, data }),
    });
    if (!res.ok) {
      console.error('Expo push failed:', res.status, (await res.text().catch(() => '')).slice(0, 200));
      return json({ ok: false, sent: false, reason: 'expo_error' }, 200);
    }

    return json({ ok: true, sent: true, type }, 200);
  } catch (_e) {
    return json({ error: 'unhandled', message: 'Failed to send notification.' }, 500);
  }
});
