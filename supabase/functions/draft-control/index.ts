// draft-control — server-side draft start + bot seeding (mobile launch
// blocker, docs/STATUS.md §4/§5).
//
// Before this function, the ONLY code path that flipped leagues.draft_status
// to 'in_progress', or inserted 'bot-*' league_members rows, was web
// (DraftPage.jsx:1107, DraftSetupModal "Fill with bots") — and the web app is
// paused (APP_PAUSED=true). Mobile draft.tsx showed "the commissioner can
// start the draft from the website", which nobody can do. This function is
// the mobile-reachable replacement, with server-enforced preconditions the
// old client-side UPDATE never had (a member could otherwise start a draft
// with 1 person, no stake mode, or before the scheduled date — see
// rules.ts).
//
// Actions:
//   status    — read-only. Returns whether the draft can start right now, the
//               blockers if not, and whether THIS caller may add bots. Any
//               league member may call this (so a non-commissioner sees why
//               the Start button is disabled).
//   start     — commissioner only. Flips draft_status 'not_started' ->
//               'in_progress' via a conditional UPDATE (.eq('draft_status',
//               'not_started')), so a double-tap or a race with another
//               commissioner device is a no-op, not a double-start.
//   add_bots  — commissioner only, AND the caller's email must be on the
//               DRAFT_BOTS_ALLOWED_EMAILS allowlist (product decision,
//               2026-09-25: test-account-only at launch — see rules.ts). Tops
//               the league up to MIN_DRAFT_MEMBERS bots, never past the
//               league's own num_participants cap. Only while
//               draft_status='not_started' (adding bots mid-draft would
//               reshuffle computeDraftOrder for every already-picking member).
//
// Auth: gateway verify_jwt=true + in-code getUser() (join-league pattern).
// Commissioner identity is read from the leagues row via the VERIFIED user id
// — never trusted from the request body. Writes use the service-role client
// (RLS is the membership backstop underneath, same as validate-and-record-pick
// and join-league); membership + commissioner + allowlist checks happen here.
//
// Interaction with the leagues member-column-guard trigger
// (20260925000000_leagues_member_draft_complete_column_guard.sql): this
// function's UPDATE always runs on the service-role client (no forwarded user
// JWT), so auth.uid() is NULL inside the trigger and its first branch
// (service_role: no-op) applies — the guard never sees this write. It also
// never applies to the commissioner's own PostgREST writes (league-settings'
// draft_date edit): those hit the trigger's second branch (commissioner:
// no-op) unchanged.
//
// NOT a full lockdown yet: leagues_update_commissioner ([I2a]) still lets the
// commissioner flip draft_status directly over PostgREST — this function adds
// the missing SERVER-ENFORCED path and a mobile entry point, it does not
// retire [I2a]. league_members_insert_bot ([I6]) similarly still allows ANY
// member to insert a 'bot-*' row directly. Retiring both is the deferred
// migration (supabase/migrations/deferred/20260929000000_drop_I6_I2b.sql).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  canStartDraft,
  computeBotsNeeded,
  computeStartBlockers,
  isBotsAllowedForEmail,
  isCommissioner,
  type LeagueStartState,
  MIN_DRAFT_MEMBERS,
  nextBotIds,
} from './rules.ts';

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
// Origin threaded per-request, not module state — same isolate-interleaving
// reasoning as validate-and-record-pick.
function jsonFor(origin: string) {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
    });
}

