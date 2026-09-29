/**
 * The draft pick clock's server AUTO-PICK (product rules, Giorgio 2026-09-29):
 * when a manager's clock runs out the server picks for them — first their own
 * draft QUEUE, in order, the first still-legal symbol; then BEST AVAILABLE,
 * like fantasy football: walk the market by size (largest market cap first)
 * and take the first stock that fits the league's rules. Never random. A skip
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
 * budget), its category, the draftable universe, and are not owned or
 * already tried — so a stock outside the top-N by market cap IS found when it
 * is the only fit. Rounds repeat, excluding what was tried, until a candidate
 * passes the live gate, the search returns nothing (=> nothing legal on the
 * catalog's prices), or the documented bound is hit:
 *
 *   QUEUE_MAX_ATTEMPTS = 5   live-priced queue candidates
 *   BEST_MAX_ATTEMPTS  = 15  live-priced best-available candidates
 *
 * so at most 20 Alpaca price calls per auto-pick. auto_skip is recorded only
 * when the search is exhausted, or all 15 best-available candidates were
 * refused by the live gate (the catalog's cached prices disagreed with live
 * ones 15 times) — and never when NO candidate could be priced (a vendor
 * outage keeps a human's turn open; see decideNoPick).
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
export type PickSource = 'manual' | 'bot' | 'skip' | 'auto_queue' | 'auto_best' | 'auto_skip';

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

/**
 * The slots this picker could still fill — one spec per slot with spare
 * capacity (occupancy = the picker's non-SKIP picks' slot_id), de-duplicated.
 * A slot-less league has a single spec bounded only by budget. Empty = no
 * slot can take anything (roster full or budget exhausted) => nothing legal.
 */
