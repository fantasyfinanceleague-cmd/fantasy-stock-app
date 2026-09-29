/**
 * Pure draft/trade legality decisions for the in-house simulator (Phase 3,
 * DR-001 / SIMULATOR_MIGRATION_SPEC).
 *
 * Consumed by validate-and-record-pick (draft picks + skips) and record-trade
 * (post-draft add/drop). Same hermetic pattern as
 * ../snapshot-week-start/plan.ts and ../snapshot-week-end/close.ts: these
 * functions DECIDE ONLY — no DB, no fetch, no Deno APIs — so every rule is
 * unit-tested in draft-validation.test.ts with no runtime dependencies.
 *
 * ---------------------------------------------------------------------------
 * CANONICAL DRAFT ORDER
 *
 * Before Phase 3 the two clients disagreed: web ordered members
 * commissioner-first then alphabetical; mobile ordered by joined_at. A
 * cross-platform league could disagree about whose turn it was. The server is
 * now authoritative and uses ONE rule — commissioner first, remaining member
 * ids sorted ascending — chosen because it is derivable from data every
 * client already has (no reliance on joined_at, which is not selected
 * everywhere). Both clients were aligned to this rule in the same commit.
 *
 * ---------------------------------------------------------------------------
 * THE SKIP SENTINEL
 *
 * A row with symbol='SKIP', entry_price=0, quantity=0 records a forfeited
 * turn (used to advance past a bot that cannot afford any pick). SKIP rows
 * COUNT for turn math (they consume a pick number) but are EXCLUDED from
 * ownership, budget and slot occupancy — one row set, two predicates. Keeping
 * both predicates here is what stops the two edge functions from diverging on
 * which rows count for what.
 *
 * ---------------------------------------------------------------------------
 * CATEGORY ELIGIBILITY (live as of Phase 4)
 *
 * A slot with a category filter accepts a symbol only when the symbol's
 * effective eligibility (DR-001 three layers: curated overrides if any exist
 * for the symbol, else the rule-table category for its vendor industry
 * label) contains that category id. An UNCLASSIFIED symbol — no override, no
 * industry, or an unmatched label — has EMPTY eligibility and therefore fits
 * only flex slots (category_id NULL), per DR-001's "unclassified new
 * listings are flex-slot-only". Callers compute the eligibility set
 * (effectiveCategoryIds) and pass it in; this module stays pure.
 */

export type StakeMode = 'fixed_notional' | 'price_tiers' | 'budget_cap' | null;

/** League-level rules the validator needs. stakeMode null = legacy league
 * ('no-budget' before the stake_mode migration, i.e. "commissioner re-choice
 * pending"): unconstrained one-share picks, preserved verbatim so existing
 * leagues keep drafting. */
export interface LeagueRules {
  stakeMode: StakeMode;
  budgetAmount: number | null; // the cap in budget_cap mode
  notionalPerSlot: number | null; // per-slot stake in fixed_notional mode
  numRounds: number; // roster size per user == rounds in the snake draft
  /** DR-001 commissioner override (leagues.allow_undraftable, default false):
   * when true the league opts into the FULL symbol universe, so the is_draftable
   * gate is bypassed. Optional/undefined = false (gate enforced). */
  allowUndraftable?: boolean;
}

export interface Slot {
  id: string;
  slotIndex: number;
  slotCount: number;
  priceMin: number | null; // NULL = no floor
  priceMax: number | null; // NULL = no ceiling
  categoryId: string | null; // NULL = flex (no category filter)
}

/** A drafts row (only the fields legality needs). user_id is TEXT in the DB
 * (real uid or 'bot-*'); compare as strings everywhere. */
export interface PickRow {
  user_id: string;
  symbol: string;
  entry_price: number;
  quantity: number;
  pick_number: number;
  slot_id?: string | null;
}

/** A trades row. user_id is UUID in the DB — callers must String() it before
 * handing rows in, so all comparisons here are string-vs-string (the
 * documented drafts-TEXT / trades-UUID cast footgun, JS edition).
 *
 * id / created_at / total_value / funded_by_trade_id are optional because
 * most callers (turn math, ownership, budget) never need them — only
 * fixedNotionalFunding() (below) does, for the proceeds walk. */
