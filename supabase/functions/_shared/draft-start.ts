/**
 * Draft auto-start — THE code path that watches, gates and starts drafts
 * (2026-10-06; plan + Giorgio's decisions: docs/migrations/DRAFT_AUTO_START_PLAN.md,
 * policy: ./draft-start-policy.ts).
 *
 * Callers:
 *   * draft-autopick-sweep (the 10 s cron):
 *       - WATCH pass: watchLeague for every league public.draft_watch_due()
 *         lists — records the verdict (the commissioner's early warning) and,
 *         in the gate window, postpones a blocked league or clears the gate;
 *       - START pass: startDraftIfDue for every league due_draft_starts() lists.
 *   * draft-control action:'start' (the 1.1.0 Start button): startDraftIfDue,
 *     so it can only do what the next tick would.
 * Every write is a service-role SQL function (20261109000000) that takes the
 * league row lock and compare-and-swaps the inputs judged here
 * (_draft_start_inputs vs buildStartExpect), so an edit or a join between this
 * evaluation and the write is 'changed', never a decision on rules nobody
 * checked.
 *
 * computeStartBlockers and #126's toRosterReconfirm stay in
 * ../draft-control/rules.ts (their tests and history live there). The deploy
 * bundler follows the relative import, so draft-autopick-sweep's upload list
 * includes draft-control/rules.ts (byte-verify it).
 */
import {
  computeStartBlockers,
  type LeagueStartState,
  MIN_DRAFT_MEMBERS,
  type RosterReconfirm,
  type StartBlocker,
  toRosterReconfirm,
} from '../draft-control/rules.ts';
import { checkStartFeasibility, typesFromSlots } from './draft-feasibility.ts';
import { leagueRules, loadSlots, poolGroups } from './draft-write.ts';
import type { Slot } from './draft-validation.ts';
import { isInGate, isPastStartRetry, isRoomTime, isTransientBlocker } from './draft-start-policy.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;
// deno-lint-ignore no-explicit-any
type LeagueRow = any;

/** Every leagues column the blocker evaluation and the CAS read. */
export const START_LEAGUE_COLUMNS =
  'id, commissioner_id, draft_status, stake_mode, draft_date, num_participants, league_type, playoff_teams, num_rounds, budget_amount, allow_undraftable';

export function toStartState(
  league: LeagueRow,
  memberCount: number,
  rosterReconfirm: RosterReconfirm | null = null,
): LeagueStartState {
  return {
    commissionerId: String(league.commissioner_id ?? ''),
    draftStatus: league.draft_status,
    stakeMode: league.stake_mode ?? null,
    memberCount,
    numParticipants: Number(league.num_participants) || MIN_DRAFT_MEMBERS,
    draftDate: league.draft_date ?? null,
    leagueType: league.league_type ?? null,
    playoffTeams: league.playoff_teams == null ? null : Number(league.playoff_teams),
    rosterReconfirm,
  };
}

/**
 * "A draft pick can never be unused" (2026-10-05): can every slot of every
 * manager be filled, at current cached prices, with the budget reserve? Read by
 * status/start/watch (the saved slots, the real member count) and by
 * check_setup (the PROPOSED slots, at the league cap). `slots` null = the saved
 * slots could not be read. Fails CLOSED: an unreadable pool or slot set is the
 * feasibility_unavailable blocker, never a pass.
 */
