// record-trade's write path: validate in TS, compare-and-swap in SQL.
//
// The game rules live ONCE, in ../_shared/draft-validation.ts. This module
// does not re-implement any of them; it makes them hold under concurrency.
// Each attempt reads the league-scoped state, runs the validator, re-checks
// market hours, and hands the decision to record_trade_atomic together with
// an EXPECTATION: the exact trades/drafts id sets and (for a buy) the league
// rules and slot rows the validator read. The RPC takes a league-wide lock,
// compares, and inserts only if nothing moved — otherwise it returns
// ledger_changed and we go round again, so the request that lost a race
// re-validates against the winner's row and gets the CORRECT game refusal
// (a double sell -> not_owned, a double buy -> symbol_owned, a double
// skipped-slot buy -> no_proceeds). Only when every attempt loses does it
// return trade_conflict. Why the lock and the CAS live in SQL, and what the
// CAS deliberately does not cover: the header of
// supabase/migrations/20261102000000_record_trade_atomic.sql.
//
// Pure: no supabase-js, no Deno.env. index.ts wires the real reads/RPC in,
// the hermetic tests wire fakes, and the PGlite test wires real Postgres.
import {
  decideBuySlot,
  describeSlots,
  type LeagueRules,
  type PickRow,
  type Slot,
  type TradeRow,
  userSlotOccupancy,
  validateTradeAdd,
  validateTradeDrop,
} from '../_shared/draft-validation.ts';

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export type Step<T> = { ok: true; value: T } | { ok: false; reply: Reply };

export const unhandled = (): Reply => ({ status: 500, body: { ok: false, reason: 'unhandled' } });

// ---------------------------------------------------------------------------
// Paginated reads
// ---------------------------------------------------------------------------

export interface Page<T> {
  data: T[] | null;
  error: unknown;
  /** PostgREST's exact row count for the whole filter (select(..., { count: 'exact' })). */
  count?: number | null;
}

/** Hard stop so a misbehaving endpoint can't loop forever: 200 pages =
 * 200k rows at the default page size, far beyond any real league. */
export const MAX_PAGES = 200;

/**
 * Reads EVERY row of a filtered query, page by page. PostgREST caps a
 * response at its max_rows (1000 on Supabase by default) WITHOUT an error,
 * so an un-ranged read of a large league silently returns a prefix. Under
 * the CAS that prefix could never match the RPC's count, and every attempt
 * would fail forever — a permanent refusal (the all-or-nothing family in
 * CLAUDE.md). The caller MUST give the query a stable total order
 * (created_at, id) so pages don't overlap or skip while nothing changes; if
 * something does change mid-read, the CAS catches it and we re-read.
 *
 * Termination does not trust the page size alone: a server whose max_rows is
 * BELOW the requested size returns short pages that are not the end. It
 * stops when the collected rows reach the exact count, or on an empty page.
 * Without a count it falls back to "a short page is the last page".
 */
export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
  pageSize = 1000,
): Promise<{ ok: true; rows: T[] } | { ok: false; error: unknown }> {
  const rows: T[] = [];
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    const from = rows.length;
    const res = await fetchPage(from, from + pageSize - 1);
    if (res.error) return { ok: false, error: res.error };
    const data = res.data ?? [];
    rows.push(...data);
    if (data.length === 0) return { ok: true, rows };
    if (res.count != null) {
      if (rows.length >= res.count) return { ok: true, rows };
    } else if (data.length < pageSize) {
      return { ok: true, rows };
    }
  }
  return { ok: false, error: `readAllPages: more than ${MAX_PAGES} pages` };
}

// ---------------------------------------------------------------------------
// State and expectation
// ---------------------------------------------------------------------------

/** The leagues columns validation reads, RAW as PostgREST returned them. */
export interface LeagueRow {
  draft_status: string | null;
  stake_mode: string | null;
  budget_amount: number | string | null;
  notional_per_slot: number | string | null;
  num_rounds: number | string | null;
  allow_undraftable: boolean | null;
}

