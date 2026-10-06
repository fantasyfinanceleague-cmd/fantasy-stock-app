/**
 * Draft start — THE one code path that starts a draft (draft auto-start,
 * 2026-10-06; plan: docs/migrations/DRAFT_AUTO_START_PLAN.md).
 *
 * Callers:
 *   * draft-autopick-sweep's start pass (the cron, every 10 s): every league
 *     public.due_draft_starts() lists — the auto-start itself;
 *   * draft-control action:'start' — the commissioner's (1.1.0) Start button,
 *     now redundant with the cron but harmless: it can only do what the next
 *     tick would.
 * Both run the same blocker evaluation and the same flip, on the service role.
 *
 * The flip is public.start_league_draft (20261109000000, service_role only):
 * it takes the league row lock, re-judges the start window on the DB clock,
 * re-checks a floor of the rules, and COMPARE-AND-SWAPS every input the
 * evaluation below judged (members, rules, slots) before flipping. So the
 * blocker read here and the flip cannot be split by a concurrent edit or join:
 * a mismatch comes back as 'changed' and the next tick re-evaluates. The flip
 * fires the existing start triggers (order lock, pick-clock anchor, #123's
 * freeze, #126/#94 gates) exactly as before.
 *
 * computeStartBlockers (and #126's toRosterReconfirm) stay in
 * ../draft-control/rules.ts, where their tests and history live, and are
 * imported from there. The deploy bundler follows the relative import, so
 * draft-autopick-sweep's upload list gains draft-control/rules.ts (byte-verify
 * it).
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
import { isPastStartWindow } from './draft-start-policy.ts';

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
 * status and start (the saved slots, the real member count) and by check_setup
 * (the PROPOSED slots, at the league cap: the worst case the league can reach).
 * `slots` null = the saved slots could not be read. Fails CLOSED: a pool or slot
 * set that cannot be read is a blocker, never a pass.
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
 * The full blocker set for a not-yet-started league: the rules in
 * computeStartBlockers, then — only when nothing else blocks, because the pool
 * read is the costly part — feasibility. `slots`: the saved slots already read
 * (null = the read failed), or undefined to read them only if feasibility runs.
 * `ignoreDateNotReached` lets status evaluate the rest of the set during the
 * room-open hour (the early warning).
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
  if (gating.length > 0) return basic;
  const saved = slots === undefined ? await loadSavedSlots(admin, String(league.id)) : slots;
  return [...basic, ...(await feasibilityBlockers(admin, league, state.memberCount, saved))];
}

/** Every input the evaluation judged, in the exact shape start_league_draft
 * rebuilds under the row lock (20261109000000) — compared with jsonb `=`, so
 * keys must match and numerics compare by value (250 = 250.00). Slots sorted by
 * (slot_index, id), the SQL side's ORDER BY. */
