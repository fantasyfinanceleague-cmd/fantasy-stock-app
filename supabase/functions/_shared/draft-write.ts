/**
 * The ONE draft write path, shared by validate-and-record-pick (client picks,
 * skips, bot picks, auto-picks) and draft-autopick-sweep (the cron backstop
 * for the pick clock). Everything here does I/O; the decisions it makes are
 * delegated to the pure modules (draft-validation.ts, bot-pick.ts,
 * auto-pick.ts, schedule.ts) so they stay hermetically tested.
 *
 * loadSlots / finalizeDraft moved here VERBATIM from validate-and-record-pick/
 * index.ts, so the sweep cannot drift from the client path: a race loser and a
 * finalize retry mean the same thing whichever caller wrote them.
 *
 * ONE LEGALITY AUTHORITY: insertGatedPick is the only code in the repo that
 * inserts a drafts row, and it takes a GatedPick — which only ./pick-gate.ts
 * gatePick (= validatePick on the live price, plus the feasibility check) can
 * produce. A structural test (supabase/tests/draft_insert_sites.test.ts) fails
 * if any other drafts insert, or any `as GatedPick` cast, appears.
 *
 * NO SKIP (2026-10-05): nothing writes a SKIP row any more. When the search
 * finds no legal stock the turn STALLS: recordStall writes an alert row in
 * draft_stalls and pushes the commissioner, and the turn stays open.
 *
 * RACE BACKSTOP: every insert here names an explicit pick_number and relies
 * on the drafts (league_id, pick_number) unique index. A lost race surfaces as
 * 23505 -> 'pick_conflict'; the loser writes nothing and the caller re-derives
 * legality from fresh state. That is how a manual pick at 59.9s and an
 * auto-pick at 60s produce exactly ONE row: the first committed insert wins.
 *
 * YOUR-TURN PUSH (2026-10-06): commitGatedPick is the one post-insert step for
 * every pick (manual, bot, queue, best available; client or sweep). After a
 * recorded pick that leaves the draft open, it pushes the NEXT picker
 * (notifyNextPicker). A push failure is logged and never fails the pick.
 */
import { fetchFillPrice } from './alpaca-price.ts';
import { fetchEligibleCategoryIdsBatch } from './category-eligibility.ts';
import { buildFinalizeArgs, planSeason, readFinalizeResult } from './schedule.ts';
import type { BotSymbolCandidate } from './bot-pick.ts';
import type { GatedPick } from './pick-gate.ts';
import { getTargetToken, sendExpoPush } from './push.ts';
import { draftTurnMessage } from './push-copy.ts';
import {
  demandVector,
  type FeasibilityState,
  openInstances,
  type PoolGroup,
  typesFromSlots,
} from './draft-feasibility.ts';
import {
  type AutoPickPorts,
  BEST_AVAILABLE_STRATEGY,
  type BestAvailableStrategy,
  chooseAutoPick,
  type DraftClock,
  OUTAGE_ESCALATE_MS,
  outageEscalation,
  parseDraftClockRow,
  PRICE_COOLDOWN_MS,
  type PickSource,
} from './auto-pick.ts';
import {
  checkStoredOrder,
  currentTurn,
  type TurnState,
  type DraftOrderRow,
  type LeagueRules,
  leagueOwnedSymbols,
  orderFromRows,
  type PickRow,
  type Slot,
  type TradeRow,
} from './draft-validation.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface DraftContext {
  // deno-lint-ignore no-explicit-any
  league: any;
  memberIds: string[];
  order: string[];
  numRounds: number;
  picks: PickRow[];
  trades: TradeRow[];
}

export const LEAGUE_COLUMNS =
  'id, name, commissioner_id, num_rounds, draft_status, stake_mode, budget_amount, notional_per_slot, allow_undraftable, league_type, num_weeks, duration_days, playoff_teams';

export type LoadResult =
  | { ok: true; ctx: DraftContext }
  | { ok: false; status: number; reason: 'unhandled' | 'league_not_found' | 'draft_order_invalid' };

/** League + members + STORED draft order + picks + trades, service role.
 * Status/membership checks are the CALLER's (a cron sweep has no caller
 * identity to check).
 *
 * The order comes from league_draft_order (20261013000000). Once the draft has
 * started it MUST be an exact permutation of the members (the start trigger
 * locks it so); anything else refuses with 'draft_order_invalid' (500) rather
 * than guessing, because turn math over a wrong order silently skips or
 * invents a picker. Before start the order may legitimately not exist yet
 * (random mode before draft_date - 1h), and no caller does turn math then. */
