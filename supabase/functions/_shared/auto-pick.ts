/**
 * The draft pick clock's server AUTO-PICK (product rules, Giorgio 2026-09-29):
 * when a manager's clock runs out the server picks for them — first their own
 * draft QUEUE, in order, the first still-legal symbol; then BEST AVAILABLE,
 * like fantasy football: walk the market by size (largest market cap first)
 * and take the first stock that fits the league's rules. Never random. A stall
 * only when nothing is legal.
 *
 * ACCEPTANCE CRITERION (Giorgio): auto-draft must NEVER give someone a stock
 * their league's rules forbid. Enforced structurally, not by care:
 *   * every candidate — queue or best available, human or bot — is judged by
 *     ./pick-gate.ts `gatePick`, i.e. the SAME validatePick a manual pick
 *     passes, fed the LIVE fill price and the symbol's category eligibility;
 *   * chooseAutoPick can only return a pick as a `GatedPick`, which only
 *     gatePick can produce, and the writer (draft-write.ts insertGatedPick)
 *     accepts nothing else. Cheap cached-price filters here only decide WHAT
 *     TO TRY — never what is legal.
 *
 * SEARCH DEPTH ("a legal pick is found whenever one exists"): best available
 * is not a fixed top-N list. Each round asks the database
 * (public.auto_pick_search_candidates, one call per OPEN slot) for the
 * largest stocks that fit that slot's price bracket (clamped to the remaining
 * budget), its category, the draftable universe, and are not owned or already
 * judged. The search WALKS THE WHOLE POOL page by page (2026-10-05 liveness):
 * no top-N window, so a stock outside the top by market cap IS found when it is
 * the only fit. Each candidate is judged free at its cached price, then live.
 *
 *   QUEUE_MAX_ATTEMPTS  = 5    live-priced queue candidates (the user's preference list)
 *   LIVE_MAX_ATTEMPTS   = 20   live fill calls per auto-pick (a quota bound)
 *   SCREEN_MAX_REQUESTS = 5    batched snapshot requests per auto-pick (100 symbols each)
 *   FRESH_MS            = 30m  a cached price written from a live price this recently
 *                              IS a live price: judged on it, never re-priced
 *
 * NEVER STALLS ON A STALE CACHE (Giorgio, 2026-10-13: after a clock expires ONLY
 * the auto-pick fills the turn, so "the auto pick has to work"): a candidate the
 * cached price refuses, but a live price could admit (within NEAR_MISS_MARGIN of
 * an open bracket or the budget top, or refused only by the budget reserve), is
 * priced live through a batched SCREEN before it is ever counted as refused; and
 * when the first search finds nothing, a second, wider search runs. See
 * chooseAutoPick.
 *
 * NO SKIP (2026-10-05, "a draft pick can never be unused"): when the whole pool
 * is walked with nothing legal the choice is 'stalled' — no row is written, the
 * turn stays open, the failure is recorded and alerted (draft-write.ts). A
 * vendor outage, or a bound, is 'retry_later'. See chooseAutoPick and decideNoPick.
 *
 * PROGRESS ACROSS TICKS (2026-10-13, review H1): every live price (screen or fill)
 * is written back with its time; a cached price younger than FRESH_MS is judged
 * as live (refused for free, never re-priced). So a search that stops on a bound
 * resumes past what it judged, and a true stall reaches 'stalled' in a few ticks
 * instead of re-pricing the same fringe forever. A bounded result is recorded and
 * recorded by draft-write.ts (boundedReportsStalled, stallCooldownVerdict).
 *
 * THE DEADLINE IS NOT COMPUTED HERE. It has exactly one definition —
 * public.get_draft_clock — which clients, the edge gate and the cron's
 * overdue filter all read, on the DATABASE clock. decideAutoPickGate only
 * interprets that function's row.
 *
 * I/O is injected (AutoPickPorts), so the whole search — including the
 * "never illegal, never a needless skip" property — is unit-tested against an
 * in-memory market in auto-pick.test.ts. draft-write.ts supplies the real
 * ports (Supabase + Alpaca) and does the write.
 */
import { type BotSymbolCandidate, candidateFilter } from './bot-pick.ts';
import { type GatedPick, gatePick } from './pick-gate.ts';
import { tierPrice } from './tier-price.ts';
import {
  deficit,
  demandVector,
  preShortfall,
  FLEX_TYPE_ID,
  type FeasibilityState,
  openInstances,
  type PoolGroup,
  reserveFor,
  typesFromSlots,
} from './draft-feasibility.ts';
import {
  assignSlot,
  currentTurn,
  type LeagueRules,
  leagueOwnedSymbols,
  type PickRow,
  SKIP_SYMBOL,
  type Slot,
  type TradeRow,
  userCashSpent,
} from './draft-validation.ts';

/** drafts.pick_source (CHECK in 20261010000000). UI: "Auto-picked" = auto_*. */
export type PickSource = 'manual' | 'bot' | 'auto_queue' | 'auto_best';

// ---------------------------------------------------------------------------
// Clock gate
// ---------------------------------------------------------------------------

/** One row of public.get_draft_clock, parsed. */
export interface DraftClock {
  draftStatus: string | null;
  clockRunning: boolean;
  pickSeconds: number;
  picksMade: number;
  turnStartedAt: string | null;
  deadlineAt: string | null;
  serverNow: string;
}

// deno-lint-ignore no-explicit-any
export function parseDraftClockRow(row: any): DraftClock | null {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.server_now !== 'string' || !Number.isFinite(Number(row.picks_made))) return null;
  return {
    draftStatus: row.draft_status ?? null,
    clockRunning: row.clock_running === true,
    pickSeconds: Number(row.pick_seconds),
    picksMade: Number(row.picks_made),
    turnStartedAt: row.turn_started_at ?? null,
    deadlineAt: row.deadline_at ?? null,
    serverNow: row.server_now,
  };
}

export type AutoPickGate =
  | { kind: 'already_recorded' }
  | { kind: 'draft_not_in_progress' }
  | { kind: 'stale_pick_number' }
  | { kind: 'clock_not_running' }
  | { kind: 'not_overdue'; deadlineAt: string | null; serverNow: string }
  | { kind: 'go' };