export interface TradeRow {
  id?: string;
  user_id: string;
  symbol: string;
  action: string; // 'buy' | 'sell'
  quantity: number;
  price: number;
  created_at?: string; // ISO timestamp; orders the funding walk
  /** The row's own recorded total_value (price × quantity, rounded to cents
   * at insert — trades.total_value is NUMERIC(10,2)). When present,
   * fixedNotionalFunding uses THIS as a sell's proceeds rather than
   * recomputing price*quantity, so a rebuy is sized from exactly what the
   * sale actually recorded, not a re-derived value that can differ from it
   * by a sub-cent rounding residual (fractional fixed_notional quantities
   * are 6dp; price is 2dp). Optional so hermetic tests may omit it. */
  total_value?: number;
  /** fixed_notional only: the SELL this BUY reinvests. See the NULL
   * DISCIPLINE note on fixedNotionalFunding() below. */
  funded_by_trade_id?: string | null;
}

export const SKIP_SYMBOL = 'SKIP';

const isSkip = (p: PickRow) => (p.symbol ?? '').toUpperCase() === SKIP_SYMBOL;

/**
 * THE DRAFT ORDER IS STORED, NOT DERIVED. It lives in public.league_draft_order
 * (20261013000000_draft_order_modes.sql): random (server-generated, revealed at
 * draft_date - 1h) or manual (commissioner-arranged), locked at draft start. The
 * old computeDraftOrder (commissioner first, then ids sorted) is gone; started
 * drafts were backfilled with exactly what it returned, so no turn shifted.
 */
export interface DraftOrderRow {
  position: number;
  user_id: string;
}

/** Stored rows -> the ordered id list turn math takes. Sorted here rather than
 * trusting a query's ORDER BY, so a caller that forgets it cannot reorder turns. */
export function orderFromRows(rows: DraftOrderRow[]): string[] {
  return [...rows]
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((r) => String(r.user_id));
}

export type StoredOrderCheck =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'not_permutation' };

/**
 * Is the stored order EXACTLY a permutation of the current members? Compared
 * per participant in both directions — never "does an order exist" (CLAUDE.md:
 * guards keyed on all-or-nothing state are blind to partial state). A started
 * draft always has one (the start trigger locks it); a mismatch means turn math
 * would silently skip or invent a picker, so callers refuse rather than guess.
 */
export function checkStoredOrder(order: string[], memberIds: string[]): StoredOrderCheck {
  if (order.length === 0) return { ok: false, reason: 'missing' };
  const members = new Set(memberIds);
  const seen = new Set<string>();
  for (const id of order) {
    if (!members.has(id) || seen.has(id)) return { ok: false, reason: 'not_permutation' };
    seen.add(id);
  }
  return seen.size === members.size ? { ok: true } : { ok: false, reason: 'not_permutation' };
}

export interface TurnState {
  round: number;
  pickNumber: number;
  pickerId: string;
}

/**
 * Snake-draft turn for the NEXT pick given how many picks exist (SKIP rows
 * included — they consume turns). Returns null when the draft is complete.
 * Odd rounds run forward through the order, even rounds reversed — identical
 * math to both clients' pre-Phase-3 implementations.
 */
export function currentTurn(
  totalPicks: number,
  order: string[],
  numRounds: number,
): TurnState | null {
  const n = order.length;
  if (n === 0) return null;
  if (totalPicks >= n * numRounds) return null;
  const round = Math.floor(totalPicks / n) + 1;
  const idx = totalPicks % n;
  const pickerIdx = round % 2 === 0 ? n - 1 - idx : idx;
  return { round, pickNumber: totalPicks + 1, pickerId: order[pickerIdx] };
}

/**
 * Symbols currently owned by ANYONE in the league: draft quantity plus buys
 * minus sells, kept only where the net is > 0. A full drop therefore frees
 * the symbol league-wide — this is the one place that rule lives.
 */