export async function loadDraftContext(admin: Admin, leagueId: string): Promise<LoadResult> {
  const { data: league, error: lgErr } = await admin
    .from('leagues').select(LEAGUE_COLUMNS).eq('id', leagueId).maybeSingle();
  if (lgErr) return { ok: false, status: 500, reason: 'unhandled' };
  if (!league) return { ok: false, status: 404, reason: 'league_not_found' };

  const { data: members, error: memErr } = await admin
    .from('league_members').select('user_id').eq('league_id', leagueId);
  if (memErr) return { ok: false, status: 500, reason: 'unhandled' };
  // deno-lint-ignore no-explicit-any
  const memberIds = (members ?? []).map((m: any) => String(m.user_id));

  const { data: orderData, error: oErr } = await admin
    .from('league_draft_order')
    .select('position, user_id')
    .eq('league_id', leagueId)
    .order('position', { ascending: true });
  if (oErr) return { ok: false, status: 500, reason: 'unhandled' };
  const order = orderFromRows((orderData ?? []) as DraftOrderRow[]);
  if ((league.draft_status ?? 'not_started') !== 'not_started') {
    const check = checkStoredOrder(order, memberIds);
    if (!check.ok) {
      console.error('draft order invalid', leagueId, check.reason, order.length, memberIds.length);
      return { ok: false, status: 500, reason: 'draft_order_invalid' };
    }
  }

  const { data: pickData, error: pErr } = await admin
    .from('drafts')
    .select('user_id, symbol, entry_price, quantity, pick_number, slot_id')
    .eq('league_id', leagueId)
    .order('pick_number', { ascending: true });
  if (pErr) return { ok: false, status: 500, reason: 'unhandled' };

  // Trades should not exist mid-draft, but the ownership check must not
  // assume that — a re-drafting league could carry ledger history.
  const { data: tradeData, error: tErr } = await admin
    .from('trades').select('user_id, symbol, action, quantity, price').eq('league_id', leagueId);
  if (tErr) return { ok: false, status: 500, reason: 'unhandled' };

  return {
    ok: true,
    ctx: {
      league,
      memberIds,
      order,
      numRounds: Number(league.num_rounds) || 6,
      picks: (pickData ?? []) as PickRow[],
      // deno-lint-ignore no-explicit-any
      trades: (tradeData ?? []).map((t: any) => ({ ...t, user_id: String(t.user_id) })) as TradeRow[],
    },
  };
}

export function isDraftFull(ctx: DraftContext): boolean {
  return ctx.order.length > 0 && ctx.picks.length >= ctx.order.length * ctx.numRounds;
}

// deno-lint-ignore no-explicit-any
export function leagueRules(league: any, numRounds: number): LeagueRules {
  return {
    stakeMode: (league.stake_mode ?? null) as LeagueRules['stakeMode'],
    budgetAmount: league.budget_amount == null ? null : Number(league.budget_amount),
    notionalPerSlot: league.notional_per_slot == null ? null : Number(league.notional_per_slot),
    numRounds,
    allowUndraftable: league.allow_undraftable === true,
  };
}

/** public.get_draft_clock via the service role — THE deadline definition,
 * judged on the DB clock. Destructure-and-check: .rpc() does not throw on a
 * Postgres error (CLAUDE.md success signals #5). */
export async function fetchDraftClock(admin: Admin, leagueId: string): Promise<DraftClock | null> {
  const { data, error } = await admin.rpc('get_draft_clock', { p_league_id: leagueId });
  if (error) {
    console.error('get_draft_clock failed', leagueId, JSON.stringify(error));
    return null;
  }
  return parseDraftClockRow(Array.isArray(data) ? data[0] : data);
}

// ---------------------------------------------------------------------------
// Moved verbatim from validate-and-record-pick
// ---------------------------------------------------------------------------

export async function loadSlots(
  admin: Admin,
  leagueId: string,
): Promise<{ slots: Slot[]; error: boolean }> {
  const { data: slotData, error: sErr } = await admin
    .from('league_draft_slots')
    .select('id, slot_index, slot_count, price_min, price_max, category_id')
    .eq('league_id', leagueId)
    .order('slot_index', { ascending: true });
  if (sErr) return { slots: [], error: true };
  const slots: Slot[] = (slotData ?? []).map((s: Record<string, unknown>) => ({
    id: String(s.id),
    slotIndex: Number(s.slot_index),
    slotCount: Number(s.slot_count),
    priceMin: s.price_min == null ? null : Number(s.price_min),
    priceMax: s.price_max == null ? null : Number(s.price_max),
    categoryId: s.category_id == null ? null : String(s.category_id),
  }));
  return { slots, error: false };
}

