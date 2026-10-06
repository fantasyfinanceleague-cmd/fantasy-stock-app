// leave-league: a manager leaves a league (before the draft order is set) or
// hides a finished one. docs/migrations/LEAVE_LEAGUE_OPTIONS.md has the rulings.
//
// Actions:
//   leave  — calls leave_league (20261107000001) with the VERIFIED user id, plus
//            new_commissioner_id when the caller is the commissioner. Every
//            rule lives in the RPC: the window (locked_in from T-1h through the
//            season), the hand-over, the roster reconfirmation, and hiding after
//            the season. On a pre-draft leave the RPC returns a member_left
//            notice id; this function then pushes it to the (new) commissioner
//            and settles its push_status. A push failure never fails the leave,
//            because the leave has already committed.
//   unhide — calls unhide_league: show a hidden finished league again.
//
// Auth: gateway verify_jwt=true plus in-code getUser() (the join-league pattern).
// The user id comes ONLY from the verified JWT, never from the body. The RPCs
// are EXECUTE service_role only, so this function is their only caller.
//
// Why service role (not a client-called definer RPC): the freeze release
// (PR #123) treats any auth.uid() IS NOT NULL caller as a user session,
// SECURITY DEFINER included, and would refuse the commissioner hand-over.
//
// SUCCESS SIGNALS (CLAUDE.md): .rpc() resolves to { error } on a Postgres error,
// it doesn't throw. So every call destructures and checks it, and every UPDATE
// checks the row it matched, not just the absence of an error.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getTargetToken, sendExpoPush } from '../_shared/push.ts';
import { clientResponse, type DeliveryOutcome, memberLeftMessage, noticeStatus, parseLeaveRequest } from './logic.ts';

// ---- CORS / response helpers (same pattern as join-league) -----------------
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

// deno-lint-ignore no-explicit-any
type Admin = any;

// ---- Fail-open rate limit: per-user (10/min) + per-IP (30/min) --------------
async function rateLimitOk(admin: Admin, userId: string, ip: string): Promise<boolean> {
  try {
    const calls = [
      admin.rpc('check_and_bump_rate_limit', { p_bucket: 'leave-league', p_subject: `user:${userId}`, p_limit: 10 }),
    ];
    if (ip) {
      calls.push(admin.rpc('check_and_bump_rate_limit', { p_bucket: 'leave-league', p_subject: `ip:${ip}`, p_limit: 30 }));
    }
    const results = await Promise.all(calls);
    // deno-lint-ignore no-explicit-any
    return results.every((r: any) => r.data !== false);
  } catch {
    return true; // FAIL-OPEN
  }
}

/**
 * Deliver ONE member_left notice: claim (pending -> sending), send, settle.
 * The claim is conditional, so a retry of this request can't double-send.
 * Returns the settled status, or null if the claim or settle didn't land.
 * Never throws.
 */
// deno-lint-ignore no-explicit-any
async function deliverMemberLeft(admin: Admin, r: Record<string, any>, leagueId: string): Promise<string | null> {
  try {
    const { data: claimed, error: claimErr } = await admin
      .from('league_notifications')
      .update({ push_status: 'sending', push_attempts: 1, push_attempted_at: new Date().toISOString() })
      .eq('id', r.notice_id)
      .eq('push_status', 'pending')
      .select('id')
      .maybeSingle();
    if (claimErr || !claimed) {
      console.error('member_left claim failed', r.notice_id, claimErr ? JSON.stringify(claimErr) : 'no row claimed');
      return null;
    }

    let outcome: DeliveryOutcome;
    const { token, enabled, lookupFailed } = await getTargetToken(admin, String(r.notify_user_id));
    if (lookupFailed) {
      outcome = 'lookup_failed';
    } else if (!token || !enabled) {
      outcome = 'no_token';
    } else {
      const res = await sendExpoPush(token, memberLeftMessage({
        leagueId,
        leagueName: r.league_name ?? null,
        leaverName: r.leaver_name ?? null,
        madeCommissioner: r.made_commissioner === true,
        reconfirmRequired: r.reconfirm_required === true,
      }));
      outcome = res.sent ? 'sent' : res.reason;
    }

    const status = noticeStatus(outcome);
    const { data: settled, error: setErr } = await admin
      .from('league_notifications')
      .update({ push_status: status, push_error: outcome === 'sent' ? null : outcome })
      .eq('id', r.notice_id)
      .eq('push_status', 'sending')
      .select('id')
      .maybeSingle();
    if (setErr || !settled) {
      console.error('member_left settle failed', r.notice_id, setErr ? JSON.stringify(setErr) : 'no row settled');
      return null;
    }
    return status;
  } catch (e) {
    console.error('member_left delivery threw', r?.notice_id, String(e));
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') || '';
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
    });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(origin) });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const PUBLISHABLE_KEY = Deno.env.get('SB_PUBLISHABLE_KEY')!;
  const SECRET_KEY = Deno.env.get('SB_SECRET_KEY_INTERNAL')!;

  const authed = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const admin = createClient(SUPABASE_URL, SECRET_KEY);

  try {
    const { data: auth } = await authed.auth.getUser();
    const user = auth?.user;
    if (!user) return json({ ok: false, reason: 'not_authenticated' }, 401);

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    if (!(await rateLimitOk(admin, user.id, ip))) return json({ ok: false, reason: 'rate_limited' }, 429);

    const parsed = parseLeaveRequest(await req.json().catch(() => null));
    if (!parsed) return json({ ok: false, reason: 'bad_request' }, 400);

    const { data, error } = parsed.action === 'unhide'
      ? await admin.rpc('unhide_league', { p_league_id: parsed.leagueId, p_user_id: user.id })
      : await admin.rpc('leave_league', {
        p_league_id: parsed.leagueId,
        p_user_id: user.id,
        p_new_commissioner: parsed.newCommissionerId,
      });
    if (error) {
      console.error(`${parsed.action} rpc failed`, JSON.stringify(error));
      return json({ ok: false, reason: 'unhandled' }, 500);
    }

    if (data?.status === 'left' && data?.notice_id) {
      const pushed = await deliverMemberLeft(admin, data, parsed.leagueId);
      console.log('member_left', JSON.stringify({ notice: data.notice_id, push_status: pushed }));
    }

    // 200 for game-flow refusals (draft-control's convention); the reason says why.
    return json(clientResponse(data), 200);
  } catch (_e) {
    return json({ ok: false, reason: 'unhandled' }, 500);
  }
});