export function leagueOwnedSymbols(
  picks: PickRow[],
  trades: TradeRow[],
): Set<string> {
  // symbol -> user -> net qty (per-user, not league-net: user A selling must
  // not offset user B's holding)
  const net = new Map<string, Map<string, number>>();
  const bump = (sym: string, user: string, delta: number) => {
    const s = sym.toUpperCase();
    const byUser = net.get(s) ?? new Map<string, number>();
    byUser.set(user, (byUser.get(user) ?? 0) + delta);
    net.set(s, byUser);
  };
  for (const p of picks) {
    if (isSkip(p)) continue;
    bump(p.symbol, String(p.user_id), Number(p.quantity) || 0);
  }
  for (const t of trades) {
    const q = Number(t.quantity) || 0;
    bump(t.symbol, String(t.user_id), t.action === 'sell' ? -q : q);
  }
  const owned = new Set<string>();
  for (const [sym, byUser] of net) {
    for (const q of byUser.values()) {
      if (q > 1e-9) {
        owned.add(sym);
        break;
      }
    }
  }
  return owned;
}

/** One user's net holdings (symbol -> quantity > 0). */
export function userNetHoldings(
  userId: string,
  picks: PickRow[],
  trades: TradeRow[],
): Map<string, number> {
  const net = new Map<string, number>();
  const bump = (sym: string, delta: number) => {
    const s = sym.toUpperCase();
    net.set(s, (net.get(s) ?? 0) + delta);
  };
  for (const p of picks) {
    if (isSkip(p) || String(p.user_id) !== userId) continue;
    bump(p.symbol, Number(p.quantity) || 0);
  }
  for (const t of trades) {
    if (String(t.user_id) !== userId) continue;
    const q = Number(t.quantity) || 0;
    bump(t.symbol, t.action === 'sell' ? -q : q);
  }
  for (const [sym, q] of net) {
    if (!(q > 1e-9)) net.delete(sym);
  }
  return net;
}

/**
 * Cash spent by one user: draft costs + buy costs − sell proceeds. SKIP rows
 * are qty 0 / price 0 so they fall out naturally. Used for the budget_cap
 * remaining-budget check at draft time AND post-draft adds, so a drop refunds
 * budget at the sale price (a deliberate game rule, not an accident).
 */
export function userCashSpent(
  userId: string,
  picks: PickRow[],
  trades: TradeRow[],
): number {
  let spent = 0;
  for (const p of picks) {
    if (String(p.user_id) !== userId) continue;
    spent += (Number(p.entry_price) || 0) * (Number(p.quantity) || 0);
  }
  for (const t of trades) {
    if (String(t.user_id) !== userId) continue;
    const cost = (Number(t.price) || 0) * (Number(t.quantity) || 0);
    spent += t.action === 'sell' ? -cost : cost;
  }
  return spent;
}

/**
 * DR-001 layer resolution: overrides REPLACE the rule category when any
 * exist; otherwise the single rule category; otherwise empty (unclassified,
 * flex-only). Pure so it is hermetically testable alongside the slot logic.
 */
export function effectiveCategoryIds(
  overrideCategoryIds: string[],
  ruleCategoryId: string | null,
): Set<string> {
  if (overrideCategoryIds.length > 0) return new Set(overrideCategoryIds);
  return ruleCategoryId ? new Set([ruleCategoryId]) : new Set();
}

/** Bracket + category test. Brackets are INCLUSIVE on both ends (price
 * exactly at price_min or price_max is legal — locked by tests). A category
 * slot requires the symbol's eligibility to contain its category id. */
export function slotAccepts(slot: Slot, price: number, eligibility: Set<string>): boolean {
  if (slot.priceMin != null && price < slot.priceMin) return false;
  if (slot.priceMax != null && price > slot.priceMax) return false;
  if (slot.categoryId != null && !eligibility.has(slot.categoryId)) return false;
  return true;
}

/**
 * First-fit slot assignment: slots ordered by slot_index; a slot has
 * remaining capacity while fewer than slotCount of the user's ACTIVE picks
 * occupy it. `occupiedSlotIds` = slot_id of the user's active (non-SKIP,
 * not-fully-dropped) picks; legacy picks with no slot_id occupy nothing.
 * Returns the slot, or null when no unfilled slot accepts the price.
 */
export function assignSlot(
  slots: Slot[],
  occupiedSlotIds: Array<string | null | undefined>,
  price: number,
  eligibility: Set<string>,
): Slot | null {
  const occupancy = new Map<string, number>();
  for (const id of occupiedSlotIds) {
    if (id) occupancy.set(id, (occupancy.get(id) ?? 0) + 1);
  }
  const ordered = [...slots].sort((a, b) => a.slotIndex - b.slotIndex);
  for (const slot of ordered) {
    if ((occupancy.get(slot.id) ?? 0) >= slot.slotCount) continue;
    if (slotAccepts(slot, price, eligibility)) return slot;
  }
  return null;
}