const FINALIZE_ATTEMPTS = 3;

// Plan the season and write it (plus the draft_status flip) in one RPC
// transaction. Returns an error string (surfaced to the caller as
// status_update_error) or null on success.
//
// Destructure-and-check per CLAUDE.md: .rpc() does NOT throw on a Postgres
// error, and a resolved call can still be a refusal — readFinalizeResult checks
// both. Transport/SQL errors are retried in-request (the RPC is idempotent, so
// a retry after a lost response reads 'already_finalized'); refusals are not,
// since the same inputs would be refused again — they need a human, and the
// stuck-draft detector in docs/STATUS.md §7 surfaces them.
export async function finalizeDraft(
  admin: Admin,
  // deno-lint-ignore no-explicit-any
  league: any,
  order: string[], // the stored draft order (DraftContext.order): the season roster
): Promise<string | null> {
  const plan = planSeason({
    leagueType: String(league.league_type ?? 'duration'),
    order,
    numWeeks: league.num_weeks == null ? null : Number(league.num_weeks),
    playoffTeams: league.playoff_teams == null ? null : Number(league.playoff_teams),
    durationDays: league.duration_days == null ? null : Number(league.duration_days),
    now: new Date(),
  });
  if (!plan.ok) {
    console.error('finalize: plan refused', league.id, plan.reason);
    return `schedule_plan_refused:${plan.reason}`;
  }

  const args = buildFinalizeArgs(String(league.id), plan);
  let lastError = 'finalize_rpc_error';
  for (let attempt = 1; attempt <= FINALIZE_ATTEMPTS; attempt++) {
    const { data, error } = await admin.rpc('finalize_league_draft', args);
    const outcome = readFinalizeResult({ data, error });
    if (outcome.ok) return null;
    // Log the SQL error server-side only; the client gets the stable code.
    console.error('finalize: attempt', attempt, league.id, outcome.error, error ? JSON.stringify(error) : '');
    lastError = outcome.error;
    if (!outcome.retryable) break;
    if (attempt < FINALIZE_ATTEMPTS) await new Promise((r) => setTimeout(r, 250 * attempt));
  }
  return lastError;
}

// ---------------------------------------------------------------------------
// Feasibility (2026-10-05): the pool and the league's open demand, read fresh
// ---------------------------------------------------------------------------

/** public.draft_feasibility_pool — the SQL twin of draft-feasibility.ts
 * buildPoolGroups. THROWS on a read failure: the caller fails closed (a pick
 * is not gated without its feasibility state). Numeric arrays come back as
 * strings from PostgREST, so every element is coerced. */
export async function poolGroups(
  admin: Admin,
  types: Slot[],
  exclude: string[],
  draftableOnly: boolean,
  depth: number,
): Promise<PoolGroup[]> {
  const { data, error } = await admin.rpc('draft_feasibility_pool', {
    p_types: types.map((t, j) => ({ ordinal: j, price_min: t.priceMin, price_max: t.priceMax, category_id: t.categoryId })),
    p_draftable_only: draftableOnly,
    p_exclude: exclude.map((x) => x.toUpperCase()),
    p_depth: depth,
  });
  if (error) {
    console.error('draft_feasibility_pool failed', JSON.stringify(error));
    throw new Error('feasibility_pool_failed');
  }
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((r: any) => ({
    ordinals: (r.ordinals ?? []).map(Number),
    n: Number(r.n),
    prices: (r.prices ?? []).map(Number),
  }));
}

/** The feasibility state for the league NOW, and the picker's open instances.
 * Used by the manual pick path; the auto-pick search reads its own copy. */
export async function loadFeasibility(
  admin: Admin,
  ctx: DraftContext,
  slots: Slot[],
  pickerId: string,
): Promise<{ state: FeasibilityState; open: number[] }> {
  const rules = leagueRules(ctx.league, ctx.numRounds);
  const types = typesFromSlots(slots, ctx.numRounds);
  const demand = demandVector(types, ctx.order, ctx.picks, ctx.numRounds);
  const total = demand.reduce((a, b) => a + b, 0);
  const groups = await poolGroups(
    admin,
    types,
    [...leagueOwnedSymbols(ctx.picks, ctx.trades)],
    rules.allowUndraftable !== true,
    total + 1,
  );
  const budget = rules.stakeMode === 'budget_cap' ? Number(rules.budgetAmount) || 0 : null;
  return {
    state: { types, demand, groups, budget },
    open: openInstances(types, ctx.picks, pickerId, ctx.numRounds),
  };
}

