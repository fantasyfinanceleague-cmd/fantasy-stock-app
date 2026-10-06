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
//   confirm_roster — commissioner only. After a pre-draft leave
//               (leave-league, 20261107000001) the draft can't start until the
//               commissioner reconfirms the roster. Calls confirm_league_roster
//               (service role) with the VERIFIED user id and an optional
//               playoff_teams, which it validates against the member count in
//               the same transaction (20261107000002).
//   add_bots  — commissioner only, AND the caller's email must be on the
//               DRAFT_BOTS_ALLOWED_EMAILS allowlist (product decision,
//               2026-09-25: test-account-only at launch — see rules.ts). Tops
//               the league up to MIN_DRAFT_MEMBERS bots, never past the
//               league's own num_participants cap. Only while
//               draft_status='not_started' (the DB refuses joins once the
//               stored draft order is locked at start anyway).
//
// Draft order: stored in league_draft_order (20261013000000), NOT decided
// here. The flip to 'in_progress' below fires trg_leagues_order_start, which
// materializes the order if nothing has yet (date TBD), reconciles it to the
// exact member set, and LOCKS it — the same trigger covers the commissioner's
// direct [I2a] flip, so no start path can skip it.
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
  computeBotsNeeded,
  computeStartBlockers,
  isBotsAllowedForEmail,
  isCommissioner,
  type LeagueStartState,
  MIN_DRAFT_MEMBERS,
  nextBotIds,
  type StartBlocker,
  toRosterReconfirm,
} from './rules.ts';
import { checkStartFeasibility, typesFromSlots } from '../_shared/draft-feasibility.ts';
import { leagueRules, loadSlots, poolGroups } from '../_shared/draft-write.ts';
import type { Slot } from '../_shared/draft-validation.ts';

/**
 * "A draft pick can never be unused" (2026-10-05): can every slot of every
 * manager be filled, at current cached prices, with the budget reserve? Read by
 * status and start (current slots, the real member count) and by check_setup
 * (the PROPOSED slots, at the league cap: the worst case the league can reach).
 * Fails CLOSED: a pool that cannot be read is a blocker, never a pass.
 */