// Fail-open rate limit (join-league pattern). This is an infrequent,
// commissioner-only action, so the limits are modest.
// deno-lint-ignore no-explicit-any
async function rateLimitOk(admin: any, userId: string, ip: string): Promise<boolean> {
  try {
    const calls = [
      admin.rpc('check_and_bump_rate_limit', { p_bucket: 'draft-control', p_subject: `user:${userId}`, p_limit: 20 }),
    ];
    if (ip) {
      calls.push(admin.rpc('check_and_bump_rate_limit', { p_bucket: 'draft-control', p_subject: `ip:${ip}`, p_limit: 60 }));
    }
    const results = await Promise.all(calls);
    return results.every((r) => r.data !== false);
  } catch {
    return true; // FAIL-OPEN
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') || '';
  const json = jsonFor(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(origin) });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const PUBLISHABLE_KEY = Deno.env.get('SB_PUBLISHABLE_KEY')!;
  const SECRET_KEY = Deno.env.get('SB_SECRET_KEY_INTERNAL')!;
  const BOTS_ALLOWED_EMAILS = Deno.env.get('DRAFT_BOTS_ALLOWED_EMAILS') ?? '';

  const authed = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const admin = createClient(SUPABASE_URL, SECRET_KEY);

  try {
    const { data: auth } = await authed.auth.getUser();
    const user = auth?.user;
    if (!user) return json({ ok: false, reason: 'not_authenticated' }, 401);

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    if (!(await rateLimitOk(admin, user.id, ip))) {
      return json({ ok: false, reason: 'rate_limited' }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const leagueId = String(body.league_id ?? '').trim();
    const action = body.action === 'start' ? 'start' : body.action === 'add_bots' ? 'add_bots' : 'status';
    if (!leagueId) return json({ ok: false, reason: 'bad_request' }, 400);

    const { data: league, error: lgErr } = await admin
      .from('leagues')
      .select('id, commissioner_id, draft_status, stake_mode, draft_date, num_participants')
      .eq('id', leagueId)
      .maybeSingle();
    if (lgErr) return json({ ok: false, reason: 'unhandled' }, 500);
    if (!league) return json({ ok: false, reason: 'league_not_found' }, 404);

    const { data: members, error: memErr } = await admin
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId);
    if (memErr) return json({ ok: false, reason: 'unhandled' }, 500);
    const memberIds = (members ?? []).map((m) => String(m.user_id));
    if (!memberIds.includes(user.id)) return json({ ok: false, reason: 'not_a_member' }, 403);

    // Commissioner identity comes ONLY from the verified league row — never
    // from the request body.
    const commissionerId = String(league.commissioner_id ?? '');
    const state: LeagueStartState = {
      commissionerId,
      draftStatus: league.draft_status,
      stakeMode: league.stake_mode ?? null,
      memberCount: memberIds.length,
      numParticipants: Number(league.num_participants) || MIN_DRAFT_MEMBERS,
      draftDate: league.draft_date ?? null,
    };
    const botsAllowed = isBotsAllowedForEmail(BOTS_ALLOWED_EMAILS, user.email);
    const botsNeeded = computeBotsNeeded(state.memberCount, state.numParticipants);

    if (action === 'status') {
      const now = new Date();
      const blockers = computeStartBlockers(state, now);
      return json({
        ok: true,
        can_start: blockers.length === 0,
        blockers,
        is_commissioner: isCommissioner(state, user.id),
        bots_allowed: botsAllowed,
        bots_needed: botsNeeded,
        member_count: state.memberCount,
        min_members: MIN_DRAFT_MEMBERS,
      });
    }

    if (!isCommissioner(state, user.id)) {
      return json({ ok: false, reason: 'not_commissioner' }, 403);
    }

    if (action === 'add_bots') {
      if (!botsAllowed) return json({ ok: false, reason: 'bots_not_allowed' }, 403);
      if (state.draftStatus !== 'not_started') {
        return json({ ok: false, reason: 'not_started_state' }); // 200: game-flow refusal
      }
      if (botsNeeded <= 0) return json({ ok: false, reason: 'no_bots_needed' }); // 200: game-flow refusal

      const newIds = nextBotIds(memberIds, botsNeeded);
      const { error: insErr } = await admin
        .from('league_members')
        .insert(newIds.map((id) => ({ league_id: leagueId, user_id: id, role: 'member' })));
      if (insErr) {
        // (league_id, user_id) primary key backstop: two concurrent add_bots
        // calls (e.g. a commissioner double-tapping from two devices) can
        // compute the SAME candidate ids from the same stale member read —
        // the whole multi-row insert then fails atomically. The caller
        // retries with a fresh status/member read rather than double-adding.
        if ((insErr as { code?: string }).code === '23505') {
          return json({ ok: false, reason: 'bot_id_conflict' }); // 200: race lost, client refetches + retries
        }
        return json({ ok: false, reason: 'unhandled' }, 500);
      }

      return json({ ok: true, added: newIds, member_count: state.memberCount + newIds.length });
    }

    // action === 'start'
    const now = new Date();
    const blockers = computeStartBlockers(state, now);
    if (blockers.length > 0) {
      return json({ ok: false, reason: blockers[0].code, blockers }); // 200: game-flow refusal
    }

    // Conditional UPDATE: only flips a row that is STILL 'not_started', so a
    // double-tap or a race between two commissioner devices is a no-op rather
    // than a double-start. maybeSingle() returning null means someone else's
    // call already won the race — that is success from this caller's view
    // too (the desired end-state is reached either way).
    const { data: updated, error: updErr } = await admin
      .from('leagues')
      .update({ draft_status: 'in_progress' })
      .eq('id', leagueId)
      .eq('draft_status', 'not_started')
      .select('id')
      .maybeSingle();
    if (updErr) return json({ ok: false, reason: 'unhandled' }, 500);
    if (!updated) {
      // Re-check current state: if it's now in_progress, treat as success
      // (idempotent — someone else started it a moment ago); otherwise it
      // moved to a state we don't expect (e.g. someone completed a re-draft
      // out from under us) and we surface that as a fresh blocker set.
      const { data: recheck } = await admin
        .from('leagues')
        .select('draft_status')
        .eq('id', leagueId)
        .maybeSingle();
      if (recheck?.draft_status === 'in_progress') {
        return json({ ok: true, already_started: true });
      }
      return json({ ok: false, reason: 'not_started_state' });
    }

    return json({ ok: true });
  } catch (_e) {
    return json({ ok: false, reason: 'unhandled' }, 500);
  }
});