/**
 * A turn with no legal stock STALLS (2026-10-05, no SKIP). Records it once in
 * draft_stalls (the in-app record; a repeat only refreshes attempts and
 * last_seen_at) and pushes the commissioner on the FIRST stall. Logged loudly.
 * Never throws: a failed record must not turn a stall into a 500, and the turn
 * stays open either way.
 */
export async function recordStall(
  admin: Admin,
  ctx: DraftContext,
  pickNumber: number,
  pickerId: string,
  why: string,
  attempts: number,
): Promise<void> {
  const leagueId = String(ctx.league.id);
  const { error } = await admin.from('draft_stalls').insert({
    league_id: leagueId,
    pick_number: pickNumber,
    picker_id: pickerId,
    reason: why,
    attempts,
  });
  if (error) {
    if ((error as { code?: string }).code !== '23505') {
      // No record means no dedupe, so alert anyway: a stall must never be silent.
      console.error('[draft-stall] record failed', leagueId, pickNumber, JSON.stringify(error));
      await pushStallToCommissioner(admin, ctx, pickNumber);
      return;
    }
    // Read the prior reason first: an escalated outage overwritten by a legality
    // stall is a NEW claim the commissioner has not been told (review finding 6).
    const prior = await admin
      .from('draft_stalls').select('reason').eq('league_id', leagueId).eq('pick_number', pickNumber).maybeSingle();
    const wasOutage = prior.data?.reason === 'vendor_outage';
    const { error: updErr } = await admin
      .from('draft_stalls')
      .update({ attempts, reason: why, last_seen_at: new Date().toISOString() })
      .eq('league_id', leagueId)
      .eq('pick_number', pickNumber);
    if (updErr) console.error('[draft-stall] refresh failed', leagueId, pickNumber, JSON.stringify(updErr));
    if (wasOutage && !updErr) await pushStallToCommissioner(admin, ctx, pickNumber, 'nothing_legal');
    return;
  }
  console.error('[draft-stall]', leagueId, pickNumber, why, attempts);
  await pushStallToCommissioner(admin, ctx, pickNumber);
}

/** Copy is placeholder pending the Design Lead (CLAUDE.md: no user-facing copy
 * invented here). Commissioner only. Each kind says ONLY what was established:
 * 'nothing_legal' = the pool was walked and nothing is legal; 'vendor_outage' =
 * prices are unavailable right now, the turn stays open. Returns whether the push
 * was sent (the caller decides whether the escalation is marked done). */
async function pushStallToCommissioner(
  admin: Admin,
  ctx: DraftContext,
  pickNumber: number,
  kind: 'nothing_legal' | 'vendor_outage' = 'nothing_legal',
): Promise<boolean> {
  const leagueId = String(ctx.league.id);
  const commissionerId = String(ctx.league.commissioner_id ?? '');
  if (!commissionerId) return false;
  const target = await getTargetToken(admin, commissionerId);
  if (!target.token || !target.enabled) return false;
  const copy = kind === 'vendor_outage'
    ? {
      title: 'Auto-pick is waiting on prices',
      body: `Live prices are unavailable for pick ${pickNumber}. The turn stays open and retries.`,
      type: 'draft_outage',
    }
    : {
      title: 'Auto-pick needs you',
      body: `No legal stock fits pick ${pickNumber}. Pick manually to keep the draft moving.`,
      type: 'draft_stall',
    };
  const sent = await sendExpoPush(target.token, {
    title: copy.title,
    body: copy.body,
    data: { type: copy.type, league_id: leagueId, pick_number: pickNumber },
  });
  if (!sent.sent) {
    console.error('[draft-stall] push not sent', leagueId, pickNumber, kind, sent.reason);
    return false;
  }
  return true;
}

/**
 * A turn stopped only by vendor outages (2026-10-05). The first outage on a turn
 * starts its clock; once it has lasted OUTAGE_ESCALATE_MS the turn is escalated
 * ONCE: a draft_stalls row with reason 'vendor_outage' (members see "Paused") and
 * one commissioner push. Until then, and after, it keeps retrying. Recovery
 * (the turn is filled) clears both rows in insertGatedPick.
 */
