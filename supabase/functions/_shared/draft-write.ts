/**
 * The ONE draft write path, shared by validate-and-record-pick (client picks,
 * skips, bot picks, auto-picks) and draft-autopick-sweep (the cron backstop
 * for the pick clock). Everything here does I/O; the decisions it makes are
 * delegated to the pure modules (draft-validation.ts, bot-pick.ts,
 * auto-pick.ts, schedule.ts) so they stay hermetically tested.
 *
 * loadSlots / insertSkip / finalizeDraft moved here VERBATIM from
 * validate-and-record-pick/index.ts (plus insertSkip's pick_source), so the
 * sweep cannot drift from the client path: a race loser, a finalize retry and
 * a skip mean the same thing whichever caller wrote them.
 *
 * ONE LEGALITY AUTHORITY: insertGatedPick is the only code in the repo that
 * inserts a non-SKIP drafts row, and it takes a GatedPick — which only
 * ./pick-gate.ts gatePick (= validatePick on the live price) can produce. A
 * structural test (supabase/tests/draft_insert_sites.test.ts) fails if any
 * other drafts insert, or any `as GatedPick` cast, appears.
 *
 * RACE BACKSTOP: every insert here names an explicit pick_number and relies
 * on the drafts (league_id, pick_number) unique index. A lost race surfaces as
 * 23505 -> 'pick_conflict'; the loser writes nothing and the caller re-derives
 * legality from fresh state. That is how a manual pick at 59.9s and an
 * auto-pick at 60s produce exactly ONE row: the first committed insert wins.
 */
import { fetchFillPrice } from './alpaca-price.ts';
import { fetchEligibleCategoryIdsBatch } from './category-eligibility.ts';
import { buildFinalizeArgs, planSeason, readFinalizeResult } from './schedule.ts';
import type { BotSymbolCandidate } from './bot-pick.ts';
import type { GatedPick } from './pick-gate.ts';
import {
  type AutoPickPorts,
  BEST_AVAILABLE_STRATEGY,
  type BestAvailableStrategy,
  chooseAutoPick,
  type DraftClock,
  parseDraftClockRow,
  type PickSource,
} from './auto-pick.ts';
import {
  checkStoredOrder,
  type DraftOrderRow,
  type LeagueRules,
  orderFromRows,
  type PickRow,
  SKIP_SYMBOL,
  type Slot,
  type TradeRow,
  validateSkip,
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
  'id, commissioner_id, num_rounds, draft_status, stake_mode, budget_amount, notional_per_slot, allow_undraftable, league_type, num_weeks, duration_days';

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

export type SkipResult =
  // deno-lint-ignore no-explicit-any
  | { ok: true; pick: any; complete: boolean; statusError: string | null }
  | { ok: false; reason: string };

// Shared SKIP-row insert + finalize-on-completion: the human 'skip' action,
// bot_pick's no-legal-candidate fallback, and the clock's auto_skip.
export async function insertSkip(
  admin: Admin,
  ctx: DraftContext,
  targetId: string,
  pickSource: Extract<PickSource, 'skip' | 'auto_skip'>,
): Promise<SkipResult> {
  const decision = validateSkip(targetId, ctx.order, ctx.picks.length, ctx.numRounds);
  if (!decision.legal) return { ok: false, reason: decision.reason };

  const { data: inserted, error: insErr } = await admin
    .from('drafts')
    .insert({
      league_id: ctx.league.id,
      user_id: targetId,
      symbol: SKIP_SYMBOL,
      entry_price: 0,
      quantity: 0,
      round: decision.round,
      pick_number: decision.pickNumber,
      pick_source: pickSource,
      // draft_date omitted: column is timestamp WITHOUT time zone with
      // DEFAULT now() — an ISO string's Z suffix would be silently stripped,
      // so the server default is the correct writer. recorded_at likewise.
    })
    .select('*')
    .single();
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') {
      return { ok: false, reason: 'pick_conflict' }; // race lost, client refetches + retries
    }
    return { ok: false, reason: 'unhandled' };
  }
  const complete = decision.pickNumber >= ctx.order.length * ctx.numRounds;
  const statusError = complete ? await finalizeDraft(admin, ctx.league, ctx.order) : null;
  return { ok: true, pick: inserted, complete, statusError };
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
  return { ok: true, row };
}

// ---------------------------------------------------------------------------
// Auto-pick (bots, and humans whose clock ran out)
// ---------------------------------------------------------------------------

export interface AutoPickDeps {
  alpacaKey: string;
  alpacaSecret: string;
  strategy?: BestAvailableStrategy;
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
    reason: 'pick_conflict' | 'price_unavailable' | 'draft_complete' | 'unhandled' | string;
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
      const { data: rows, error: sErr } = await admin.from('symbols').select(SYMBOL_COLUMNS).in('symbol', queue);
      if (sErr) throw new Error('queue_fetch_failed');
      return { queue, meta: (rows ?? []).map(toCandidate) };
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
 * the one gate) and write, for whoever's turn it is. Bots: best available,
 * source 'bot', falling back to 'skip'. Humans: auto_queue / auto_best, and
 * auto_skip only when nothing is legal; a vendor outage returns
 * price_unavailable, leaving the turn open.
 */
export async function autoPickTurn(
  admin: Admin,
  deps: AutoPickDeps,
  ctx: DraftContext,
  expectedPickNumber: number | null,
): Promise<AutoPickResult> {
  const strategy = deps.strategy ?? BEST_AVAILABLE_STRATEGY;
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
      supabaseAutoPickPorts(admin, String(ctx.league.id), deps),
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
    case 'retry_later':
      console.error('auto-pick: nothing priceable, turn left open', ctx.league.id, choice.attempts);
      return { ok: false, reason: 'price_unavailable' };
    case 'skip': {
      const skipped = await insertSkip(admin, ctx, choice.pickerId, choice.source);
      if (!skipped.ok) return { ok: false, reason: skipped.reason };
      console.log('auto-pick', ctx.league.id, skipped.pick?.pick_number, choice.source, choice.why, choice.attempts, strategy.id);
      return { ok: true, pick: skipped.pick, pickSource: choice.source, complete: skipped.complete, statusError: skipped.statusError, priceSource: null };
    }
    case 'pick': {
      const ins = await insertGatedPick(admin, choice.gated, choice.source);
      if (!ins.ok) return { ok: false, reason: ins.reason };
      const complete = choice.gated.pickNumber >= ctx.order.length * ctx.numRounds;
      const statusError = complete ? await finalizeDraft(admin, ctx.league, ctx.order) : null;
      console.log('auto-pick', ctx.league.id, choice.gated.pickNumber, choice.source, choice.gated.symbol, choice.attempts, strategy.id);
      return { ok: true, pick: ins.row, pickSource: choice.source, complete, statusError, priceSource: choice.priceSource };
    }
  }
}