async function feasibilityBlockers(
  // deno-lint-ignore no-explicit-any
  admin: any,
  // deno-lint-ignore no-explicit-any
  league: any,
  managers: number,
  // null = the league's SAVED slots (status/start); an array = the PROPOSED set
  // (check_setup), where [] means a slot-less league, not "use the saved ones".
  proposedSlots: Slot[] | null,
): Promise<StartBlocker[]> {
  try {
    const numRounds = Number(league.num_rounds) || 6;
    let slots: Slot[];
    if (proposedSlots) {
      slots = proposedSlots;
    } else {
      const loaded = await loadSlots(admin, String(league.id));
      if (loaded.error) throw new Error('slots_fetch_failed'); // fail CLOSED, never read as slot-less
      slots = loaded.slots;
    }
    const types = typesFromSlots(slots, numRounds);
    const rules = leagueRules(league, numRounds);
    const groups = await poolGroups(
      admin,
      types,
      [],
      rules.allowUndraftable !== true,
      managers * numRounds + 2,
    );
    const verdict = checkStartFeasibility({
      types,
      managers,
      numRounds,
      budget: rules.stakeMode === 'budget_cap' ? Number(rules.budgetAmount) || 0 : null,
      groups,
    });
    if (verdict.ok) return [];
    if (verdict.reason === 'slots_infeasible') {
      return [{ code: 'slots_infeasible', ordinals: verdict.hall.ordinals, need: verdict.hall.need, have: verdict.hall.have }];
    }
    return [{ code: 'budget_infeasible', reserve: verdict.reserve, budget: verdict.budget }];
  } catch (e) {
    console.error('feasibility check failed', String(league?.id), String(e));
    return [{ code: 'feasibility_unavailable' }];
  }
}

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
    const action = body.action === 'start'
      ? 'start'
      : body.action === 'add_bots'
      ? 'add_bots'
      : body.action === 'check_setup'
      ? 'check_setup'
      : body.action === 'confirm_roster'
      ? 'confirm_roster'
      : 'status';
    if (!leagueId) return json({ ok: false, reason: 'bad_request' }, 400);

    const { data: league, error: lgErr } = await admin
      .from('leagues')
      .select('id, commissioner_id, draft_status, stake_mode, draft_date, num_participants, league_type, playoff_teams, num_rounds, budget_amount, allow_undraftable')
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

    // A pending roster reconfirmation (20261107000000). Read for every action:
    // its PRESENCE blocks the start. A failed read fails CLOSED (500), never
    // "nothing owed".
    const { data: reconfirmRow, error: rcErr } = await admin
      .from('league_roster_reconfirm')
      .select('departed, members_before')
      .eq('league_id', leagueId)
      .maybeSingle();
    if (rcErr) return json({ ok: false, reason: 'unhandled' }, 500);

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
      leagueType: league.league_type ?? null,
      playoffTeams: league.playoff_teams == null ? null : Number(league.playoff_teams),
      rosterReconfirm: toRosterReconfirm(reconfirmRow),
    };
    const botsAllowed = isBotsAllowedForEmail(BOTS_ALLOWED_EMAILS, user.email);
    const botsNeeded = computeBotsNeeded(state.memberCount, state.numParticipants);

    if (action === 'status') {
      const now = new Date();
      // Feasibility is judged only when nothing else blocks the start: the pool
      // read is the costly part, and "set a date" is the more useful message.
      const basic = computeStartBlockers(state, now);
      const blockers = basic.length > 0
        ? basic
        : [...basic, ...(await feasibilityBlockers(admin, league, memberIds.length, null))];
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

    if (action === 'check_setup') {
      // The PROPOSED slot set (not yet saved), judged at the league cap: the
      // worst case the league can reach. The client saves only on ok:true.
      // Strict input (review): an array of at most 12 slots, integer counts,
      // finite bounds. Anything else is a 400, never a silently looser verdict.
      if (!Array.isArray(body.slots) || body.slots.length > 12) {
        return json({ ok: false, reason: 'bad_request' }, 400);
      }
      const finiteOrNull = (v: unknown): number | null | 'bad' => {
        if (v == null || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : 'bad';
      };
      const proposed: Slot[] = [];
      for (let i = 0; i < body.slots.length; i++) {
        const r = body.slots[i] as Record<string, unknown>;
        const count = Number(r?.slot_count);
        const lo = finiteOrNull(r?.price_min);
        const hi = finiteOrNull(r?.price_max);
        if (!Number.isInteger(count) || count < 1 || count > 12 || lo === 'bad' || hi === 'bad') {
          return json({ ok: false, reason: 'bad_request' }, 400);
        }
        proposed.push({
          id: `proposed-${i}`,
          slotIndex: i,
          slotCount: count,
          priceMin: lo,
          priceMax: hi,
          categoryId: r?.category_id ? String(r.category_id) : null,
        });
      }
      const blockers = await feasibilityBlockers(admin, league, state.numParticipants, proposed);
      // Only the verdict leaves the server: the hall / reserve detail is a count
      // oracle over arbitrary brackets and categories, so it stays in the logs.
      if (blockers.length > 0) {
        console.error('check_setup refused', String(league.id), JSON.stringify(blockers));
        return json({ ok: false, reason: blockers[0].code });
      }
      return json({ ok: true });
    }

    if (action === 'confirm_roster') {
      // Strict input: absent/null = keep the current playoff_teams; otherwise an
      // integer the RPC validates against the member count (2 <= P <= members).
      const rawP = body.playoff_teams;
      if (rawP != null && !(Number.isInteger(rawP) && rawP >= 2 && rawP <= 16)) {
        return json({ ok: false, reason: 'bad_request' }, 400);
      }
      const { data: rc, error: rcCallErr } = await admin.rpc('confirm_league_roster', {
        p_league_id: leagueId,
        p_user_id: user.id,
        p_playoff_teams: rawP ?? null,
      });
      // .rpc() resolves { error } on a Postgres error, it doesn't throw (CLAUDE.md).
      if (rcCallErr) {
        console.error('confirm_league_roster failed', JSON.stringify(rcCallErr));
        return json({ ok: false, reason: 'unhandled' }, 500);
      }
      if (rc?.status === 'confirmed') {
        return json({ ok: true, members: rc.members, playoff_teams: rc.playoff_teams });
      }
      if (rc?.status === 'unchanged') return json({ ok: true, unchanged: true, reason: rc.reason });
      // 200: game-flow refusal (playoff_teams_exceeds_members carries both numbers).
      return json({ ok: false, reason: String(rc?.reason ?? 'unhandled'), playoff_teams: rc?.playoff_teams, members: rc?.members });
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
    const basic = computeStartBlockers(state, now);
    const blockers = basic.length > 0
      ? basic
      : [...basic, ...(await feasibilityBlockers(admin, league, memberIds.length, null))];
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
      const { data: recheck, error: recheckErr } = await admin
        .from('leagues')
        .select('draft_status')
        .eq('id', leagueId)
        .maybeSingle();
      if (recheckErr) return json({ ok: false, reason: 'unhandled' }, 500);
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