export async function noteOutage(admin: Admin, ctx: DraftContext, pickNumber: number, pickerId: string): Promise<void> {
  const leagueId = String(ctx.league.id);
  const nowIso = new Date().toISOString();
  const ins = await admin.from('draft_turn_outages').insert({
    league_id: leagueId,
    pick_number: pickNumber,
    first_seen_at: nowIso,
    last_seen_at: nowIso,
  });
  let firstSeen = nowIso;
  let escalatedAt: string | null = null;
  if (ins.error) {
    if ((ins.error as { code?: string }).code !== '23505') {
      console.error('[outage] record failed', leagueId, pickNumber, JSON.stringify(ins.error));
      return;
    }
    const upd = await admin
      .from('draft_turn_outages')
      .update({ last_seen_at: nowIso })
      .eq('league_id', leagueId)
      .eq('pick_number', pickNumber)
      .select('first_seen_at, escalated_at')
      .maybeSingle();
    if (upd.error || !upd.data) {
      console.error('[outage] refresh failed', leagueId, pickNumber, JSON.stringify(upd.error ?? 'no row'));
      return;
    }
    firstSeen = String(upd.data.first_seen_at);
    escalatedAt = upd.data.escalated_at == null ? null : String(upd.data.escalated_at);
  }
  if (outageEscalation(Date.parse(firstSeen), Date.now(), escalatedAt != null, OUTAGE_ESCALATE_MS) !== 'escalate') return;

  // At-least-once push: the row (PK dedupes it) is written first, the push is sent,
  // and ONLY a sent push marks the escalation done. A failed push is retried on the
  // next tick, because escalated_at is still null (review finding 3).
  const st = await admin.from('draft_stalls').insert({
    league_id: leagueId,
    pick_number: pickNumber,
    picker_id: pickerId,
    reason: 'vendor_outage',
    attempts: 0,
  });
  if (st.error && (st.error as { code?: string }).code !== '23505') {
    console.error('[outage] escalation record failed', leagueId, pickNumber, JSON.stringify(st.error));
    return;
  }
  const sent = await pushStallToCommissioner(admin, ctx, pickNumber, 'vendor_outage');
  if (!sent) return;
  const { error: markErr } = await admin
    .from('draft_turn_outages').update({ escalated_at: nowIso }).eq('league_id', leagueId).eq('pick_number', pickNumber);
  if (markErr) console.error('[outage] escalation mark failed', leagueId, pickNumber, JSON.stringify(markErr));
  console.error('[outage] escalated', leagueId, pickNumber);
}

/** Stall retry cooldown (review finding: a looping bot_pick must not re-run the
 * full search, and its Alpaca calls, every request). A stall recorded less than
 * STALL_COOLDOWN_MS ago short-circuits to 'stalled'. Read errors fail CLOSED. */
export const STALL_COOLDOWN_MS = 60_000;
export async function recentStall(admin: Admin, leagueId: string, pickNumber: number): Promise<{ recent: boolean; error: boolean }> {
  const { data, error } = await admin
    .from('draft_stalls')
    .select('last_seen_at, reason')
    .eq('league_id', leagueId)
    .eq('pick_number', pickNumber)
    .maybeSingle();
  if (error) {
    console.error('[draft-stall] cooldown read failed', leagueId, pickNumber, JSON.stringify(error));
    return { recent: false, error: true };
  }
  // A vendor_outage row is not a legality stall: it must never short-circuit the search.
  if (!data?.last_seen_at || data.reason === 'vendor_outage') return { recent: false, error: false };
  return { recent: Date.now() - Date.parse(String(data.last_seen_at)) < STALL_COOLDOWN_MS, error: false };
}

// ---------------------------------------------------------------------------
// The one pick write
// ---------------------------------------------------------------------------

export type InsertResult =
  // deno-lint-ignore no-explicit-any
  | { ok: true; row: any }
  | { ok: false; reason: 'pick_conflict' | 'unhandled' };

/**
 * Write a pick that passed the legality gate. Takes a GatedPick, never a
 * symbol: there is no way to reach this insert with a pick validatePick
 * refused. (league_id comes from the gated pick itself, so a pick gated for
 * one league cannot be written into another.)
 */
export async function insertGatedPick(admin: Admin, pick: GatedPick, pickSource: PickSource): Promise<InsertResult> {
  const { data: row, error: insErr } = await admin
    .from('drafts')
    .insert({
      league_id: pick.leagueId,
      user_id: pick.pickerId,
      symbol: pick.symbol,
      entry_price: pick.price,
      quantity: pick.quantity,
      round: pick.round,
      pick_number: pick.pickNumber,
      slot_id: pick.slotId,
      pick_source: pickSource,
      // draft_date / recorded_at / created_at omitted: server defaults.
    })
    .select('*')
    .single();
  if (insErr) {
    // Unique (league_id, pick_number) index = the race backstop: a concurrent
    // pick, auto-pick or sweep got this number first. Nothing was written.
    if ((insErr as { code?: string }).code === '23505') return { ok: false, reason: 'pick_conflict' };
    return { ok: false, reason: 'unhandled' };
  }
  // The turn is filled: any stall or outage row for this pick_number is resolved history.
  const { error: clearErr } = await admin
    .from('draft_stalls').delete().eq('league_id', pick.leagueId).eq('pick_number', pick.pickNumber);
  if (clearErr) console.error('[draft-stall] clear failed', pick.leagueId, pick.pickNumber, JSON.stringify(clearErr));
  const { error: outErr } = await admin
    .from('draft_turn_outages').delete().eq('league_id', pick.leagueId).eq('pick_number', pick.pickNumber);
  if (outErr) console.error('[outage] clear failed', pick.leagueId, pick.pickNumber, JSON.stringify(outErr));
  return { ok: true, row };
}