/** A league_draft_slots row, RAW. */
export interface SlotRow {
  id: string;
  slot_index: number;
  slot_count: number;
  price_min: number | string | null;
  price_max: number | string | null;
  category_id: string | null;
}

/** A drafts row with its identity. */
export type DraftRow = PickRow & { id: string };

export interface LedgerState {
  league: LeagueRow;
  picks: DraftRow[];
  trades: TradeRow[];
  /** Buy only (validateTradeAdd reads them); null for a sell. */
  slots: SlotRow[] | null;
  /** Buy only: category eligibility for the symbol (not CAS'd — a global
   * fact, see the migration header). Empty set for a sell. */
  eligibleCategories: Set<string>;
  /** Buy, category-slot leagues only: eligibility of the caller's UNATTRIBUTED
   * held symbols, so a legacy position's slot can be derived (see
   * userSlotOccupancy). Same global-fact status as eligibleCategories.
   * Optional: absent = flex-only for every legacy position. */
  heldEligibility?: Map<string, Set<string>>;
}

export interface Expectation {
  seenTradeIds: string[];
  seenDraftIds: string[];
  /** Buy only: exactly the five leagues columns validateTradeAdd reads. */
  rules: Record<string, unknown> | null;
  /** Buy only: exactly the six slot columns validateTradeAdd reads. */
  slots: SlotRow[] | null;
}

/** What the validator saw, as the RPC will compare it. A sell sends no
 * rules/slots because validateTradeDrop reads neither — the CAS's scope
 * matches the evidence's scope. */
export function expectationFor(state: LedgerState): Expectation {
  const buy = state.slots != null;
  return {
    seenTradeIds: state.trades.map((t) => String(t.id)),
    seenDraftIds: state.picks.map((p) => String(p.id)),
    rules: buy
      ? {
        stake_mode: state.league.stake_mode,
        budget_amount: state.league.budget_amount,
        notional_per_slot: state.league.notional_per_slot,
        num_rounds: state.league.num_rounds,
        allow_undraftable: state.league.allow_undraftable,
      }
      : null,
    slots: buy
      ? state.slots!.map((s) => ({
        id: s.id,
        slot_index: s.slot_index,
        slot_count: s.slot_count,
        price_min: s.price_min,
        price_max: s.price_max,
        category_id: s.category_id,
      }))
      : null,
  };
}

// ---------------------------------------------------------------------------
// The decision (the validator, applied to one LedgerState)
// ---------------------------------------------------------------------------

export interface TradePlan {
  quantity: number;
  fundedByTradeId: string | null;
  /** The slot a buy takes in a slotted league (written to trades.slot_id by
   * record_trade_atomic); null for a sell and for slot-less leagues. */
  slotId: string | null;
}

/** A slot as the client sees it: numerics normalised, snake_case. */
export function slotBody(s: Pick<Slot, 'id' | 'slotIndex' | 'slotCount' | 'priceMin' | 'priceMax' | 'categoryId'>) {
  return {
    slot_id: s.id,
    slot_index: s.slotIndex,
    slot_count: s.slotCount,
    price_min: s.priceMin,
    price_max: s.priceMax,
    category_id: s.categoryId,
  };
}

export interface TradeRequest {
  action: 'buy' | 'sell';
  userId: string;
  symbol: string;
  /** Fill price, already rounded to cents (index.ts PRICE ROUNDING note). */
  price: number;
  /** symbols.is_draftable (false when the row is missing). Buy only. */
  isDraftable: boolean;
  /** fixed_notional: which of the caller's own open sales to reinvest. */
  soldTradeId?: string;
}

export function rulesFromLeague(league: LeagueRow): LeagueRules {
  return {
    stakeMode: (league.stake_mode ?? null) as LeagueRules['stakeMode'],
    budgetAmount: league.budget_amount == null ? null : Number(league.budget_amount),
    notionalPerSlot: league.notional_per_slot == null ? null : Number(league.notional_per_slot),
    numRounds: Number(league.num_rounds) || 6,
    allowUndraftable: league.allow_undraftable === true,
  };
}