/**
 * May the server auto-pick `requestedPickNumber` right now?
 *  1. already_recorded FIRST, regardless of status — a late client firing for
 *     the draft's final pick (which finalized the league) must hear "done".
 *     Idempotent, and costs no Alpaca call.
 *  2. only an in_progress draft auto-picks;
 *  3. a pick number ahead of the draft is a stale client state;
 *  4. an unclocked draft (pick_clock_enabled=false) is never auto-picked;
 *  5. the deadline, judged by the DB's server_now — never a client clock.
 */
export function decideAutoPickGate(requestedPickNumber: number, clock: DraftClock): AutoPickGate {
  if (!Number.isInteger(requestedPickNumber) || requestedPickNumber < 1) return { kind: 'stale_pick_number' };
  if (requestedPickNumber <= clock.picksMade) return { kind: 'already_recorded' };
  if (clock.draftStatus !== 'in_progress') return { kind: 'draft_not_in_progress' };
  if (requestedPickNumber !== clock.picksMade + 1) return { kind: 'stale_pick_number' };
  if (!clock.clockRunning || !clock.deadlineAt) return { kind: 'clock_not_running' };
  const deadline = Date.parse(clock.deadlineAt);
  const now = Date.parse(clock.serverNow);
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return { kind: 'clock_not_running' };
  if (now < deadline) return { kind: 'not_overdue', deadlineAt: clock.deadlineAt, serverNow: clock.serverNow };
  return { kind: 'go' };
}

/**
 * How late past the deadline a manager's OWN pick (action:'pick') is still
 * accepted: network latency only, so a pick sent at 0:01 that arrives after
 * 0:00 still counts. NOT extra thinking time — the room hides Draft at 0:00.
 * The auto-pick may fire inside this window too; the (league_id, pick_number)
 * unique index lets the first committed insert win (the other gets
 * pick_conflict). Ruling: Giorgio, 2026-10-13 (docs/PRODUCT_RULES.md › Draft).
 * NOMINAL: the clock is read BEFORE pricing (Alpaca) and the insert, so a pick
 * that passes at deadline + 1.9 s commits later still. The effective window is
 * this grace plus the request's own processing time; the unique
 * (league_id, pick_number) index settles any race with the auto-pick.
 */
export const MANUAL_PICK_GRACE_MS = 2_000;

export type ManualPickClockGate =
  | { kind: 'go' }
  | { kind: 'turn_moved' }
  | { kind: 'clock_expired'; deadlineAt: string; serverNow: string }
  | { kind: 'clock_unreadable' };

/**
 * May the server still accept a manager's own pick for `pickNumber` (the pick
 * the caller is about to write: picks already recorded + 1)? Reads the same
 * get_draft_clock row the auto-pick gate does, on the DB clock.
 *  - clock_unreadable: the clock read failed or is malformed. FAIL CLOSED —
 *    this gate exists to stop a late pick, so a read failure must not reopen
 *    that gap. The refusal is recoverable: the caller answers 500 'unhandled',
 *    the room re-reads, and the manager picks again while the clock runs; if
 *    it runs out, the auto-pick takes the turn (the product rule's own path).
 *  - turn_moved: the clock describes a different pick than the one being
 *    written (a pick landed between the two reads), so its deadline is not
 *    this pick's to judge. The insert would conflict anyway: pick_conflict.
 *  - go, unclocked: clock_running false (pick_clock_enabled = false, or the
 *    draft is no longer in_progress). There is no deadline, and the sweep never
 *    auto-picks such a draft, so refusing would leave the turn with no way to
 *    be filled. Every other check still runs after this gate.
 *  - clock_expired: server_now >= deadline_at + MANUAL_PICK_GRACE_MS.
 *  - go: otherwise (before the deadline, or within the grace).
 * get_draft_clock has no pause: deadline_at = turn start + pick_seconds, and
 * a STALLED turn (the auto-pick found nothing legal, or is waiting for prices)
 * keeps its past deadline, so it stays expired here — the turn belongs to the
 * auto-pick, which the sweep retries. RULED (Giorgio, 2026-10-13: "the auto
 * pick has to work"): no manual rescue of a stalled turn after the clock; the
 * fix for a stall belongs in the auto-pick, not in this gate.
 */
export function decideManualPickClock(pickNumber: number, clock: DraftClock | null): ManualPickClockGate {
  if (!clock) return { kind: 'clock_unreadable' };
  if (clock.picksMade + 1 !== pickNumber) return { kind: 'turn_moved' };
  if (!clock.clockRunning) return { kind: 'go' };
  if (!clock.deadlineAt) return { kind: 'clock_unreadable' };
  const deadline = Date.parse(clock.deadlineAt);
  const now = Date.parse(clock.serverNow);
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return { kind: 'clock_unreadable' };
  if (now >= deadline + MANUAL_PICK_GRACE_MS) {
    return { kind: 'clock_expired', deadlineAt: clock.deadlineAt, serverNow: clock.serverNow };
  }
  return { kind: 'go' };
}

// ---------------------------------------------------------------------------
// Open slots (what the search looks for)
// ---------------------------------------------------------------------------

/** One open slot's search filter: price bracket (upper bound clamped to the
 * remaining budget in budget_cap mode) and category (null = flex). */
export interface SlotSpec {
  min: number | null;
  max: number | null;
  categoryId: string | null;
}

/** One open slot's EXACT window, before any search margin: its bracket, the
 * budget/reserve top (null = no budget rule), its category. `key` is the slot id
 * (FLEX_TYPE_ID for a slot-less league). */
export interface SlotWindow {
  key: string;
  min: number | null;
  max: number | null;
  top: number | null;
  categoryId: string | null;
}

/** How far a search reaches past a window: `bracket` widens the floor down and
 * the ceiling up, `cap` raises the budget/reserve top. Relative (0.1 = 10%). */
export interface SearchMargins {
  bracket: number;
  cap: number;
}

/** The first search's margins (2026-10-05 review H2): brackets widened 10%, the
 * budget top exact. */
export const SEARCH_MARGINS: SearchMargins = { bracket: 0.1, cap: 0 };

/** NEAR-MISS margin (2026-10-13, "the auto pick has to work"): a stock whose
 * CACHED price is up to 50% past an open slot's floor, ceiling or budget top may
 * be legal at its LIVE price (symbols.last_price is up to ~2 trading days old, and
 * older for a symbol enrich-symbols has not reached). Such a stock is priced
 * through the batched screen, never refused on its cached price. */