// ---------------------------------------------------------------------------
// After the write: finalize, or push the next picker
// ---------------------------------------------------------------------------

/** The push I/O, injectable so the turn push is hermetically testable. */
export interface TurnPushPorts {
  getTargetToken: typeof getTargetToken;
  sendExpoPush: typeof sendExpoPush;
}
export const REAL_TURN_PUSH: TurnPushPorts = { getTargetToken, sendExpoPush };

export type TurnPushOutcome =
  | 'sent'
  | 'draft_complete'
  | 'same_picker'
  | 'bot'
  | 'no_token'
  | 'disabled'
  | 'lookup_failed'
  | 'send_failed'
  | 'error';

/** Who picks after pick `pickNumber` was recorded: the same snake math as the
 * turn check (currentTurn over pickNumber picks made). Null = draft complete. */
export function nextTurnAfter(pickNumber: number, order: string[], numRounds: number): TurnState | null {
  return currentTurn(pickNumber, order, numRounds);
}

/**
 * Push "It's your turn" to whoever picks after `filled`. NEVER throws and never
 * reports into the pick result: the pick is already committed, and a push is
 * best effort on top of it (the room's realtime update is the other signal).
 *
 * Skipped, not failed: draft complete; a snake turnaround where the manager
 * who just picked MANUALLY picks again (they are in the room; the legacy
 * client skipped the same case); bots (no device; `bot-` ids are not uuids,
 * so a token lookup would only log an error). An AUTO pick followed by the
 * same manager's turn still pushes: their clock just ran out, so they are away.
 */
export async function notifyNextPicker(
  admin: Admin,
  ctx: DraftContext,
  filled: { pickNumber: number; pickerId: string },
  pickSource: PickSource,
  push: TurnPushPorts = REAL_TURN_PUSH,
): Promise<TurnPushOutcome> {
  const leagueId = String(ctx.league.id);
  try {
    const next = nextTurnAfter(filled.pickNumber, ctx.order, ctx.numRounds);
    if (!next) return 'draft_complete';
    if (pickSource === 'manual' && next.pickerId === filled.pickerId) return 'same_picker';
    if (next.pickerId.startsWith('bot-')) return 'bot';
    const target = await push.getTargetToken(admin, next.pickerId);
    if (target.lookupFailed) {
      console.error('[turn-push] token lookup failed', leagueId, next.pickNumber);
      return 'lookup_failed';
    }
    if (!target.token) return 'no_token';
    if (!target.enabled) return 'disabled';
    // League name from the leagues row loadDraftContext read: never caller input.
    const sent = await push.sendExpoPush(target.token, draftTurnMessage(String(ctx.league.name)));
    if (!sent.sent) {
      console.error('[turn-push] push not sent', leagueId, next.pickNumber, sent.reason);
      return 'send_failed';
    }
    return 'sent';
  } catch (e) {
    console.error('[turn-push] failed', leagueId, filled.pickNumber, String(e));
    return 'error';
  }
}

export type CommitResult =
  // deno-lint-ignore no-explicit-any
  | { ok: true; row: any; complete: boolean; statusError: string | null; turnPush: TurnPushOutcome | null }
  | { ok: false; reason: 'pick_conflict' | 'unhandled' };

/**
 * Write a gated pick, then EITHER finalize (it was the last pick) OR push the
 * next picker. The single post-pick path for the manual route and autoPickTurn,
 * so every recorded pick (human or auto, client or sweep) is followed by the
 * same step. A race loser wrote nothing and pushes nobody.
 */
export async function commitGatedPick(
  admin: Admin,
  ctx: DraftContext,
  pick: GatedPick,
  pickSource: PickSource,
  push: TurnPushPorts = REAL_TURN_PUSH,
): Promise<CommitResult> {
  const ins = await insertGatedPick(admin, pick, pickSource);
  if (!ins.ok) return ins;
  const complete = pick.pickNumber >= ctx.order.length * ctx.numRounds;
  const statusError = complete ? await finalizeDraft(admin, ctx.league, ctx.order) : null;
  const turnPush = complete ? null : await notifyNextPicker(admin, ctx, pick, pickSource, push);
  return { ok: true, row: ins.row, complete, statusError, turnPush };
}