export function buildStartExpect(league: LeagueRow, memberCount: number, slots: Slot[]) {
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

export type StartOutcome =
  | { outcome: 'started' }
  | { outcome: 'already_started' }
  | { outcome: 'not_startable'; draftStatus: string } // left not_started some other way (e.g. completed)
  | { outcome: 'not_due'; blockers: StartBlocker[] } // TBD date, or draft_date not reached
  | { outcome: 'missed' } // past the grace: needs a new draft time (draft-start-policy.ts)
  // blockers: the evaluation's, or one { code } for a refusal under the lock
  | { outcome: 'blocked'; reason: string; blockers: Array<StartBlocker | { code: string }> }
  | { outcome: 'changed' } // an input moved between the evaluation and the flip: retry
  | { outcome: 'error'; reason: string };

/** Record a failed attempt: drives the sweep's 60 s back-off (due_draft_starts)
 * and is the state a "delayed" lobby reads later. Every non-success outcome of a
 * DUE league is noted — blocked, changed and error alike (review M1): an
 * un-noted league is re-listed every 10 s at the head of due_draft_starts and,
 * ten of them, would crowd every later league out of MAX_STARTS_PER_RUN for the
 * whole grace. A failed write is logged and otherwise ignored: the only cost is
 * the cron retrying sooner. */
async function noteBlocked(admin: Admin, leagueId: string, reason: string, blockers: unknown[]) {
  try {
    // .rpc() resolves { error } on a Postgres error; it does not throw (CLAUDE.md #5).
    const { error } = await admin.rpc('note_draft_start_blocked', {
      p_league_id: leagueId,
      p_reason: reason,
      p_blockers: blockers,
    });
    if (error) console.error('note_draft_start_blocked failed', leagueId, JSON.stringify(error));
  } catch (e) {
    console.error('note_draft_start_blocked threw', leagueId, String(e)); // never masks the caller's outcome
  }
}

/**
 * Start this league's draft if it is due and nothing blocks it. Idempotent:
 * an already-started league is 'already_started', never a second start, and two
 * concurrent callers serialize on start_league_draft's row lock. Never throws.
 */
export async function startDraftIfDue(admin: Admin, leagueId: string, now: Date): Promise<StartOutcome> {
  // An error on a league that IS due: note it (back-off), then report it.
  const fail = async (reason: string): Promise<StartOutcome> => {
    await noteBlocked(admin, leagueId, `error:${reason}`, [{ code: `error:${reason}` }]);
    return { outcome: 'error', reason };
  };
  try {
    const { data: league, error: lgErr } = await admin
      .from('leagues')
      .select(START_LEAGUE_COLUMNS)
      .eq('id', leagueId)
      .maybeSingle();
    if (lgErr) return { outcome: 'error', reason: 'league_read_failed' }; // due-ness unknown: no note
    if (!league) return { outcome: 'error', reason: 'league_not_found' };
    if (league.draft_status === 'in_progress') return { outcome: 'already_started' };
    if (league.draft_status !== 'not_started') return { outcome: 'not_startable', draftStatus: String(league.draft_status) };

    // Never auto-start a TBD date, before draft_date, or past the grace.
    // (Judged before any other read: a not-due league costs one query.)
    if (!league.draft_date) return { outcome: 'not_due', blockers: [{ code: 'no_draft_date' }] };
    if (new Date(league.draft_date).getTime() > now.getTime()) {
      return { outcome: 'not_due', blockers: [{ code: 'draft_date_not_reached', draftDate: String(league.draft_date) }] };
    }
    if (isPastStartWindow(String(league.draft_date), now)) return { outcome: 'missed' };

    const { data: members, error: memErr } = await admin
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId);
    if (memErr) return await fail('members_read_failed');
    // A pending roster reconfirmation (#126, 20261107000000) blocks the start.
    // A failed read fails CLOSED, never "nothing owed".
    const { data: reconfirmRow, error: rcErr } = await admin
      .from('league_roster_reconfirm')
      .select('departed, members_before, choice')
      .eq('league_id', leagueId)
      .maybeSingle();
    if (rcErr) return await fail('reconfirm_read_failed');
    const memberCount = (members ?? []).length;
    const state = toStartState(league, memberCount, toRosterReconfirm(reconfirmRow));

    const slots = await loadSavedSlots(admin, leagueId);
    const blockers = await evaluateStartBlockers(admin, league, state, slots, now);
    // (Policy C would auto-fix here, before the verdict: draft-start-policy.ts.)
    if (blockers.length > 0) {
      await noteBlocked(admin, leagueId, blockers[0].code, blockers);
      return { outcome: 'blocked', reason: blockers[0].code, blockers };
    }

    const { data: res, error: startErr } = await admin.rpc('start_league_draft', {
      p_league_id: leagueId,
      p_expect: buildStartExpect(league, memberCount, slots!),
    });
    if (startErr) {
      console.error('start_league_draft failed', leagueId, JSON.stringify(startErr));
      return await fail('start_rpc_failed');
    }
    switch (res?.status) {
      case 'started':
        return { outcome: 'started' };
      case 'already_started':
        return res.draft_status === 'in_progress'
          ? { outcome: 'already_started' }
          : { outcome: 'not_startable', draftStatus: String(res.draft_status) };
      case 'not_due':
        return { outcome: 'not_due', blockers: [] };
      case 'missed':
        return { outcome: 'missed' };
      case 'changed':
        // Usually a concurrent edit (the next attempt sees it); a mismatch that
        // never clears would otherwise spin every tick, so it backs off too.
        console.error('start_league_draft: inputs changed since evaluation', leagueId, JSON.stringify(res.actual ?? null));
        await noteBlocked(admin, leagueId, 'changed', [{ code: 'changed' }]);
        return { outcome: 'changed' };
      case 'blocked': {
        // The SQL floor or a gate trigger (#126 roster_reconfirm_required, #94
        // renewal_replies_pending) refused under the lock.
        const reason = String(res.reason ?? 'blocked');
        const gate = [{ code: reason }];
        await noteBlocked(admin, leagueId, reason, gate);
        return { outcome: 'blocked', reason, blockers: gate };
      }
      default:
        console.error('start_league_draft: unexpected result', leagueId, JSON.stringify(res));
        return await fail('start_rpc_unexpected');
    }
  } catch (e) {
    console.error('startDraftIfDue failed', leagueId, String(e));
    return await fail('unhandled');
  }
}
