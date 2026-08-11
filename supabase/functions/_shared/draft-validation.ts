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
 * CATEGORIES ARE UNSEEDED UNTIL PHASE 4
 *
 * league_draft_slots.category_id exists (Phase 2 schema) but the categories /
 * category_rules tables have no rows until Phase 4 enrichment. Per the spec,
 * category eligibility is therefore NOT evaluated here yet: a slot with a
 * category filter is treated as flex (bracket-only). When Phase 4 seeds the
 * tables, slotAcceptsPrice grows a category argument — grep for
 * PHASE4-CATEGORIES to find every deliberate flex-fallback.
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
}

export interface Slot {
  id: string;
  slotIndex: number;
  slotCount: number;
  priceMin: number | null; // NULL = no floor
  priceMax: number | null; // NULL = no ceiling
  categoryId: string | null; // PHASE4-CATEGORIES: ignored until seeded
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
 * documented drafts-TEXT / trades-UUID cast footgun, JS edition). */
export interface TradeRow {
  user_id: string;
  symbol: string;
  action: string; // 'buy' | 'sell'
  quantity: number;
  price: number;
}

export const SKIP_SYMBOL = 'SKIP';

const isSkip = (p: PickRow) => (p.symbol ?? '').toUpperCase() === SKIP_SYMBOL;

/** Canonical draft order: commissioner first, others sorted ascending. */
export function computeDraftOrder(
  commissionerId: string | null,
  memberIds: string[],
): string[] {
  const rest = memberIds.filter((id) => id !== commissionerId).sort();
  return commissionerId && memberIds.includes(commissionerId)
    ? [commissionerId, ...rest]
    : rest;
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

/** Bracket test, boundaries INCLUSIVE on both ends (price exactly at
 * price_min or price_max is legal — locked by tests). */
export function slotAcceptsPrice(slot: Slot, price: number): boolean {
  if (slot.priceMin != null && price < slot.priceMin) return false;
  if (slot.priceMax != null && price > slot.priceMax) return false;
  // PHASE4-CATEGORIES: categoryId deliberately not consulted — slot is flex
  // until the categories tables are seeded (Phase 4).
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
): Slot | null {
  const occupancy = new Map<string, number>();
  for (const id of occupiedSlotIds) {
    if (id) occupancy.set(id, (occupancy.get(id) ?? 0) + 1);
  }
  const ordered = [...slots].sort((a, b) => a.slotIndex - b.slotIndex);
  for (const slot of ordered) {
    if ((occupancy.get(slot.id) ?? 0) >= slot.slotCount) continue;
    if (slotAcceptsPrice(slot, price)) return slot;
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

export type PickRefusal =
  | 'draft_complete'
  | 'not_your_turn'
  | 'invalid_price'
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
  order: string[]; // canonical draft order (computeDraftOrder)
  picks: PickRow[]; // ALL drafts rows for the league, pick_number asc
  trades: TradeRow[]; // defensive: owned-check survives any pre-existing trades
  pickerId: string; // who this pick is FOR (caller or a bot)
  symbol: string;
  price: number;
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
    const slot = assignSlot(i.slots, mine.map((p) => p.slot_id), price);
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
  | 'symbol_owned'
  | 'roster_full'
  | 'no_eligible_slot'
  | 'over_budget'
  | 'not_owned';

export type TradeDecision =
  | { legal: true; quantity: number }
  | { legal: false; reason: TradeRefusal };

export interface TradeAddInputs {
  rules: LeagueRules;
  slots: Slot[];
  picks: PickRow[];
  trades: TradeRow[];
  userId: string;
  symbol: string;
  price: number;
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
    const slot = assignSlot(i.slots, activeSlotIds, price);
    if (!slot) return { legal: false, reason: 'no_eligible_slot' };
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
  return { legal: true, quantity: held };
}