export const NEAR_MISS_MARGIN = 0.5;

/** The second search (only when the first finds nothing legal): every window
 * widened by NEAR_MISS_MARGIN, on the budget top too. */
export const NEAR_MISS_MARGINS: SearchMargins = { bracket: NEAR_MISS_MARGIN, cap: NEAR_MISS_MARGIN };

const floorCents = (x: number) => Math.floor(x * 100 + 1e-9) / 100;
const ceilCents = (x: number) => Math.ceil(x * 100 - 1e-9) / 100;

/**
 * The slots this picker could still fill, as exact windows — one per slot with
 * spare capacity (occupancy = the picker's non-SKIP picks' slot_id). A slot-less
 * league has a single window bounded only by budget. Empty = no slot can take
 * anything (roster full).
 */
export function openSlotWindows(
  rules: LeagueRules,
  slots: Slot[],
  picks: PickRow[],
  trades: TradeRow[],
  pickerId: string,
  /** Optional per-slot cap on the price (chooseAutoPick: the reserve after
   * filling that slot, subtracted from budget left). Keyed by slot id;
   * FLEX_TYPE_ID for a slot-less league. A NECESSARY condition only, so it
   * can never hide a legal stock. */
  capFor?: (key: string) => number,
): SlotWindow[] {
  const budgetMax = rules.stakeMode === 'budget_cap'
    ? Math.max((Number(rules.budgetAmount) || 0) - userCashSpent(pickerId, picks, trades), 0)
    : null;
  const topFor = (key: string): number | null => {
    const cap = capFor ? capFor(key) : Infinity;
    const combined = Math.min(budgetMax == null ? Infinity : budgetMax, cap);
    return combined === Infinity ? null : combined;
  };

  if (slots.length === 0) return [{ key: FLEX_TYPE_ID, min: null, max: null, top: topFor(FLEX_TYPE_ID), categoryId: null }];
  const occupancy = new Map<string, number>();
  for (const p of picks) {
    if (String(p.user_id) !== pickerId || (p.symbol ?? '').toUpperCase() === SKIP_SYMBOL || !p.slot_id) continue;
    occupancy.set(p.slot_id, (occupancy.get(p.slot_id) ?? 0) + 1);
  }
  return slots
    .filter((s) => (occupancy.get(s.id) ?? 0) < s.slotCount)
    .map((s) => ({ key: s.id, min: s.priceMin, max: s.priceMax, top: topFor(s.id), categoryId: s.categoryId }));
}

/**
 * The search filter per open slot: each exact window widened by `margins`,
 * de-duplicated. The search brackets are widened so a stock whose cached price
 * sits outside a bracket is still found and priced live (2026-10-05 review H2;
 * 2026-10-13 near-miss pass). The gate stays exact; only the search widens.
 * Rounded OUTWARD to cents (floor below, ceil above, epsilon for float noise): the
 * search stays a superset of the exact window. A window whose top is <= 0 (budget
 * exhausted, or a reserve no stock can meet) can take nothing and is dropped.
 */