// ---------------------------------------------------------------------------
// Auto-pick (bots, and humans whose clock ran out)
// ---------------------------------------------------------------------------

export interface AutoPickDeps {
  alpacaKey: string;
  alpacaSecret: string;
  strategy?: BestAvailableStrategy;
  /** Test seams: the search's I/O and the turn push. Default to the real ones. */
  ports?: AutoPickPorts;
  turnPush?: TurnPushPorts;
}

export type AutoPickResult =
  | {
    ok: true;
    // deno-lint-ignore no-explicit-any
    pick: any;
    pickSource: PickSource;
    complete: boolean;
    statusError: string | null;
    priceSource: string | null;
  }
  | {
    ok: false;
    reason: 'pick_conflict' | 'price_unavailable' | 'draft_complete' | 'stalled' | 'unhandled' | string;
  };

const SYMBOL_COLUMNS = 'symbol, last_price, is_draftable, market_cap';

// deno-lint-ignore no-explicit-any
function toCandidate(s: any): BotSymbolCandidate {
  return {
    symbol: String(s.symbol).toUpperCase(),
    lastPrice: s.last_price == null ? null : Number(s.last_price),
    isDraftable: s.is_draftable === true,
    marketCap: s.market_cap == null ? null : Number(s.market_cap),
  };
}

/** The real I/O behind chooseAutoPick. Every port THROWS on a read failure:
 * a failed read must never look like "nothing legal" (which would skip). */
export function supabaseAutoPickPorts(admin: Admin, leagueId: string, deps: AutoPickDeps): AutoPickPorts {
  return {
    async loadSlots() {
      const { slots, error } = await loadSlots(admin, leagueId);
      if (error) throw new Error('slots_fetch_failed');
      return slots;
    },
    async loadQueue(pickerId) {
      const { data, error } = await admin
        .from('draft_queue')
        .select('symbol, position')
        .eq('league_id', leagueId)
        .eq('user_id', pickerId)
        .order('position', { ascending: true });
      if (error) throw new Error('queue_fetch_failed');
      // deno-lint-ignore no-explicit-any
      const queue = (data ?? []).map((r: any) => String(r.symbol).toUpperCase());
      if (queue.length === 0) return { queue, meta: [] };
      const { data: rows, error: sErr } = await admin
        .from('symbols').select(`${SYMBOL_COLUMNS}, active, price_unsupported`).in('symbol', queue);
      if (sErr) throw new Error('queue_fetch_failed');
      // The same catalog filters the search RPC applies: an inactive or
      // Alpaca-unsupported queued symbol is never a live candidate.
      // deno-lint-ignore no-explicit-any
      const usable = (rows ?? []).filter((r: any) => r.active !== false && r.price_unsupported !== true);
      return { queue, meta: usable.map(toCandidate) };
    },
    async searchCandidates(spec, exclude, draftableOnly, limit) {
      const { data, error } = await admin.rpc('auto_pick_search_candidates', {
        p_min: spec.min,
        p_max: spec.max,
        p_category_id: spec.categoryId,
        p_draftable_only: draftableOnly,
        p_exclude: exclude.map((x) => x.toUpperCase()),
        p_limit: limit,
      });
      if (error) {
        console.error('auto_pick_search_candidates failed', leagueId, JSON.stringify(error));
        throw new Error('search_failed');
      }
      return (data ?? []).map(toCandidate);
    },
    eligibility: (symbols) => fetchEligibleCategoryIdsBatch(admin, symbols),
    async coolingSymbols(symbols) {
      const wanted = symbols.map((x) => x.toUpperCase());
      if (wanted.length === 0) return new Set<string>();
      // Scoped to THIS league: one league's member cannot cool a symbol for others.
      const { data, error } = await admin
        .from('auto_pick_price_failures').select('symbol, failed_at')
        .eq('league_id', leagueId).in('symbol', wanted);
      if (error) throw new Error('price_failures_fetch_failed'); // fail closed
      const now = Date.now();
      // deno-lint-ignore no-explicit-any
      return new Set((data ?? []).filter((r: any) => now - Date.parse(String(r.failed_at)) < PRICE_COOLDOWN_MS).map((r: any) => String(r.symbol).toUpperCase()));
    },
    async recordPriceFailure(symbol) {
      const { error } = await admin
        .from('auto_pick_price_failures')
        .upsert({ league_id: leagueId, symbol, failed_at: new Date().toISOString() }, { onConflict: 'league_id,symbol' });
      if (error) console.error('auto-pick: price-failure record failed', symbol, JSON.stringify(error));
    },
    async clearPriceFailure(symbol) {
      const { error } = await admin.from('auto_pick_price_failures').delete().eq('league_id', leagueId).eq('symbol', symbol);
      if (error) console.error('auto-pick: price-failure clear failed', symbol, JSON.stringify(error));
    },
    async recordLivePrice(symbol, price) {
      // Best effort: a failed cache write must not fail the pick. It only means
      // the symbol is judged again next call (one more live call), never wrongly.
      const { error } = await admin.from('symbols').update({ last_price: price }).eq('symbol', symbol);
      if (error) console.error('auto-pick: last_price write-back failed', symbol, JSON.stringify(error));
    },
    feasibilityPool: (types, exclude, draftableOnly, depth) => poolGroups(admin, types, exclude, draftableOnly, depth),
    async livePrice(symbol) {
      const fill = await fetchFillPrice(symbol, deps.alpacaKey, deps.alpacaSecret);
      if (fill.price == null) {
        // Vendor detail is logged, never returned (it would leak app-key state).
        console.error('auto-pick: no_price', leagueId, symbol, JSON.stringify(fill.error));
      }
      return { price: fill.price, source: fill.source ?? null };
    },
  };
}