/** Quantity for a fill: fixed_notional buys notional/price (fractional,
 * rounded to 6 dp to match week_snapshots.quantity numeric(12,6)); every
 * other mode is one share per pick (DR-001: tiers and cap are one-share
 * modes; plain unconstrained legacy leagues also fill one share). */
export function fillQuantity(rules: LeagueRules, price: number): number {
  if (rules.stakeMode === 'fixed_notional') {
    const notional = Number(rules.notionalPerSlot) || 1000;
    return Math.round((notional / price) * 1e6) / 1e6;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// fixed_notional slot proceeds (2026-09-29 product rule)
//
// A replacement buy in a fixed_notional league reinvests exactly the SALE
// PROCEEDS of the slot it fills — not a fresh full notional stake (that was
// the bug: fillQuantity() above sizes every buy at notional/price regardless
// of what was sold, creating or destroying money on every sell-then-rebuy).
// A slot the user voluntarily SKIPPED at draft time was never funded by a
// sale, so a buy into it still gets the full notional — nothing was ever
// reduced.
// ---------------------------------------------------------------------------

/** One SELL's proceeds not yet claimed by a later BUY's funded_by_trade_id. */
export interface OpenProceeds {
  tradeId: string;
  symbol: string;
  amount: number; // price * quantity of the sell, at the precision it was stored
}

export interface FundingState {
  /** Oldest first — unclaimed SELL proceeds available to fund a buy. */
  open: OpenProceeds[];
  /** Draft slots the user voluntarily skipped and has not yet filled. */
  unfilledSlots: number;
}

/**
 * Walks one user's picks + trades to derive their current fixed_notional
 * funding state. Every dollar of a user's roster capital is, at any moment,
 * in exactly one of three places: currently held (userNetHoldings, above),
 * sitting as unclaimed sale proceeds (`open` here), or never allocated at all
 * (an `unfilledSlots` credit from a voluntary SKIP) — so this function and
 * userNetHoldings together account for the whole roster.
 *
 * NULL DISCIPLINE (CLAUDE.md "overloaded NULLs are type tags, and you cannot
 * fill them in"): a BUY with funded_by_trade_id NULL reads exactly ONE way —
 * "consumed the oldest open proceeds at that moment, else filled an unfilled
 * slot at full notional." record-trade writes NULL ONLY when neither existed
 * at insert time, which is what keeps that single reading true for every row
 * going forward. A buy with NEITHER open proceeds NOR an unfilled slot
 * available (only reachable via a pre-fix row — the old bug's full-notional
 * overbuy after a partial-value sale) consumes nothing here and is otherwise
 * ignored by the walk; the ledger row itself stays the permanent record and
 * is never rewritten (CLAUDE.md: "we do not rewrite applied migrations to fix
 * their headers" — the same principle applies to historical trade rows).
 */
export function fixedNotionalFunding(
  userId: string,
  picks: PickRow[],
  trades: TradeRow[],
): FundingState {
  let unfilledSlots = 0;
  for (const p of picks) {
    if (String(p.user_id) === userId && isSkip(p)) unfilledSlots++;
  }

  // Stable chronological order: created_at, then array order as a tiebreak
  // for equal (or missing, in tests) timestamps.
  const sorted = trades
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => String(t.user_id) === userId)
    .sort((a, b) => {
      const ta = a.t.created_at ? Date.parse(a.t.created_at) : 0;
      const tb = b.t.created_at ? Date.parse(b.t.created_at) : 0;
      return ta - tb || a.i - b.i;
    })
    .map(({ t }) => t);

  const open: OpenProceeds[] = [];
  for (const t of sorted) {
    if (t.action === 'sell') {
      if (!t.id) continue;
      // Prefer the row's own stored total_value (what the sale actually
      // recorded, rounded to cents) over re-deriving price × quantity, which
      // can differ from it by a sub-cent residual — see the total_value field
      // comment on TradeRow above.
      const amount = t.total_value != null
        ? Number(t.total_value)
        : (Number(t.price) || 0) * (Number(t.quantity) || 0);
      open.push({ tradeId: t.id, symbol: (t.symbol ?? '').toUpperCase(), amount });
      continue;
    }
    if (t.action !== 'buy') continue;

    if (t.funded_by_trade_id) {
      const idx = open.findIndex((o) => o.tradeId === t.funded_by_trade_id);
      if (idx >= 0) open.splice(idx, 1);
      continue;
    }
    // NULL: oldest open proceeds first, else an unfilled slot, else a pre-fix
    // anomaly — see the NULL DISCIPLINE note above.
    if (open.length > 0) {
      open.shift();
    } else if (unfilledSlots > 0) {
      unfilledSlots--;
    }
  }

  return { open, unfilledSlots };
}

export type FundingSource =
  | { kind: 'proceeds'; tradeId: string; amount: number }
  | { kind: 'unfilled_slot'; amount: number };

export type FundingResolution =
  | { ok: true; source: FundingSource }
  | { ok: false; reason: 'no_proceeds' | 'proceeds_unavailable' };

/**
 * Picks the funding source for one fixed_notional buy.
 *
 * "Reinvest proceeds first" (product rule): when open proceeds exist, the
 * buy MUST use one of them — an unfilled slot's full notional is only
 * offered when there is no open proceeds at all. This is checked in order
 * below, not by preferring whichever is larger.
 *
 * `soldTradeId`, when given, must name one of the CALLER's own open proceeds
 * (record-trade enforces "own" via the caller's trades before this runs);
 * naming anything else — someone else's, an already-spent, or a
 * concurrently-spent one (closed by the DB's unique index, surfaced here as
 * the same refusal) — is 'proceeds_unavailable'. Omitted = server default:
 * the oldest unclaimed proceeds (FIFO).
 */
export function resolveFunding(
  state: FundingState,
  notionalPerSlot: number,
  soldTradeId?: string | null,
): FundingResolution {
  if (soldTradeId) {
    const match = state.open.find((o) => o.tradeId === soldTradeId);
    if (!match) return { ok: false, reason: 'proceeds_unavailable' };
    return { ok: true, source: { kind: 'proceeds', tradeId: match.tradeId, amount: match.amount } };
  }
  if (state.open.length > 0) {
    const oldest = state.open[0];
    return { ok: true, source: { kind: 'proceeds', tradeId: oldest.tradeId, amount: oldest.amount } };
  }
  if (state.unfilledSlots > 0) {
    return { ok: true, source: { kind: 'unfilled_slot', amount: notionalPerSlot } };
  }
  return { ok: false, reason: 'no_proceeds' };
}

export type PickRefusal =
  | 'draft_complete'
  | 'not_your_turn'
  | 'invalid_price'
  | 'not_draftable'
  | 'symbol_owned'
  | 'no_eligible_slot'
  | 'over_budget';

export type PickDecision =
  | {
    legal: true;
    round: number;
    pickNumber: number;
    quantity: number;
    slotId: string | null;
  }
  | { legal: false; reason: PickRefusal };

export interface PickInputs {
  rules: LeagueRules;
  slots: Slot[];
  order: string[]; // the STORED draft order (league_draft_order, orderFromRows)
  picks: PickRow[]; // ALL drafts rows for the league, pick_number asc
  trades: TradeRow[]; // defensive: owned-check survives any pre-existing trades
  pickerId: string; // who this pick is FOR (caller or a bot)
  symbol: string;
  price: number;
  /** effectiveCategoryIds(...) for the symbol; empty = unclassified, flex-only */
  eligibleCategories: Set<string>;
  /** symbols.is_draftable for this symbol (false when the row is missing).
   * Only an explicit `false` triggers the not_draftable refusal — undefined is
   * treated as draftable so rule tests that don't exercise this stay green. */
  isDraftable?: boolean;
}

/**
 * Is this draft pick legal, and how does it fill?
 * Order of checks is deliberate: turn first (cheapest, most common refusal in
 * a race), then price sanity, then ownership, then slot bracket, then budget.
 */
export function validatePick(i: PickInputs): PickDecision {
  const turn = currentTurn(i.picks.length, i.order, i.rules.numRounds);
  if (!turn) return { legal: false, reason: 'draft_complete' };
  if (turn.pickerId !== i.pickerId) {
    return { legal: false, reason: 'not_your_turn' };
  }

  const price = Number(i.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { legal: false, reason: 'invalid_price' };
  }

  const sym = i.symbol.toUpperCase();
  if (sym === SKIP_SYMBOL) return { legal: false, reason: 'invalid_price' };

  // is_draftable gate (DR-001 draftable-universe filter): a non-draftable symbol
  // is refused unless the commissioner opted the league into the full universe.
  if (i.isDraftable === false && !i.rules.allowUndraftable) {
    return { legal: false, reason: 'not_draftable' };
  }

  if (leagueOwnedSymbols(i.picks, i.trades).has(sym)) {
    return { legal: false, reason: 'symbol_owned' };
  }

  // Slot assignment: only constrains when the league defines slots (tiers —
  // or any Phase-4 category league). Slot-less leagues fill slot_id null.
  let slotId: string | null = null;
  if (i.slots.length > 0) {
    const mine = i.picks.filter((p) =>
      String(p.user_id) === i.pickerId && !isSkip(p)
    );
    const slot = assignSlot(i.slots, mine.map((p) => p.slot_id), price, i.eligibleCategories);
    if (!slot) return { legal: false, reason: 'no_eligible_slot' };
    slotId = slot.id;
  }

  const quantity = fillQuantity(i.rules, price);

  if (i.rules.stakeMode === 'budget_cap') {
    const budget = Number(i.rules.budgetAmount) || 0;
    const spent = userCashSpent(i.pickerId, i.picks, i.trades);
    if (spent + price * quantity > budget + 1e-9) {
      return { legal: false, reason: 'over_budget' };
    }
  }

  return { legal: true, round: turn.round, pickNumber: turn.pickNumber, quantity, slotId };
}

export type SkipDecision =
  | { legal: true; round: number; pickNumber: number }
  | { legal: false; reason: 'draft_complete' | 'not_your_turn' };

/** A skip is legal iff it forfeits exactly the CURRENT turn. */
export function validateSkip(
  targetId: string,
  order: string[],
  totalPicks: number,
  numRounds: number,
): SkipDecision {
  const turn = currentTurn(totalPicks, order, numRounds);
  if (!turn) return { legal: false, reason: 'draft_complete' };
  if (turn.pickerId !== targetId) {
    return { legal: false, reason: 'not_your_turn' };
  }
  return { legal: true, round: turn.round, pickNumber: turn.pickNumber };
}

export type TradeRefusal =
  | 'invalid_price'
  | 'not_draftable'
  | 'symbol_owned'
  | 'roster_full'
  | 'no_eligible_slot'
  | 'over_budget'
  | 'not_owned'
  /** fixed_notional only: roster has room but the user has neither open sale
   * proceeds nor an unfilled draft slot to fund the buy (a pre-fix anomaly —
   * see fixedNotionalFunding's NULL DISCIPLINE note). */
  | 'no_proceeds'
  /** fixed_notional only: an explicit sold_trade_id that isn't one of the
   * caller's own open proceeds — foreign, already spent, or lost a
   * concurrent race to the DB's unique index. */
  | 'proceeds_unavailable';

export type TradeDecision =
  | {
    legal: true;
    quantity: number;
    /** fixed_notional only: the SELL this buy reinvests, or null when it
     * filled a previously-unfilled (skipped) draft slot instead. Omitted
     * (undefined) in every other stake mode. */
    fundedByTradeId?: string | null;
    /** fixed_notional only: the dollar amount the quantity was sized from
     * (sale proceeds, or a fresh notional for an unfilled slot). */
    stakeAmount?: number;
  }
  | { legal: false; reason: TradeRefusal };

export interface TradeAddInputs {
  rules: LeagueRules;
  slots: Slot[];
  picks: PickRow[];
  trades: TradeRow[];
  userId: string;
  symbol: string;
  price: number;
  /** effectiveCategoryIds(...) for the symbol; empty = unclassified, flex-only */
  eligibleCategories: Set<string>;
  /** symbols.is_draftable (false when the row is missing). Only explicit `false`
   * refuses; undefined = draftable (keeps rule tests green). */
  isDraftable?: boolean;
  /** fixed_notional only: which of the caller's own open sale proceeds this
   * buy reinvests. Omitted = server default (oldest unclaimed, FIFO).
   * Ignored in every other stake mode. */
  soldTradeId?: string | null;
}

/**
 * Post-draft ADD: validates like a pick (ownership, bracket, budget) minus
 * the turn check, plus a roster-capacity check (a drop frees a roster spot;
 * an add fills one — net positions may never exceed numRounds).
 */
export function validateTradeAdd(i: TradeAddInputs): TradeDecision {
  const price = Number(i.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { legal: false, reason: 'invalid_price' };
  }

  const sym = i.symbol.toUpperCase();
  if (sym === SKIP_SYMBOL) return { legal: false, reason: 'invalid_price' };

  // is_draftable gate (DR-001): same as the draft path — a post-draft BUY of a
  // non-draftable symbol is refused unless the league allows the full universe.
  // (A SELL/drop never checks this — you can always exit a position.)
  if (i.isDraftable === false && !i.rules.allowUndraftable) {
    return { legal: false, reason: 'not_draftable' };
  }

  if (leagueOwnedSymbols(i.picks, i.trades).has(sym)) {
    return { legal: false, reason: 'symbol_owned' };
  }

  const holdings = userNetHoldings(i.userId, i.picks, i.trades);
  if (holdings.size >= i.rules.numRounds) {
    return { legal: false, reason: 'roster_full' };
  }

  // Tiers: the add must fit a slot bracket not occupied by an ACTIVE
  // position. Occupancy = slot_ids of the user's picks whose symbol is still
  // held (a dropped pick's slot is freed along with the symbol).
  if (i.slots.length > 0) {
    const activeSlotIds = i.picks
      .filter((p) =>
        String(p.user_id) === i.userId && !isSkip(p) &&
        holdings.has(p.symbol.toUpperCase())
      )
      .map((p) => p.slot_id);
    const slot = assignSlot(i.slots, activeSlotIds, price, i.eligibleCategories);
    if (!slot) return { legal: false, reason: 'no_eligible_slot' };
  }

  // fixed_notional: size the buy from the slot's actual proceeds, not a fresh
  // notional stake — see fixedNotionalFunding/resolveFunding above and the
  // 2026-09-29 product rule in the migration header. Every other stake mode
  // is unaffected — fillQuantity's one-share-per-pick branch is unchanged.
  if (i.rules.stakeMode === 'fixed_notional') {
    const notional = Number(i.rules.notionalPerSlot) || 1000;
    const funding = fixedNotionalFunding(i.userId, i.picks, i.trades);
    const resolved = resolveFunding(funding, notional, i.soldTradeId);
    if (!resolved.ok) return { legal: false, reason: resolved.reason };

    const stakeAmount = resolved.source.amount;
    const quantity = Math.round((stakeAmount / price) * 1e6) / 1e6;
    if (!(quantity > 0)) return { legal: false, reason: 'invalid_price' };

    return {
      legal: true,
      quantity,
      fundedByTradeId: resolved.source.kind === 'proceeds' ? resolved.source.tradeId : null,
      stakeAmount,
    };
  }

  const quantity = fillQuantity(i.rules, price);

  if (i.rules.stakeMode === 'budget_cap') {
    const budget = Number(i.rules.budgetAmount) || 0;
    const spent = userCashSpent(i.userId, i.picks, i.trades);
    if (spent + price * quantity > budget + 1e-9) {
      return { legal: false, reason: 'over_budget' };
    }
  }

  return { legal: true, quantity };
}

/**
 * Post-draft DROP: legal iff the user's net position is > 0. Always drops the
 * ENTIRE position — "drop frees the symbol league-wide" (spec) only holds if
 * nothing is left behind, so partial drops are not offered.
 */
export function validateTradeDrop(
  userId: string,
  symbol: string,
  picks: PickRow[],
  trades: TradeRow[],
): TradeDecision {
  const held = userNetHoldings(userId, picks, trades).get(symbol.toUpperCase());
  if (!held) return { legal: false, reason: 'not_owned' };
  // Round to the 6-dp precision actually written (trades / week_snapshots
  // numeric(12,6)); a float residual below 5e-7 rounds to 0 and is not a
  // droppable position — refusing here beats a DB CHECK (quantity > 0) 500.
  const quantity = Math.round(held * 1e6) / 1e6;
  if (!(quantity > 0)) return { legal: false, reason: 'not_owned' };
  return { legal: true, quantity };
}