export function slotsFromRows(rows: SlotRow[]): Slot[] {
  return rows.map((s) => ({
    id: String(s.id),
    slotIndex: Number(s.slot_index),
    slotCount: Number(s.slot_count),
    priceMin: s.price_min == null ? null : Number(s.price_min),
    priceMax: s.price_max == null ? null : Number(s.price_max),
    categoryId: s.category_id == null ? null : String(s.category_id),
  }));
}

/** validateTradeDrop / validateTradeAdd over one state; a refusal is the
 * 200 game-flow reply record-trade has always returned. */
export function decideTrade(req: TradeRequest, state: LedgerState): Step<TradePlan> {
  if (req.action === 'sell') {
    const d = validateTradeDrop(req.userId, req.symbol, state.picks, state.trades);
    if (!d.legal) return { ok: false, reply: { status: 200, body: { ok: false, reason: d.reason } } };
    return { ok: true, value: { quantity: d.quantity, fundedByTradeId: null, slotId: null } };
  }
  const d = validateTradeAdd({
    rules: rulesFromLeague(state.league),
    slots: slotsFromRows(state.slots ?? []),
    picks: state.picks,
    trades: state.trades,
    userId: req.userId,
    symbol: req.symbol,
    price: req.price,
    eligibleCategories: state.eligibleCategories,
    isDraftable: req.isDraftable,
    soldTradeId: req.soldTradeId,
    heldEligibility: state.heldEligibility,
  });
  if (!d.legal) {
    // no_eligible_slot carries what the client needs for its one-sentence
    // refusal ("AAPL is $211.42. Your open slot takes stocks priced $100 to
    // $200."): the fill price and the slots that still have room. An empty
    // open_slots means every slot is held.
    const body: Record<string, unknown> = { ok: false, reason: d.reason };
    if (d.reason === 'no_eligible_slot') {
      body.price = req.price;
      body.open_slots = (d.openSlots ?? []).map(slotBody);
    }
    return { ok: false, reply: { status: 200, body } };
  }
  return {
    ok: true,
    value: { quantity: d.quantity, fundedByTradeId: d.fundedByTradeId ?? null, slotId: d.slotId ?? null },
  };
}

// ---------------------------------------------------------------------------
// Preview: the caller's slot map, and the slot a buy WOULD fill
// ---------------------------------------------------------------------------

/**
 * Read-only slot view for the preview action (no vendor call, no write).
 * `slots` is the caller's derived slot map — what Portfolio labels positions
 * from ("· $100–$200 slot"). When the client supplies the quote it is showing
 * (`probePrice`), `would_fill` is the slot a buy at that price would take, or
 * null with `open_slots` naming what is still open — the same
 * userSlotOccupancy/decideBuySlot a real buy runs, minus the budget/roster
 * checks (the client shows those itself). ADVISORY: the buy re-validates
 * against the live fill price and the live ledger.
 */