/**
 * Choose (chooseAutoPick: queue, then best available, every candidate through
 * the one gate) and write, for whoever's turn it is. Bots and humans alike:
 * 'bot' / auto_queue / auto_best. Nothing legal -> 'stalled' (recorded, turn
 * stays open, never a SKIP); a vendor outage -> price_unavailable (turn open).
 */
export async function autoPickTurn(
  admin: Admin,
  deps: AutoPickDeps,
  ctx: DraftContext,
  expectedPickNumber: number | null,
): Promise<AutoPickResult> {
  const strategy = deps.strategy ?? BEST_AVAILABLE_STRATEGY;
  const turn = currentTurn(ctx.picks.length, ctx.order, ctx.numRounds);
  if (turn) {
    const cool = await recentStall(admin, String(ctx.league.id), turn.pickNumber);
    if (cool.error) return { ok: false, reason: 'unhandled' };
    if (cool.recent) return { ok: false, reason: 'stalled' };
  }
  let choice;
  try {
    choice = await chooseAutoPick(
      {
        leagueId: String(ctx.league.id),
        rules: leagueRules(ctx.league, ctx.numRounds),
        order: ctx.order,
        numRounds: ctx.numRounds,
        picks: ctx.picks,
        trades: ctx.trades,
      },
      deps.ports ?? supabaseAutoPickPorts(admin, String(ctx.league.id), deps),
      expectedPickNumber,
      strategy,
    );
  } catch (e) {
    console.error('auto-pick: search failed', ctx.league.id, String(e));
    return { ok: false, reason: 'unhandled' };
  }

  switch (choice.kind) {
    case 'draft_complete':
      return { ok: false, reason: 'draft_complete' };
    case 'conflict':
      return { ok: false, reason: 'pick_conflict' };
    case 'retry_later': {
      console.error('auto-pick: nothing priceable, turn left open', ctx.league.id, choice.attempts, choice.outage);
      if (choice.outage) {
        const turn = currentTurn(ctx.picks.length, ctx.order, ctx.numRounds);
        // Never throws into the pick path: the turn stays open either way.
        try {
          if (turn) await noteOutage(admin, ctx, turn.pickNumber, turn.pickerId);
        } catch (e) {
          console.error('[outage] note failed', ctx.league.id, String(e));
        }
      }
      return { ok: false, reason: 'price_unavailable' };
    }
    case 'stalled': {
      const pickNumber = currentTurn(ctx.picks.length, ctx.order, ctx.numRounds)?.pickNumber ?? ctx.picks.length + 1;
      await recordStall(admin, ctx, pickNumber, choice.pickerId, choice.why, choice.attempts);
      return { ok: false, reason: 'stalled' };
    }
    case 'pick': {
      const res = await commitGatedPick(admin, ctx, choice.gated, choice.source, deps.turnPush);
      if (!res.ok) return { ok: false, reason: res.reason };
      console.log('auto-pick', ctx.league.id, choice.gated.pickNumber, choice.source, choice.gated.symbol, choice.attempts, strategy.id, res.turnPush);
      return { ok: true, pick: res.row, pickSource: choice.source, complete: res.complete, statusError: res.statusError, priceSource: choice.priceSource };
    }
  }
}