export function openSlotSpecs(
  rules: LeagueRules,
  slots: Slot[],
  picks: PickRow[],
  trades: TradeRow[],
  pickerId: string,
): SlotSpec[] {
  const budgetMax = rules.stakeMode === 'budget_cap'
    ? Math.max((Number(rules.budgetAmount) || 0) - userCashSpent(pickerId, picks, trades), 0)
    : null;
  const clamp = (max: number | null) => budgetMax == null ? max : max == null ? budgetMax : Math.min(max, budgetMax);

  const raw: SlotSpec[] = [];
  if (slots.length === 0) {
    raw.push({ min: null, max: clamp(null), categoryId: null });
  } else {
    const occupancy = new Map<string, number>();
    for (const p of picks) {
      if (String(p.user_id) !== pickerId || (p.symbol ?? '').toUpperCase() === SKIP_SYMBOL || !p.slot_id) continue;
      occupancy.set(p.slot_id, (occupancy.get(p.slot_id) ?? 0) + 1);
    }
    for (const s of slots) {
      if ((occupancy.get(s.id) ?? 0) >= s.slotCount) continue;
      raw.push({ min: s.priceMin, max: clamp(s.priceMax), categoryId: s.categoryId });
    }
  }

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
export const BEST_MAX_ATTEMPTS = 15;

// ---------------------------------------------------------------------------
// Queue planning (pure)
// ---------------------------------------------------------------------------

/**
 * The manager's queue, in THEIR order, minus what cannot possibly be legal on
 * the catalog's facts: missing from the catalog, owned in the league, not
 * draftable (unless the league allows it), or (on the cached price) fitting no
 * OPEN slot by price/budget/category. What survives is only worth TRYING —
 * the live gate still decides. Capped at QUEUE_MAX_ATTEMPTS.
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
}): BotSymbolCandidate[] {
  const meta = new Map(i.queueMeta.map((c) => [c.symbol.toUpperCase(), c]));
  const keep = candidateFilter({ rules: i.rules, slots: i.slots, picks: i.picks, trades: i.trades, botId: i.pickerId }, {
    unpricedOk: true,
  });
  const occupied = i.picks
    .filter((p) => String(p.user_id) === i.pickerId && (p.symbol ?? '').toUpperCase() !== SKIP_SYMBOL)
    .map((p) => p.slot_id);
  const fitsOpenSlot = (c: BotSymbolCandidate) =>
    i.slots.length === 0 || c.lastPrice == null ||
    assignSlot(i.slots, occupied, c.lastPrice, i.eligibility.get(c.symbol.toUpperCase()) ?? new Set()) !== null;

  const out: BotSymbolCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of i.queue) {
    if (out.length >= QUEUE_MAX_ATTEMPTS) break;
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
  | { kind: 'skip'; source: 'auto_skip' | 'skip' }
  | { kind: 'retry_later' };

/**
 * After the search found nothing the gate accepted. Bots keep their existing
 * rule (skip even on a vendor outage — mobile fires bot_pick once per turn).
 * Humans are auto-skipped only when the refusal was about LEGALITY: if
 * candidates existed but not one could be priced, the turn stays open for the
 * next attempt (the sweep retries every tick) rather than forfeiting a pick
 * over an Alpaca outage.
 */
export function decideNoPick(isBot: boolean, attempted: number, priced: number): NoPickOutcome {
  if (isBot) return { kind: 'skip', source: 'skip' };
  if (attempted > 0 && priced === 0) return { kind: 'retry_later' };
  return { kind: 'skip', source: 'auto_skip' };
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
}

export type AutoPickChoice =
  | { kind: 'pick'; gated: GatedPick; source: 'auto_queue' | 'auto_best' | 'bot'; priceSource: string | null; attempts: number }
  | { kind: 'skip'; source: 'auto_skip' | 'skip'; pickerId: string; why: 'nothing_legal' | 'attempts_exhausted'; attempts: number }
  | { kind: 'retry_later'; attempts: number }
  | { kind: 'draft_complete' }
  | { kind: 'conflict' };

/**
 * Choose — never write — the auto-pick for whoever's turn it is NOW (never a
 * caller-named target). `expectedPickNumber`: the pick the caller's gate
 * authorized; if the draft has moved on (a manual pick landed between the
 * clock read and this state read) return 'conflict' rather than picking for
 * the NEXT manager, whose clock has not expired.
 *
 * Throws if a port throws (a failed read must not look like "nothing legal",
 * which would skip); the caller maps that to 'unhandled'.
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

  const tried = new Set<string>();
  let attempts = 0;
  let priced = 0;

  // One candidate through the ONE gate. Returns a GatedPick or null.
  const tryCandidate = async (c: BotSymbolCandidate): Promise<{ gated: GatedPick; source: string | null } | null> => {
    const symbol = c.symbol.toUpperCase();
    tried.add(symbol);
    attempts++;
    const live = await ports.livePrice(symbol);
    if (live.price == null) return null;
    priced++;
    await eligibilityFor([symbol]);
    const g = gatePick(s.leagueId, {
      rules: s.rules,
      slots,
      order: s.order,
      picks: s.picks,
      trades: s.trades,
      pickerId,
      symbol,
      price: live.price,
      eligibleCategories: eligibilityCache.get(symbol) ?? new Set<string>(),
      isDraftable: c.isDraftable === true, // the catalog's flag, never "unknown = draftable"
    });
    return g.ok ? { gated: g.pick, source: live.source } : null;
  };

  // 1. The manager's queue, in their order.
  if (!isBot) {
    const q = await ports.loadQueue(pickerId);
    await eligibilityFor(q.meta.map((c) => c.symbol.toUpperCase()));
    const queued = planQueueCandidates({
      rules: s.rules,
      slots,
      picks: s.picks,
      trades: s.trades,
      pickerId,
      queue: q.queue,
      queueMeta: q.meta,
      eligibility: eligibilityCache,
    });
    for (const c of queued) {
      const hit = await tryCandidate(c);
      if (hit) return { kind: 'pick', gated: hit.gated, source: 'auto_queue', priceSource: hit.source, attempts };
    }
  }

  // 2. Best available: search the catalog per open slot, largest first,
  //    excluding owned + tried, round after round.
  const specs = openSlotSpecs(s.rules, slots, s.picks, s.trades, pickerId);
  const owned = [...leagueOwnedSymbols(s.picks, s.trades)];
  const draftableOnly = s.rules.allowUndraftable !== true;
  let bestAttempts = 0;
  let exhausted = specs.length === 0;
  while (!exhausted && bestAttempts < BEST_MAX_ATTEMPTS) {
    const exclude = [...owned, ...tried];
    const results = await Promise.all(
      specs.map((spec) => ports.searchCandidates(spec, exclude, draftableOnly, strategy.searchPerSlot)),
    );
    const bySymbol = new Map<string, BotSymbolCandidate>();
    for (const rows of results) for (const r of rows) bySymbol.set(r.symbol.toUpperCase(), r);
    const fresh = strategy.rank([...bySymbol.values()]).filter((x) => !tried.has(x) && bySymbol.has(x));
    if (fresh.length === 0) {
      exhausted = true;
      break;
    }
    await eligibilityFor(fresh);
    for (const symbol of fresh) {
      if (bestAttempts >= BEST_MAX_ATTEMPTS) break;
      bestAttempts++;
      const hit = await tryCandidate(bySymbol.get(symbol)!);
      if (hit) {
        return { kind: 'pick', gated: hit.gated, source: isBot ? 'bot' : 'auto_best', priceSource: hit.source, attempts };
      }
    }
  }

  const none = decideNoPick(isBot, attempts, priced);
  if (none.kind === 'retry_later') return { kind: 'retry_later', attempts };
  return { kind: 'skip', source: none.source, pickerId, why: exhausted ? 'nothing_legal' : 'attempts_exhausted', attempts };
}
