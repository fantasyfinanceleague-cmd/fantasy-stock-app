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
 * RACE BACKSTOP: every insert here names an explicit pick_number and relies
 * on the drafts (league_id, pick_number) unique index. A lost race surfaces as
 * 23505 -> 'pick_conflict'; the loser writes nothing and the caller re-derives
 * legality from fresh state. That is how a manual pick at 59.9s and an
 * auto-pick at 60s produce exactly ONE row: the first committed insert wins.
 */
import { fetchFillPrice } from './alpaca-price.ts';
import { fetchEligibleCategoryIds, fetchEligibleCategoryIdsBatch } from './category-eligibility.ts';
import { buildFinalizeArgs, planSeason, readFinalizeResult } from './schedule.ts';
import type { BotSymbolCandidate } from './bot-pick.ts';
import {
  type AutoPickCandidate,
  BEST_AVAILABLE_STRATEGY,
  type BestAvailableStrategy,
  decideNoPick,
  type DraftClock,
  openBrackets,
  parseDraftClockRow,
  type PickSource,
  planAutoPickCandidates,
  postgrestInList,
} from './auto-pick.ts';
import {
  computeDraftOrder,
  currentTurn,
  type LeagueRules,
  leagueOwnedSymbols,
  type PickRow,
  SKIP_SYMBOL,
  type Slot,
  type TradeRow,
  validatePick,
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
  | { ok: false; status: number; reason: 'unhandled' | 'league_not_found' };

/** League + members + picks + trades, service role. Status/membership checks
 * are the CALLER's (a cron sweep has no caller identity to check). */
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
      order: computeDraftOrder(String(league.commissioner_id ?? ''), memberIds),
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
  const statusError = complete ? await finalizeDraft(admin, ctx.league, ctx.memberIds) : null;
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
  memberIds: string[],
): Promise<string | null> {
  const plan = planSeason({
    leagueType: String(league.league_type ?? 'duration'),
    commissionerId: league.commissioner_id == null ? null : String(league.commissioner_id),
    memberIds,
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

/** Best-available pool: top-N per OPEN price bracket (openBrackets), never
 * including a symbol already owned in the league. Throws on read failure — a
 * failed pool read must not look like "nothing is legal" (which would skip). */
async function fetchBestAvailablePool(
  admin: Admin,
  strategy: BestAvailableStrategy,
  rules: LeagueRules,
  ctx: DraftContext,
  slots: Slot[],
  pickerId: string,
): Promise<BotSymbolCandidate[]> {
  const brackets = openBrackets(rules, slots, ctx.picks, ctx.trades, pickerId);
  const owned = leagueOwnedSymbols(ctx.picks, ctx.trades);
  const results = await Promise.all(brackets.map((b) => {
    let q = admin
      .from('symbols')
      .select(SYMBOL_COLUMNS)
      .not('last_price', 'is', null)
      .gt('last_price', 0)
      .order(strategy.poolOrderColumn, { ascending: false, nullsFirst: false })
      .limit(strategy.poolPerBracket);
    if (!rules.allowUndraftable) q = q.eq('is_draftable', true);
    if (b.min != null) q = q.gte('last_price', b.min);
    if (b.max != null) q = q.lte('last_price', b.max);
    if (owned.size > 0) q = q.not('symbol', 'in', postgrestInList(owned));
    return q;
  }));
  const pool = new Map<string, BotSymbolCandidate>();
  for (const { data, error } of results) {
    if (error) throw new Error('pool_fetch_failed');
    for (const row of data ?? []) {
      const c = toCandidate(row);
      if (!pool.has(c.symbol)) pool.set(c.symbol, c);
    }
  }
  return [...pool.values()];
}

/** The manager's queue in position order, with cached symbol rows. */
async function fetchQueue(
  admin: Admin,
  leagueId: string,
  userId: string,
): Promise<{ queue: string[]; meta: BotSymbolCandidate[] }> {
  const { data, error } = await admin
    .from('draft_queue')
    .select('symbol, position')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .order('position', { ascending: true });
  if (error) throw new Error('queue_fetch_failed');
  // deno-lint-ignore no-explicit-any
  const queue = (data ?? []).map((r: any) => String(r.symbol).toUpperCase());
  if (queue.length === 0) return { queue, meta: [] };
  const { data: rows, error: sErr } = await admin.from('symbols').select(SYMBOL_COLUMNS).in('symbol', queue);
  if (sErr) throw new Error('queue_fetch_failed');
  return { queue, meta: (rows ?? []).map(toCandidate) };
}

/**
 * Pick for whoever's turn it is NOW (never a caller-named target). Bots: best
 * available only, source 'bot', falling back to 'skip' (unchanged bot rules).
 * Humans: queue then best available (auto_queue / auto_best); auto_skip only
 * when nothing is legal — a vendor outage returns price_unavailable instead
 * (decideNoPick), leaving the turn open for the next attempt.
 *
 * `expectedPickNumber`: the pick the caller's gate authorized. If the draft
 * has moved on since (a manual pick landed between the gate's clock read and
 * this function's picks read), refuse with pick_conflict rather than picking
 * for the NEXT manager, whose clock has not expired.
 */
export async function autoPickTurn(
  admin: Admin,
  deps: AutoPickDeps,
  ctx: DraftContext,
  expectedPickNumber: number | null,
): Promise<AutoPickResult> {
  const turn = currentTurn(ctx.picks.length, ctx.order, ctx.numRounds);
  if (!turn) return { ok: false, reason: 'draft_complete' };
  if (expectedPickNumber != null && turn.pickNumber !== expectedPickNumber) {
    return { ok: false, reason: 'pick_conflict' };
  }
  const pickerId = turn.pickerId;
  const isBot = pickerId.startsWith('bot-');
  const strategy = deps.strategy ?? BEST_AVAILABLE_STRATEGY;
  const rules = leagueRules(ctx.league, ctx.numRounds);

  const { slots, error: slotsErrored } = await loadSlots(admin, ctx.league.id);
  if (slotsErrored) return { ok: false, reason: 'unhandled' };

  let planned: AutoPickCandidate[];
  const hasCategorySlots = slots.some((s) => s.categoryId != null);
  let eligibility: Map<string, Set<string>> | undefined;
  const isDraftableBySymbol = new Map<string, boolean>();
  try {
    const [q, pool] = await Promise.all([
      isBot ? Promise.resolve({ queue: [], meta: [] as BotSymbolCandidate[] }) : fetchQueue(admin, ctx.league.id, pickerId),
      fetchBestAvailablePool(admin, strategy, rules, ctx, slots, pickerId),
    ]);
    for (const c of [...q.meta, ...pool]) isDraftableBySymbol.set(c.symbol, c.isDraftable);
    if (hasCategorySlots) {
      eligibility = await fetchEligibleCategoryIdsBatch(admin, [...isDraftableBySymbol.keys()]);
    }
    planned = planAutoPickCandidates({
      isBot,
      rules,
      slots,
      picks: ctx.picks,
      trades: ctx.trades,
      pickerId,
      queue: q.queue,
      queueMeta: q.meta,
      pool,
      strategy,
      eligibility,
    });
  } catch (e) {
    console.error('auto-pick: candidate load failed', ctx.league.id, String(e));
    return { ok: false, reason: 'unhandled' };
  }

  let priced = 0;
  for (const cand of planned) {
    const fill = await fetchFillPrice(cand.symbol, deps.alpacaKey, deps.alpacaSecret);
    if (fill.price == null) {
      // Vendor detail is logged, never returned (it would leak app-key state).
      console.error('auto-pick: no_price', ctx.league.id, cand.symbol, JSON.stringify(fill.error));
      continue;
    }
    priced++;

    let eligibleCategories = new Set<string>();
    if (hasCategorySlots) {
      try {
        eligibleCategories = eligibility?.get(cand.symbol) ?? await fetchEligibleCategoryIds(admin, cand.symbol);
      } catch {
        return { ok: false, reason: 'unhandled' }; // never treat a read failure as "unclassified"
      }
    }

    const decision = validatePick({
      rules,
      slots,
      order: ctx.order,
      picks: ctx.picks,
      trades: ctx.trades,
      pickerId,
      symbol: cand.symbol,
      price: fill.price,
      eligibleCategories,
      isDraftable: isDraftableBySymbol.get(cand.symbol),
    });
    if (!decision.legal) continue;

    const { data: row, error: insErr } = await admin
      .from('drafts')
      .insert({
        league_id: ctx.league.id,
        user_id: pickerId,
        symbol: cand.symbol,
        entry_price: fill.price,
        quantity: decision.quantity,
        round: decision.round,
        pick_number: decision.pickNumber,
        slot_id: decision.slotId,
        pick_source: cand.source,
      })
      .select('*')
      .single();
    if (insErr) {
      // Someone else's write took this pick number first (a manual pick, a
      // client auto_pick, or another sweep). Stop — the winner's row stands.
      if ((insErr as { code?: string }).code === '23505') return { ok: false, reason: 'pick_conflict' };
      return { ok: false, reason: 'unhandled' };
    }
    const complete = decision.pickNumber >= ctx.order.length * ctx.numRounds;
    const statusError = complete ? await finalizeDraft(admin, ctx.league, ctx.memberIds) : null;
    console.log('auto-pick', ctx.league.id, decision.pickNumber, cand.source, cand.symbol, strategy.id);
    return { ok: true, pick: row, pickSource: cand.source, complete, statusError, priceSource: fill.source };
  }

  const none = decideNoPick(isBot, planned.length, priced);
  if (none.kind === 'retry_later') return { ok: false, reason: 'price_unavailable' };
  const skipped = await insertSkip(admin, ctx, pickerId, none.source);
  if (!skipped.ok) return { ok: false, reason: skipped.reason };
  console.log('auto-pick', ctx.league.id, skipped.pick?.pick_number, none.source, 'SKIP', strategy.id);
  return {
    ok: true,
    pick: skipped.pick,
    pickSource: none.source,
    complete: skipped.complete,
    statusError: skipped.statusError,
    priceSource: null,
  };
}