export function slotPreview(
  state: LedgerState,
  userId: string,
  probePrice?: number,
): Record<string, unknown> {
  const slots = slotsFromRows(state.slots ?? []);
  if (slots.length === 0) return { slots: [], unplaced: [] };
  const occ = userSlotOccupancy(userId, slots, state.picks, state.trades, state.heldEligibility);
  const view = describeSlots(slots, occ);
  const out: Record<string, unknown> = {
    slots: view.slots.map((v) => ({ ...slotBody(v.slot), held: v.held, open: v.open })),
    unplaced: view.unplaced,
  };
  if (probePrice != null && Number.isFinite(probePrice) && probePrice > 0) {
    const d = decideBuySlot(slots, occ, probePrice, state.eligibleCategories);
    out.would_fill = d.ok ? slotBody(d.slot) : null;
    if (!d.ok) out.open_slots = d.openSlots.map(slotBody);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The attempt loop
// ---------------------------------------------------------------------------

export interface RpcError {
  code?: string;
  message?: string;
}

export interface CommitDeps {
  /** Re-read the league-scoped state (league row, drafts, trades, and for a
   * buy the slots + eligibility). A refusal reply (league gone, draft no
   * longer completed) or a read error ends the loop. */
  readState(): Promise<Step<LedgerState>>;
  /** Run the validator. A refusal ends the loop with that game reply. */
  decide(state: LedgerState): Step<TradePlan>;
  /** Market-hours re-check right before each write; a reply = closed. */
  marketRecheck(): Reply | null;
  /** record_trade_atomic. supabase-js resolves (never throws) on a Postgres
   * error, so the result MUST be destructured — CLAUDE.md success-signal #5. */
  commit(plan: TradePlan, expect: Expectation): PromiseLike<{ data: unknown; error: RpcError | null }>;
  log?: (msg: string, detail?: unknown) => void;
}

export const MAX_ATTEMPTS = 3;

/** RPC refusals that end the loop, with the status record-trade has always
 * used for each (game-flow refusals are 200; 403/404 mirror the up-front
 * membership/league checks). */
const RPC_REFUSALS: Record<string, number> = {
  draft_not_completed: 200,
  proceeds_unavailable: 200,
  not_a_member: 403,
  league_not_found: 404,
};

export async function commitWithRetry(
  deps: CommitDeps,
  opts: { firstState?: LedgerState; maxAttempts?: number } = {},
): Promise<Reply> {
  const log = deps.log ?? (() => {});
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  let state = opts.firstState;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (!state) {
      const read = await deps.readState();
      if (!read.ok) return read.reply;
      state = read.value;
    }

    // A refusal returns WITHOUT a CAS: it was decided on a read that is not
    // atomic (several paginated statements), so a concurrent write mid-read
    // can, rarely, produce a transient false refusal. It can never produce a
    // false ALLOW — every allow goes through the CAS — and a retry heals it.
    const decision = deps.decide(state);
    if (!decision.ok) return decision.reply;

    const closed = deps.marketRecheck();
    if (closed) return closed;

    const { data, error } = await deps.commit(decision.value, expectationFor(state));
    if (error) {
      // Defence in depth: the RPC maps this index's 23505 itself, but if it
      // ever surfaces raw it is still the proceeds refusal. Matched by NAME.
      if (error.code === '23505' && (error.message ?? '').includes('trades_funded_by_trade_id_unique')) {
        return { status: 200, body: { ok: false, reason: 'proceeds_unavailable' } };
      }
      log('record_trade_atomic error', error);
      return unhandled();
    }

    const result = (data ?? null) as { ok?: unknown; reason?: unknown; trade?: unknown; changed?: unknown } | null;
    if (result?.ok === true) {
      const body: Record<string, unknown> = { ok: true, trade: result.trade ?? null };
      // The slot the buy filled, so the confirmation can say "Filled your
      // $100–$200 slot". Looked up from the state the plan was decided on.
      const filled = decision.value.slotId
        ? slotsFromRows(state.slots ?? []).find((x) => x.id === decision.value.slotId)
        : undefined;
      if (filled) body.slot = slotBody(filled);
      return { status: 200, body };
    }
    const reason = typeof result?.reason === 'string' ? result.reason : null;
    if (reason === 'ledger_changed') {
      log(`ledger_changed (${String(result?.changed)}) on attempt ${attempt}/${maxAttempts}`);
      state = undefined; // re-read on the next attempt
      continue;
    }
    if (reason && Object.hasOwn(RPC_REFUSALS, reason)) {
      return { status: RPC_REFUSALS[reason], body: { ok: false, reason } };
    }
    // bad_request (our own malformed call) or an unknown shape: never a
    // success, and not the client's fault.
    log('record_trade_atomic unexpected result', data);
    return unhandled();
  }

  log(`trade_conflict after ${maxAttempts} attempts`);
  return { status: 200, body: { ok: false, reason: 'trade_conflict' } };
}