export function openSlotSpecs(
  rules: LeagueRules,
  slots: Slot[],
  picks: PickRow[],
  trades: TradeRow[],
  pickerId: string,
  capFor?: (key: string) => number,
  margins: SearchMargins = SEARCH_MARGINS,
): SlotSpec[] {
  const raw: SlotSpec[] = openSlotWindows(rules, slots, picks, trades, pickerId, capFor).map((w) => {
    const top = w.top == null ? null : margins.cap > 0 && w.top > 0 ? ceilCents(w.top * (1 + margins.cap)) : w.top;
    const max = w.max == null ? null : ceilCents(w.max * (1 + margins.bracket));
    return {
      min: w.min == null ? null : floorCents(w.min * (1 - margins.bracket)),
      max: top == null ? max : max == null ? top : Math.min(max, top),
      categoryId: w.categoryId,
    };
  });

  const seen = new Set<string>();
  return raw.filter((b) => {
    if (b.max != null && !(b.max > 0)) return false; // budget exhausted
    if (b.min != null && b.max != null && b.min > b.max) return false;
    const key = `${b.min}:${b.max}:${b.categoryId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Could a price move of up to `margin` make this stock fit an open window it
 * does not fit at `price` (its cached price)? True when, for some open window
 * whose category the stock is eligible for, `price` is OUTSIDE the exact window
 * (bracket on the tier price, or above the budget/reserve top) but inside the
 * window widened by `margin`. PURE. Decides only WHAT TO PRICE: a near-miss is
 * screened at its live price, never refused on its cached one.
 */
export function isNearMiss(windows: SlotWindow[], price: number, eligibility: Set<string>, margin: number = NEAR_MISS_MARGIN): boolean {
  const p = tierPrice(price);
  if (!Number.isFinite(p) || !(price > 0)) return false;
  const eps = 1e-9;
  return windows.some((w) => {
    if (w.top != null && !(w.top > 0)) return false; // this window can take nothing at any price
    if (w.categoryId != null && !eligibility.has(w.categoryId)) return false; // no price fixes a category
    const inside = (w.min == null || p >= w.min) && (w.max == null || p <= w.max) && (w.top == null || price <= w.top + eps);
    if (inside) return false;
    return (w.min == null || price >= w.min * (1 - margin) - eps) &&
      (w.max == null || price <= w.max * (1 + margin) + eps) &&
      (w.top == null || price <= w.top * (1 + margin) + eps);
  });
}

/**
 * One open slot's search cap in a budget league: what the budget rule leaves for
 * this slot's stock. budget - spent - reserve(after filling it) + the picker's
 * existing shortfall (never-worsen admits exactly that much more). A NECESSARY
 * condition only (the gate's reserve, with the stock taken out of the pool, can
 * only be higher). Infinity-safe, never NaN: an infinite shortfall already means
 * the reserve no longer binds (Infinity); a finite one with an infinite reserve
 * after the pick means this slot can take nothing (-1).
 */
export function slotCap(budget: number, spent: number, reserveAfter: number, shortfallBefore: number): number {
  if (shortfallBefore === Infinity) return Infinity;
  if (!Number.isFinite(reserveAfter)) return -1;
  return budget - spent - reserveAfter + shortfallBefore;
}

/**
 * Should a budget_reserve refusal at the cached price be priced live? Only when a
 * live price could close it: a lower price changes only the pick's COST, not the
 * cached-pool reserve, so the refusal is reachable only if its excess is at most
 * NEAR_MISS_MARGIN of the cost (2026-10-13 review H2). Anything else is final and
 * free, as before the screen existed.
 */
export function reserveNearMiss(g: { ok: boolean; reason?: string; budgetExcess?: number }, cachedPrice: number): boolean {
  if (g.ok || g.reason !== 'budget_reserve') return false;
  const excess = g.budgetExcess ?? Infinity;
  return Number.isFinite(excess) && excess <= NEAR_MISS_MARGIN * cachedPrice + 1e-9;
}

// ---------------------------------------------------------------------------
// Best-available ranking (pluggable; market cap by Giorgio's decision)
// ---------------------------------------------------------------------------

export interface BestAvailableStrategy {
  /** Stable id, logged with each auto-pick so a changed basis is visible. */
  id: string;
  /** Rows to request per open slot per search round. */
  searchPerSlot: number;
  /** Order a merged search result best-first (it may also drop rows). */
  rank(candidates: BotSymbolCandidate[]): string[];
}

/** DECIDED (Giorgio, 2026-09-29): "best available" = the largest company that
 * fits — walk the market by market cap, descending, and take the next one
 * that passes the league's rules. Unpriced rows (only returned for
 * allow_undraftable leagues) go last; ties break alphabetically. */
export const MARKET_CAP_STRATEGY: BestAvailableStrategy = {
  id: 'market_cap_desc',
  searchPerSlot: 20,
  rank: (candidates) =>
    [...candidates]
      .sort((a, b) =>
        Number(a.lastPrice == null) - Number(b.lastPrice == null) ||
        (b.marketCap ?? 0) - (a.marketCap ?? 0) ||
        a.symbol.localeCompare(b.symbol)
      )
      .map((c) => c.symbol.toUpperCase()),
};

export const BEST_AVAILABLE_STRATEGY: BestAvailableStrategy = MARKET_CAP_STRATEGY;

export const QUEUE_MAX_ATTEMPTS = 5;
/** Live Alpaca price calls per auto-pick. A bound on quota, NOT on the search:
 * a candidate refused live gets its cached price refreshed (recordLivePrices),
 * so it drops out of the free pre-check on every later call and the walk makes
 * progress across ticks. Liveness (2026-10-05): see chooseAutoPick. */
export const LIVE_MAX_ATTEMPTS = 20;
/** Pool rows walked per auto-pick (a CPU bound, far above any real pool). */
export const WALK_MAX_CANDIDATES = 20000;
/** Wall-clock budget per auto-pick walk (the edge function's limit is far above it). */
export const WALL_BUDGET_MS = 25_000;
/** A symbol whose live price failed is skipped (no network call) for this long, so
 * the walk moves past one dead symbol to the next legal candidate (2026-10-05). */
export const PRICE_COOLDOWN_MS = 5 * 60_000;
/** A turn that has been stopped only by vendor outages for this long is escalated
 * once: a draft_stalls row (reason 'vendor_outage') and one commissioner push. */
export const OUTAGE_ESCALATE_MS = 5 * 60_000;

/** The escalation decision for one turn's outage row. Pure; draft-write.ts does the I/O. */
export function outageEscalation(
  firstSeenMs: number,
  nowMs: number,
  alreadyEscalated: boolean,
  thresholdMs: number = OUTAGE_ESCALATE_MS,
): 'wait' | 'escalate' | 'done' {
  if (alreadyEscalated) return 'done';
  return nowMs - firstSeenMs >= thresholdMs ? 'escalate' : 'wait';
}
/** Rows per search page (the RPC's maximum). */
export const BEST_PAGE = 100;
/** The live-price SCREEN (2026-10-13): Alpaca snapshot requests per auto-pick,
 * bisection included (./price-bisect.ts fetchPricesBisecting). Each
 * request prices up to SCREEN_CHUNK symbols, so one request settles a whole page
 * of near-misses that would otherwise cost one fill call (up to 3 requests) each. */
export const SCREEN_MAX_REQUESTS = 5;
export const SCREEN_CHUNK = 100;
/** A cached price whose symbols.last_price_at is younger than this was written
 * from a live price (review H1, 2026-10-13): it is judged as live, so its
 * refusal is final and free, and it is never screened again inside the window.
 * That is what makes a long walk PROGRESS across ticks instead of re-pricing the
 * same fringe forever. Longer than the slowest whole-pool walk (5 screen requests
 * = 500 symbols per call, one call a minute under the stall cooldown). */
export const FRESH_MS = 30 * 60_000;
/** A turn whose search keeps ending on a BOUND (not an outage, not a proof that
 * nothing is legal) is recorded in draft_stalls as 'search_bounded' on every
 * such call, attempts climbing (the cron and recentStall then hold it for
 * STALL_COOLDOWN_MS). From this many in a row the turn reports 'stalled'. No
 * commissioner push (2026-10-13); the row and the logs are the operator's. */
export const BOUNDED_STALL_AFTER = 10;

/** Does a turn with this many consecutive bounded searches report 'stalled'?
 * PURE. The count is bumped atomically in SQL (public.note_draft_bounded, review
 * L2); this only reads it. No push either way (Giorgio, 2026-10-13). */
export function boundedReportsStalled(attempts: number): boolean {
  return attempts >= BOUNDED_STALL_AFTER;
}

/** What a turn's existing draft_stalls row means for THIS call. PURE.
 *  'search'  : run the search (no row, an outage row, or the cooldown is over);
 *  'stalled' : inside the cooldown of a legality stall, or of a bound that has
 *              reached BOUNDED_STALL_AFTER;
 *  'retry'   : inside the cooldown of a bound below it (the turn is open,
 *              the search is still making progress: never reported as a stall). */
export function stallCooldownVerdict(
  row: { reason: string; attempts: number; lastSeenMs: number } | null,
  nowMs: number,
  cooldownMs: number,
): 'search' | 'stalled' | 'retry' {
  if (!row || row.reason === 'vendor_outage') return 'search';
  if (!Number.isFinite(row.lastSeenMs) || nowMs - row.lastSeenMs >= cooldownMs) return 'search';
  if (row.reason === 'search_bounded') return row.attempts >= BOUNDED_STALL_AFTER ? 'stalled' : 'retry';
  return 'stalled';
}

/** Queue rows PLANNED per auto-pick (near-misses included). Fill calls on the
 * queue stay capped at QUEUE_MAX_ATTEMPTS; a screened-out row costs none. */
export const QUEUE_PLAN_MAX = 20;

// ---------------------------------------------------------------------------
// Queue planning (pure)
// ---------------------------------------------------------------------------

/**
 * The manager's queue, in THEIR order, minus what cannot possibly be legal on
 * the catalog's facts: missing from the catalog, owned in the league, not
 * draftable (unless the league allows it), or (on the cached price) fitting no
 * OPEN slot by price/budget/category. What survives is only worth TRYING —
 * the live gate still decides. Capped at `max` (default QUEUE_MAX_ATTEMPTS).
 *
 * `margin` (default 0 = exact) widens the cached-price checks (brackets and the
 * budget) by that fraction: chooseAutoPick plans with NEAR_MISS_MARGIN so a
 * queued stock whose CACHED price left its bracket but whose live price did not
 * is still tried from the queue (2026-10-13), and screens it before a fill call.
 */
export function planQueueCandidates(i: {
  rules: LeagueRules;
  slots: Slot[];
  picks: PickRow[];
  trades: TradeRow[];
  pickerId: string;
  queue: string[];
  queueMeta: BotSymbolCandidate[];
  eligibility: Map<string, Set<string>>;
  margin?: number;
  max?: number;
}): BotSymbolCandidate[] {
  const margin = i.margin ?? 0;
  const max = i.max ?? QUEUE_MAX_ATTEMPTS;
  const meta = new Map(i.queueMeta.map((c) => [c.symbol.toUpperCase(), c]));
  const keep = candidateFilter({ rules: i.rules, slots: i.slots, picks: i.picks, trades: i.trades, botId: i.pickerId }, {
    unpricedOk: true,
    margin,
  });
  const occupied = i.picks
    .filter((p) => String(p.user_id) === i.pickerId && (p.symbol ?? '').toUpperCase() !== SKIP_SYMBOL)
    .map((p) => p.slot_id);
  // The exact test is assignSlot itself; a margin widens each slot's bracket
  // (same rounding direction as openSlotSpecs) and asks the same question.
  const widened = margin > 0
    ? i.slots.map((s) => ({
      ...s,
      priceMin: s.priceMin == null ? null : floorCents(s.priceMin * (1 - margin)),
      priceMax: s.priceMax == null ? null : ceilCents(s.priceMax * (1 + margin)),
    }))
    : i.slots;
  const fitsOpenSlot = (c: BotSymbolCandidate) =>
    i.slots.length === 0 || c.lastPrice == null ||
    assignSlot(widened, occupied, c.lastPrice, i.eligibility.get(c.symbol.toUpperCase()) ?? new Set()) !== null;

  const out: BotSymbolCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of i.queue) {
    if (out.length >= max) break;
    const c = meta.get(raw.toUpperCase());
    if (!c || seen.has(c.symbol) || !keep(c) || !fitsOpenSlot(c)) continue;
    seen.add(c.symbol);
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// No-pick outcome
// ---------------------------------------------------------------------------

export type NoPickOutcome =
  | { kind: 'stalled' }
  | { kind: 'retry_later' };

/**
 * After the search found nothing the gate accepted. NO SKIP, for humans or
 * bots (2026-10-05). Candidates existed but none could be priced: a vendor
 * outage, so the turn stays open and the next attempt retries. Otherwise the
 * search found no legal stock: 'stalled' — the turn stays open, the failure is
 * recorded and alerted, and nothing is written for the picker.
 */
export function decideNoPick(outages: number): NoPickOutcome {
  if (outages > 0) return { kind: 'retry_later' };
  return { kind: 'stalled' };
}

// ---------------------------------------------------------------------------
// The search (I/O injected)
// ---------------------------------------------------------------------------

export interface AutoPickState {
  leagueId: string;
  rules: LeagueRules;
  order: string[];
  numRounds: number;
  picks: PickRow[];
  trades: TradeRow[];
}

export interface AutoPickPorts {
  loadSlots(): Promise<Slot[]>;
  /** The manager's queue in position order + their catalog rows. */
  loadQueue(pickerId: string): Promise<{ queue: string[]; meta: BotSymbolCandidate[] }>;
  /** public.auto_pick_search_candidates for ONE open slot: largest first,
   * fitting spec (bracket on the cached price, category), active, draftable
   * when draftableOnly, not in `exclude`. */
  searchCandidates(spec: SlotSpec, exclude: string[], draftableOnly: boolean, limit: number): Promise<BotSymbolCandidate[]>;
  /** Effective category ids per symbol (every requested symbol present). */
  eligibility(symbols: string[]): Promise<Map<string, Set<string>>>;
  /** Live fill price; price null = could not be priced. */
  livePrice(symbol: string): Promise<{ price: number | null; source: string | null }>;
  /** The batched live-price SCREEN: latest trade / minute-bar prices for up to
   * SCREEN_CHUNK symbols, using at most `maxRequests` vendor requests. NEVER
   * throws: a symbol it could not price is simply absent (the caller falls back
   * to livePrice for it). `requests` = vendor requests spent. `unavailable` = the
   * vendor failed (not a per-symbol 400): the caller stops screening this call. A screen price only
   * decides what to try; the pick is always gated on livePrice. */
  screenPrices(symbols: string[], maxRequests: number): Promise<{ prices: Map<string, number>; requests: number; unavailable?: boolean }>;
  /** Write live prices (trade / minute-bar) back to the catalog cache in ONE
   * batched write, stamping symbols.last_price_at (public.record_live_prices).
   * Best effort, never throws: the next walk then judges these symbols on their
   * fresh prices, for free. */
  recordLivePrices(prices: Map<string, number>): Promise<void>;
  /** Of these symbols, when each cached price was last written from a live price
   * (ms epoch; symbols.last_price_at). Missing = unknown = stale. Never throws: a
   * failed read is "all stale", which only costs screen requests, never a pick. */
  priceAges(symbols: string[]): Promise<Map<string, number>>;
  /** Of these symbols, the ones whose live price failed within PRICE_COOLDOWN_MS. */
  coolingSymbols(symbols: string[]): Promise<Set<string>>;
  /** A live price was unavailable for this symbol just now (best effort). */
  recordPriceFailure(symbol: string): Promise<void>;
  /** The symbol priced live: any failure record is cleared (best effort). */
  clearPriceFailure(symbol: string): Promise<void>;
  /** public.draft_feasibility_pool: the pool grouped by signature over the
   * given types, owned symbols excluded, cheapest `depth` prices per group. */
  feasibilityPool(types: Slot[], exclude: string[], draftableOnly: boolean, depth: number): Promise<PoolGroup[]>;
}

export type AutoPickChoice =
  | { kind: 'pick'; gated: GatedPick; source: 'auto_queue' | 'auto_best' | 'bot'; priceSource: string | null; attempts: number }
  | { kind: 'stalled'; pickerId: string; why: 'nothing_legal'; attempts: number }
  | { kind: 'retry_later'; attempts: number; outage: boolean }
  | { kind: 'draft_complete' }
  | { kind: 'conflict' };

/**
 * Choose — never write — the auto-pick for whoever's turn it is NOW (never a
 * caller-named target). `expectedPickNumber`: the pick the caller's gate
 * authorized; if the draft has moved on, return 'conflict' rather than picking
 * for the NEXT manager.
 *
 * LIVENESS (2026-10-05, Orchestrator): a legal pick is found whenever one exists.
 * There is no top-N window: best available WALKS THE WHOLE POOL, market-cap
 * descending, page by page, excluding what was already judged. Each candidate is
 *   1. judged FREE at its cached price by the same gatePick (no network). A refusal
 *      no price could change (category, would strand another manager at every slot
 *      its price could reach) costs nothing and is final for this call;
 *   2. if it passes, priced LIVE (one fill call). The live gate decides. The live
 *      price is written back to the cache, so a candidate refused live drops out of
 *      step 1 on every later call and the walk progresses across ticks;
 *   3. if it was refused at its cached price for a reason a LIVE price could change
 *      (2026-10-13, "the auto pick has to work"): the budget reserve, or a cached
 *      price outside an open window but within NEAR_MISS_MARGIN of it; or it has no
 *      cached price: it is SCREENED. One batched snapshot request prices a whole
 *      page of these; a screen price the gate refuses settles it for free, one the
 *      gate accepts (or no screen price) goes to step 2's fill call.
 * Two searches: the first with SEARCH_MARGINS (brackets +-10%, budget exact); if it
 * finds nothing legal, the NEAR-MISS search (every window widened by
 * NEAR_MISS_MARGIN, the budget top too) walks what the first did not judge.
 * 'stalled' means: both searches walked the whole pool, nothing passed the gate, and
 * no candidate was lost to a vendor outage. A vendor outage on a candidate that would
 * have gone live, or the live-call bound, is 'retry_later'. Residual: a legal stock
 * whose cached price is more than NEAR_MISS_MARGIN outside every open window is found
 * once its cache refreshes.
 *
 * Feasibility: the pool and the league's open demand are read once. Each open
 * slot's search is capped at the reserve left after filling it (a necessary
 * condition, so no legal stock is hidden).
 *
 * Throws if a port throws (a failed read must not look like "nothing legal").
 */
export async function chooseAutoPick(
  s: AutoPickState,
  ports: AutoPickPorts,
  expectedPickNumber: number | null,
  strategy: BestAvailableStrategy = BEST_AVAILABLE_STRATEGY,
): Promise<AutoPickChoice> {
  const turn = currentTurn(s.picks.length, s.order, s.numRounds);
  if (!turn) return { kind: 'draft_complete' };
  if (expectedPickNumber != null && turn.pickNumber !== expectedPickNumber) return { kind: 'conflict' };
  const pickerId = turn.pickerId;
  const isBot = pickerId.startsWith('bot-');

  const slots = await ports.loadSlots();
  const hasCategorySlots = slots.some((x) => x.categoryId != null);
  const eligibilityCache = new Map<string, Set<string>>();
  const eligibilityFor = async (symbols: string[]) => {
    if (!hasCategorySlots) return;
    const missing = symbols.filter((x) => !eligibilityCache.has(x));
    if (missing.length === 0) return;
    for (const [k, v] of await ports.eligibility(missing)) eligibilityCache.set(k, v);
  };
  const eligibilityOf = (symbol: string) => eligibilityCache.get(symbol) ?? new Set<string>();

  // Feasibility state: one read of the pool and the aggregate open demand.
  const types = typesFromSlots(slots, s.numRounds);
  const demand = demandVector(types, s.order, s.picks, s.numRounds);
  const owned = [...leagueOwnedSymbols(s.picks, s.trades)];
  const draftableOnly = s.rules.allowUndraftable !== true;
  const totalDemand = demand.reduce((a, b) => a + b, 0);
  const groups = await ports.feasibilityPool(types, owned, draftableOnly, totalDemand + 1);
  const budget = s.rules.stakeMode === 'budget_cap' ? Number(s.rules.budgetAmount) || 0 : null;
  const state: FeasibilityState = { types, demand, groups, budget };
  const open = openInstances(types, s.picks, pickerId, s.numRounds);
  const spent = userCashSpent(pickerId, s.picks, s.trades);
  // Budget never-worsen (2026-10-13): the gate admits a pick that does not grow
  // the picker's existing shortfall, so each slot's search cap is loosened by it,
  // or the window would close (top <= 0) on stocks the gate accepts.
  const shortPre = preShortfall(state, open, spent);
  const capByKey = new Map<string, number>();
  if (budget != null) {
    types.forEach((t, j) => {
      if (open[j] <= 0) return;
      const postOpen = open.slice();
      postOpen[j] -= 1;
      const postDemand = demand.slice();
      postDemand[j] -= 1;
      const reserve = reserveFor(postOpen, postDemand, types, groups);
      capByKey.set(t.id, slotCap(budget, spent, reserve, shortPre));
    });
  }

  const preDeficit = deficit(state.demand, state.groups);
  const deadline = Date.now() + WALL_BUDGET_MS;
  const capFor = (key: string) => capByKey.get(key) ?? Infinity;
  const windows = openSlotWindows(s.rules, slots, s.picks, s.trades, pickerId, capFor);

  const tried = new Set<string>();
  let attempts = 0; // live price calls
  let outages = 0; // candidates that passed the free check but could not be priced
  let liveBudgetHit = false;

  const gateAt = (c: BotSymbolCandidate, price: number, symbol: string, isDraftable: boolean) =>
    gatePick(s.leagueId, {
      rules: s.rules,
      slots,
      order: s.order,
      picks: s.picks,
      trades: s.trades,
      pickerId,
      symbol,
      price,
      eligibleCategories: eligibilityOf(symbol),
      isDraftable,
    }, { state, open, cachedPrice: c.lastPrice, eligibility: eligibilityOf(symbol), preDeficit, preShortfall: shortPre });

  // The SCREEN (2026-10-13): live prices for many candidates in one vendor
  // request. A screen price the gate refuses settles that candidate for this call
  // at no fill-call cost; a screen price the gate accepts, or no screen price at
  // all, goes to the fill (liveTry), which decides. The screen can only SAVE fill
  // calls: anything it cannot price is judged exactly as before it existed.
  const screened = new Map<string, number>();
  const screenAsked = new Set<string>();
  let screenRequests = 0;
  // CIRCUIT BREAKER (review M3): once the vendor fails a screen request
  // (401/403/429/5xx/network/timeout), no more screening this call: every
  // remaining candidate goes to the fill path, which judges outages as before.
  let screenDown = false;
  const screen = async (symbols: string[]) => {
    const want = [...new Set(symbols)].filter((x) => !screenAsked.has(x));
    for (let i = 0; i < want.length; i += SCREEN_CHUNK) {
      const left = SCREEN_MAX_REQUESTS - screenRequests;
      if (left <= 0 || screenDown) return; // bound reached / vendor down: fall back to fill calls
      if (Date.now() > deadline) return; // the walk's own deadline check ends the call
      const chunk = want.slice(i, i + SCREEN_CHUNK);
      for (const x of chunk) screenAsked.add(x);
      const r = await ports.screenPrices(chunk, left);
      screenRequests += Math.max(r.requests, 1);
      if (r.unavailable) screenDown = true;
      const got = new Map<string, number>();
      for (const [k, v] of r.prices) if (Number.isFinite(v) && v > 0) got.set(k.toUpperCase(), v);
      for (const [k, v] of got) screened.set(k, v);
      // Every screen price is a trade or minute-bar price: write the page back in
      // ONE call, so the next tick judges these symbols as fresh (review H1).
      if (got.size > 0) await ports.recordLivePrices(got);
    }
  };
  // Freshness (review H1): a cached price written from a live price within
  // FRESH_MS is judged as live. Read in one batch per page / queue.
  const ages = new Map<string, number>();
  const loadAges = async (symbols: string[]) => {
    const want = symbols.filter((x) => !ages.has(x));
    if (want.length === 0) return;
    for (const [k, v] of await ports.priceAges(want)) ages.set(k.toUpperCase(), v);
  };
  const isFresh = (c: BotSymbolCandidate, symbol: string) => {
    if (c.lastPrice == null) return false;
    const at = ages.get(symbol);
    return at != null && Date.now() - at < FRESH_MS;
  };
  /** Refused at a LIVE screen price: final for this call, no fill call. */
  const screenRefuses = (c: BotSymbolCandidate, symbol: string) => {
    const sp = screened.get(symbol);
    return sp != null && !gateAt(c, sp, symbol, c.isDraftable === true).ok;
  };

  // One candidate, priced LIVE and judged by the one gate. A null = refused or unpriced.
  const liveTry = async (c: BotSymbolCandidate): Promise<{ gated: GatedPick; source: string | null } | null> => {
    const symbol = c.symbol.toUpperCase();
    if (attempts >= LIVE_MAX_ATTEMPTS) {
      liveBudgetHit = true;
      return null;
    }
    attempts++;
    const live = await ports.livePrice(symbol);
    if (live.price == null) {
      outages++;
      await ports.recordPriceFailure(symbol);
      return null;
    }
    await ports.clearPriceFailure(symbol);
    // Write back only a trade or a bar price (the fresh sources). A bid/ask quote
    // is a looser signal and must not move the cache every league prices from.
    if (live.source === 'trade.p' || live.source === 'bar.c') {
      await ports.recordLivePrices(new Map([[symbol, live.price]]));
    }
    await eligibilityFor([symbol]);
    const g = gateAt(c, live.price, symbol, c.isDraftable === true); // the catalog's flag, never "unknown = draftable"
    return g.ok ? { gated: g.pick, source: live.source } : null;
  };

  // 1. The manager's queue, in their order (bounded: it is their preference list).
  //    Planned with the near-miss margin, so a queued stock whose cached price is
  //    stale is still tried from the queue; such rows are screened first.
  if (!isBot) {
    const q = await ports.loadQueue(pickerId);
    await eligibilityFor(q.meta.map((c) => c.symbol.toUpperCase()));
    const queueInputs = {
      rules: s.rules,
      slots,
      picks: s.picks,
      trades: s.trades,
      pickerId,
      queue: q.queue,
      queueMeta: q.meta,
      eligibility: eligibilityCache,
      max: QUEUE_PLAN_MAX,
    };
    const queued = planQueueCandidates({ ...queueInputs, margin: NEAR_MISS_MARGIN });
    const exact = new Set(planQueueCandidates(queueInputs).map((c) => c.symbol.toUpperCase()));
    const coolingQ = await ports.coolingSymbols(queued.map((c) => c.symbol.toUpperCase()));
    await loadAges(queued.map((c) => c.symbol.toUpperCase()));
    const queuedBy = new Map(queued.map((c) => [c.symbol.toUpperCase(), c]));
    const toScreen = queued
      .map((c) => c.symbol.toUpperCase())
      .filter((x) => !exact.has(x) && !coolingQ.has(x) && !isFresh(queuedBy.get(x)!, x));
    let fills = 0;
    for (const c of queued) {
      if (fills >= QUEUE_MAX_ATTEMPTS) break;
      if (Date.now() > deadline) {
        console.error('auto-pick: wall-clock budget reached in the queue, turn left open', s.leagueId, { attempts, screenRequests });
        return { kind: 'retry_later', attempts, outage: false };
      }
      const symbol = c.symbol.toUpperCase();
      tried.add(symbol);
      if (coolingQ.has(symbol)) {
        outages++; // cooling: a known-dead price, no network call, the walk moves on
        continue;
      }
      if (!exact.has(symbol)) {
        if (isFresh(c, symbol)) {
          // A fresh cached price IS a live price: no screen; the gate on it decides.
          if (!gateAt(c, c.lastPrice!, symbol, c.isDraftable === true).ok) continue;
        } else {
          await screen(toScreen); // once: one request for every stale near-miss on the queue
          if (screenRefuses(c, symbol)) continue;
        }
      }
      fills++;
      const hit = await liveTry(c);
      if (hit) return { kind: 'pick', gated: hit.gated, source: 'auto_queue', priceSource: hit.source, attempts };
    }
  }

  // 2. Best available: walk the whole pool, market cap descending. Each candidate is
  //    'live' (passes the free gate at its cached price: priced by a fill call),
  //    'screen' (no cached price, or refused at it for a reason a live price could
  //    change: the budget reserve, or a near-miss on an open window), or 'skip' (a
  //    refusal no price can change, e.g. the only slots it fits would strand someone).
  type Plan = 'live' | 'screen' | 'skip';
  const planOf = (c: BotSymbolCandidate, symbol: string): Plan => {
    if (c.lastPrice == null) return 'screen';
    const g = gateAt(c, c.lastPrice, symbol, c.isDraftable === true);
    if (g.ok) return 'live';
    // A fresh cached price IS a live price (review H1): its refusal is final.
    if (isFresh(c, symbol)) return 'skip';
    if (reserveNearMiss(g, c.lastPrice) || isNearMiss(windows, c.lastPrice, eligibilityOf(symbol), NEAR_MISS_MARGIN)) return 'screen';
    return 'skip';
  };

  let walked = 0;
  type WalkEnd = { kind: 'pick'; gated: GatedPick; source: string | null } | { kind: 'exhausted' } | { kind: 'bounded' } | {
    kind: 'deadline';
  };
  const walk = async (specs: SlotSpec[]): Promise<WalkEnd> => {
    if (specs.length === 0) return { kind: 'exhausted' };
    while (!liveBudgetHit) {
      if (walked >= WALK_MAX_CANDIDATES) return { kind: 'bounded' };
      const exclude = [...owned, ...tried];
      const results = await Promise.all(
        specs.map((spec) => ports.searchCandidates(spec, exclude, draftableOnly, BEST_PAGE)),
      );
      const bySymbol = new Map<string, BotSymbolCandidate>();
      for (const rows of results) for (const r of rows) bySymbol.set(r.symbol.toUpperCase(), r);
      const fresh = strategy.rank([...bySymbol.values()]).filter((x) => !tried.has(x) && bySymbol.has(x));
      if (fresh.length === 0) return { kind: 'exhausted' };
      // One batched eligibility, cooldown and price-age read per page.
      await eligibilityFor(fresh);
      const cooling = await ports.coolingSymbols(fresh);
      await loadAges(fresh);
      const plans = new Map<string, Plan>();
      const plan = (symbol: string) => {
        let p = plans.get(symbol);
        if (!p) plans.set(symbol, p = planOf(bySymbol.get(symbol)!, symbol));
        return p;
      };
      for (let i = 0; i < fresh.length; i++) {
        const symbol = fresh[i];
        tried.add(symbol);
        walked++;
        const c = bySymbol.get(symbol)!;
        if (Date.now() > deadline) return { kind: 'deadline' }; // wall-clock bound: retry, never a silent kill
        const p = plan(symbol);
        if (p === 'skip') continue; // a legality refusal no price changes, cooled or not
        // Only a candidate that WOULD have gone live counts as an outage when cooled
        // (review finding 2): a cooled symbol the gate refuses anyway must not turn a
        // true stall into a vendor_outage.
        if (cooling.has(symbol)) {
          outages++; // cooling: skip the dead symbol, keep walking for a priced legal one
          continue;
        }
        if (p === 'screen') {
          if (!screenAsked.has(symbol)) {
            // First screen on this page: screen every remaining 'screen' row at once.
            await screen(fresh.slice(i).filter((x) => !cooling.has(x) && plan(x) === 'screen'));
          }
          if (screenRefuses(c, symbol)) continue;
        }
        const hit = await liveTry(c);
        if (hit) return { kind: 'pick', gated: hit.gated, source: hit.source };
        if (liveBudgetHit) break;
      }
    }
    return { kind: 'bounded' };
  };

  // The first search uses today's margins; only when it finds nothing legal does the
  // near-miss search (every window widened by NEAR_MISS_MARGIN, the budget top too)
  // run, over what the first did not already judge.
  const specs = openSlotSpecs(s.rules, slots, s.picks, s.trades, pickerId, capFor);
  const wide = openSlotSpecs(s.rules, slots, s.picks, s.trades, pickerId, capFor, NEAR_MISS_MARGINS);
  const passes = JSON.stringify(wide) === JSON.stringify(specs) ? [specs] : [specs, wide];
  let end: WalkEnd = { kind: 'exhausted' };
  for (const pass of passes) {
    end = await walk(pass);
    if (end.kind !== 'exhausted') break;
  }
  if (end.kind === 'pick') {
    return { kind: 'pick', gated: end.gated, source: isBot ? 'bot' : 'auto_best', priceSource: end.source, attempts };
  }
  if (end.kind === 'deadline') {
    console.error('auto-pick: wall-clock budget reached, turn left open', s.leagueId, { attempts, walked, screenRequests });
    return { kind: 'retry_later', attempts, outage: false };
  }
  if (end.kind === 'bounded') {
    // The live-call bound, or the walk bound, stopped the search before the pool
    // ran out: this is NOT a proof that nothing is legal. Retry, never stall.
    console.error('auto-pick: search bound reached, turn left open', s.leagueId, { attempts, walked, outages, screenRequests });
    return { kind: 'retry_later', attempts, outage: false };
  }
  const none = decideNoPick(outages);
  if (none.kind === 'retry_later') return { kind: 'retry_later', attempts, outage: true };
  // 'stalled' means: both searches walked the whole pool, nothing passed the gate,
  // and no candidate was lost to a vendor outage. Every candidate the gate refused
  // at its cached price for a reason a price could change, with a cached price
  // within NEAR_MISS_MARGIN of an open window, was judged at a LIVE price (screen or
  // fill). Residual: a stock whose cached price is more than NEAR_MISS_MARGIN outside
  // every open window but whose live price is inside one is found once its cache
  // refreshes; and a screen capped at SCREEN_MAX_REQUESTS falls back to fill calls,
  // whose bound is retry_later, never a stall.
  return { kind: 'stalled', pickerId, why: 'nothing_legal', attempts };
}