export async function feasibilityBlockers(
  admin: Admin,
  league: LeagueRow,
  managers: number,
  slots: Slot[] | null,
): Promise<StartBlocker[]> {
  try {
    if (slots === null) throw new Error('slots_fetch_failed'); // never read as slot-less
    const numRounds = Number(league.num_rounds) || 6;
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

/** The saved slots, or null when they could not be read (fail closed). */
export async function loadSavedSlots(admin: Admin, leagueId: string): Promise<Slot[] | null> {
  const loaded = await loadSlots(admin, leagueId);
  return loaded.error ? null : loaded.slots;
}

/**
 * The full blocker set for a not-yet-started league: computeStartBlockers,
 * then — only when nothing else blocks, because the pool read is the costly
 * part — feasibility. `slots`: the saved slots already read (null = the read
 * failed), or undefined to read them only if feasibility runs.
 * `ignoreDateNotReached` judges the rest of the set before the draft time
 * (the watch, the gate, and status's at-risk view).
 */
export async function evaluateStartBlockers(
  admin: Admin,
  league: LeagueRow,
  state: LeagueStartState,
  slots: Slot[] | null | undefined,
  now: Date,
  opts: { ignoreDateNotReached?: boolean } = {},
): Promise<StartBlocker[]> {
  const basic = computeStartBlockers(state, now);
  const gating = opts.ignoreDateNotReached ? basic.filter((b) => b.code !== 'draft_date_not_reached') : basic;
  if (gating.length > 0) return gating;
  const saved = slots === undefined ? await loadSavedSlots(admin, String(league.id)) : slots;
  return [...gating, ...(await feasibilityBlockers(admin, league, state.memberCount, saved))];
}

/** Every input the evaluation judged, in the exact shape public._draft_start_inputs
 * rebuilds under the row lock (20261109000000) — compared with jsonb `=`, so keys
 * must match and numerics compare by value (250 = 250.00). Slots sorted by
 * (slot_index, id), the SQL side's ORDER BY. */
export function buildStartExpect(league: LeagueRow, memberCount: number, slots: Slot[], reconfirmOwed: boolean) {
  const sorted = [...slots].sort((a, b) =>
    a.slotIndex !== b.slotIndex ? a.slotIndex - b.slotIndex : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
  return {
    members: memberCount,
    stake_mode: league.stake_mode ?? null,
    budget_amount: league.budget_amount ?? null,
    num_rounds: league.num_rounds ?? null,
    allow_undraftable: league.allow_undraftable ?? null,
    league_type: league.league_type ?? null,
    playoff_teams: league.playoff_teams ?? null,
    reconfirm_owed: reconfirmOwed,
    slots: sorted.map((s) => ({
      id: s.id,
      slot_index: s.slotIndex,
      slot_count: s.slotCount,
      price_min: s.priceMin,
      price_max: s.priceMax,
      category_id: s.categoryId,
    })),
  };
}

export interface StartInputs {
  league: LeagueRow;
  memberCount: number;
  reconfirm: RosterReconfirm | null;
  postponed: boolean;
  slots: Slot[] | null;
  state: LeagueStartState;
}

/** Read everything one decision needs. Any failed read is an error (never a
 * guess): a failed reconfirm read must not read as "nothing owed". */
export async function loadStartInputs(
  admin: Admin,
  leagueId: string,
): Promise<{ ok: true; inputs: StartInputs } | { ok: false; reason: string }> {
  const { data: league, error: lgErr } = await admin
    .from('leagues').select(START_LEAGUE_COLUMNS).eq('id', leagueId).maybeSingle();
  if (lgErr) return { ok: false, reason: 'league_read_failed' };
  if (!league) return { ok: false, reason: 'league_not_found' };
  const { data: members, error: memErr } = await admin
    .from('league_members').select('user_id').eq('league_id', leagueId);
  if (memErr) return { ok: false, reason: 'members_read_failed' };
  const { data: rc, error: rcErr } = await admin
    .from('league_roster_reconfirm').select('departed, members_before, choice').eq('league_id', leagueId).maybeSingle();
  if (rcErr) return { ok: false, reason: 'reconfirm_read_failed' };
  const { data: pp, error: ppErr } = await admin
    .from('draft_postponements').select('league_id').eq('league_id', leagueId).maybeSingle();
  if (ppErr) return { ok: false, reason: 'postponement_read_failed' };
  const memberCount = (members ?? []).length;
  const reconfirm = toRosterReconfirm(rc);
  return {
    ok: true,
    inputs: {
      league,
      memberCount,
      reconfirm,
      postponed: !!pp,
      slots: await loadSavedSlots(admin, leagueId),
      state: toStartState(league, memberCount, reconfirm),
    },
  };
}

type Blockers = Array<StartBlocker | { code: string }>;

/** Postpone through the SQL function (stale / already-postponed / started are
 * answers, not errors). Never throws. */
async function postpone(
  admin: Admin,
  leagueId: string,
  draftDate: string,
  stage: 'room_open' | 'start',
  reason: string,
  blockers: Blockers,
  expect: unknown, // the inputs judged (CAS); null when the slots were unreadable
): Promise<{ status: string } | { error: string }> {
  try {
    // .rpc() resolves { error } on a Postgres error; it does not throw (CLAUDE.md #5).
    const { data, error } = await admin.rpc('postpone_league_draft', {
      p_league_id: leagueId,
      p_draft_date: draftDate,
      p_stage: stage,
      p_reason: reason,
      p_blockers: blockers,
      p_expect: expect,
    });
    if (error) {
      console.error('postpone_league_draft failed', leagueId, JSON.stringify(error));
      return { error: 'postpone_rpc_failed' };
    }
    return { status: String(data?.status ?? 'unexpected') };
  } catch (e) {
    console.error('postpone_league_draft threw', leagueId, String(e));
    return { error: 'postpone_threw' };
  }
}

// ---------------------------------------------------------------------------
// START (at or after T)
// ---------------------------------------------------------------------------

export type StartOutcome =
  | { outcome: 'started' }
  | { outcome: 'already_started' }
  | { outcome: 'not_startable'; draftStatus: string } // left not_started some other way
  | { outcome: 'not_due'; blockers: Blockers } // TBD, or draft_date not reached
  | { outcome: 'postponed'; reason: string; blockers: Blockers } // THIS call postponed it
  | { outcome: 'already_postponed' }
  | { outcome: 'retry'; reason: string } // a system reason; the next tick tries again
  | { outcome: 'error'; reason: string };

/**
 * At or after T: start the draft, or postpone it (decision 1: no late start).
 *   * a real blocker -> postpone now (stage 'start');
 *   * the room never opened for this time (nobody got the >= 1 h notice) ->
 *     postpone ('room_did_not_open');
 *   * a SYSTEM reason (feasibility unreadable, a racing edit, an rpc error) ->
 *     retry each tick until START_RETRY_SECONDS past T, then postpone
 *     ('start_failed'), so nothing stays in limbo.
 * Idempotent: two callers serialize on start_league_draft's row lock.
 */
export async function startDraftIfDue(admin: Admin, leagueId: string, now: Date): Promise<StartOutcome> {
  try {
    const loaded = await loadStartInputs(admin, leagueId);
    if (!loaded.ok) return { outcome: 'error', reason: loaded.reason };
    const { league, memberCount, reconfirm, postponed, slots, state } = loaded.inputs;
    if (league.draft_status === 'in_progress') return { outcome: 'already_started' };
    if (league.draft_status !== 'not_started') return { outcome: 'not_startable', draftStatus: String(league.draft_status) };
    if (postponed) return { outcome: 'already_postponed' };
    if (!league.draft_date) return { outcome: 'not_due', blockers: [{ code: 'no_draft_date' }] };
    const draftDate = String(league.draft_date);
    if (new Date(draftDate).getTime() > now.getTime()) {
      return { outcome: 'not_due', blockers: [{ code: 'draft_date_not_reached', draftDate }] };
    }

    const expect = slots === null ? null : buildStartExpect(league, memberCount, slots, reconfirm !== null);
    const doPostpone = async (reason: string, blockers: Blockers): Promise<StartOutcome> => {
      const p = await postpone(admin, leagueId, draftDate, 'start', reason, blockers, expect);
      if ('error' in p) return { outcome: 'retry', reason: p.error };
      if (p.status === 'postponed') return { outcome: 'postponed', reason, blockers };
      if (p.status === 'already_postponed') return { outcome: 'already_postponed' };
      if (p.status === 'already_started') return { outcome: 'already_started' };
      return { outcome: 'retry', reason: `postpone_${p.status}` }; // stale/changed: re-judged next tick
    };
    const systemFailure = async (reason: string): Promise<StartOutcome> =>
      isPastStartRetry(draftDate, now)
        ? await doPostpone('start_failed', [{ code: 'start_failed' }, { code: reason }])
        : { outcome: 'retry', reason };

    const blockers = await evaluateStartBlockers(admin, league, state, slots, now);
    const real = blockers.filter((b) => !isTransientBlocker(b.code));
    if (real.length > 0) return await doPostpone(real[0].code, real);
    if (blockers.length > 0) return await systemFailure(blockers[0].code); // only transient ones

    const { data: res, error: startErr } = await admin.rpc('start_league_draft', {
      p_league_id: leagueId,
      p_expect: expect,
    });
    if (startErr) {
      console.error('start_league_draft failed', leagueId, JSON.stringify(startErr));
      return await systemFailure('start_rpc_failed');
    }
    switch (res?.status) {
      case 'started':
        return { outcome: 'started' };
      case 'already_started':
        return res.draft_status === 'in_progress'
          ? { outcome: 'already_started' }
          : { outcome: 'not_startable', draftStatus: String(res.draft_status) };
      case 'postponed':
        return { outcome: 'already_postponed' };
      case 'not_due':
        return { outcome: 'not_due', blockers: [] };
      case 'room_not_open':
        return await doPostpone('room_did_not_open', [{ code: 'room_did_not_open' }]);
      case 'blocked': {
        // The SQL floor or a gate trigger (#126 roster_reconfirm_required, #94
        // renewal_replies_pending) refused under the lock.
        const reason = String(res.reason ?? 'blocked');
        return await doPostpone(reason, [{ code: reason }]);
      }
      case 'changed':
        console.error('start_league_draft: inputs changed since evaluation', leagueId, JSON.stringify(res.actual ?? null));
        return await systemFailure('changed');
      default:
        console.error('start_league_draft: unexpected result', leagueId, JSON.stringify(res));
        return await systemFailure('start_rpc_unexpected');
    }
  } catch (e) {
    console.error('startDraftIfDue failed', leagueId, String(e));
    return { outcome: 'error', reason: 'unhandled' };
  }
}

// ---------------------------------------------------------------------------
// WATCH + GATE (before T)
// ---------------------------------------------------------------------------

export type WatchOutcome =
  | { outcome: 'recorded'; blocked: boolean; notified: string | null; gateCleared: boolean }
  | { outcome: 'postponed'; reason: string } // blocked in the gate window
  | { outcome: 'skipped'; reason: string } // not a league to watch (any more), or wait a tick
  | { outcome: 'changed' } // an input moved mid-evaluation; the next tick re-evaluates
  | { outcome: 'error'; reason: string };

/**
 * Before T: judge the league and record the verdict (record_draft_watch writes
 * the commissioner's 'draft_at_risk' notice when it BECOMES blocked, and the
 * T-2h reminder). In the gate window [T-1h-30s, T): a real blocker postpones
 * now (stage 'room_open'); a clear verdict clears the gate so the room opens.
 * An unknown verdict (feasibility unreadable) never warns or postpones; once
 * the room's time has come it clears the gate (fail open for the NOTICE: the
 * start re-checks and fails closed).
 */
export async function watchLeague(admin: Admin, leagueId: string, now: Date): Promise<WatchOutcome> {
  try {
    const loaded = await loadStartInputs(admin, leagueId);
    if (!loaded.ok) return { outcome: 'error', reason: loaded.reason };
    const { league, memberCount, reconfirm, postponed, slots, state } = loaded.inputs;
    if (league.draft_status !== 'not_started') return { outcome: 'skipped', reason: 'started' };
    if (postponed) return { outcome: 'skipped', reason: 'postponed' };
    if (!league.draft_date) return { outcome: 'skipped', reason: 'no_draft_date' };
    const draftDate = String(league.draft_date);
    if (new Date(draftDate).getTime() <= now.getTime()) return { outcome: 'skipped', reason: 'due' };

    const blockers = await evaluateStartBlockers(admin, league, state, slots, now, { ignoreDateNotReached: true });
    const real = blockers.filter((b) => !isTransientBlocker(b.code));
    const verdict: boolean | null = real.length > 0 ? true : blockers.length > 0 ? null : false;
    const inGate = isInGate(draftDate, now);

    const expect = slots === null ? null : buildStartExpect(league, memberCount, slots, reconfirm !== null);
    if (inGate && verdict === true) {
      const p = await postpone(admin, leagueId, draftDate, 'room_open', real[0].code, real, expect);
      if ('error' in p) return { outcome: 'error', reason: p.error };
      if (p.status === 'changed') return { outcome: 'changed' };
      return p.status === 'postponed'
        ? { outcome: 'postponed', reason: real[0].code }
        : { outcome: 'skipped', reason: `postpone_${p.status}` };
    }
    if (inGate && verdict === null && !isRoomTime(draftDate, now)) {
      return { outcome: 'skipped', reason: 'unknown_before_room_time' }; // re-judged next tick
    }

    const { data: res, error } = await admin.rpc('record_draft_watch', {
      p_league_id: leagueId,
      p_draft_date: draftDate,
      p_expect: expect,
      p_blocked: verdict,
      p_blockers: real,
      p_gate: inGate,
    });
    if (error) {
      console.error('record_draft_watch failed', leagueId, JSON.stringify(error));
      return { outcome: 'error', reason: 'record_rpc_failed' };
    }
    if (res?.status === 'recorded') {
      return {
        outcome: 'recorded',
        blocked: res.blocked === true,
        notified: res.notified ?? null,
        gateCleared: res.gate_cleared === true,
      };
    }
    if (res?.status === 'changed') return { outcome: 'changed' };
    return { outcome: 'skipped', reason: String(res?.status ?? 'unexpected') };
  } catch (e) {
    console.error('watchLeague failed', leagueId, String(e));
    return { outcome: 'error', reason: 'unhandled' };
  }
}
