/**
 * Pure decisions for the draft pick clock's server AUTO-PICK (product rules,
 * Giorgio 2026-09-29): when a manager's clock runs out the server picks for
 * them — first their own draft QUEUE, in order, the first still-legal symbol;
 * then the server's BEST AVAILABLE. Never random. A skip only when nothing at
 * all is legal.
 *
 * Same hermetic pattern as draft-validation.ts / bot-pick.ts: no DB, no fetch,
 * no Deno APIs. The I/O half (loading state, live prices, the insert) is
 * ./draft-write.ts `autoPickTurn`, shared by validate-and-record-pick
 * (action:'auto_pick' from clients, action:'bot_pick') and draft-autopick-sweep
 * (the cron backstop).
 *
 * THE DEADLINE IS NOT COMPUTED HERE. It has exactly one definition —
 * public.get_draft_clock (20261010000000) — which clients, the edge gate and
 * the cron's overdue filter all read, on the DATABASE clock. This module only
 * interprets that function's row (decideAutoPickGate), so the TS and SQL
 * sides can never disagree about when a turn expires.
 *
 * RANKING IS PLUGGABLE. BestAvailableStrategy separates "which pool, in what
 * order" from the timer: swapping market-cap-desc for, say, a composite with
 * recent performance is a new strategy object, with no change to the gate,
 * the queue handling, or the write path.
 */
import { type BotSymbolCandidate, candidateFilter, rankBotCandidates } from './bot-pick.ts';
import {
  assignSlot,
  type LeagueRules,
  type PickRow,
  SKIP_SYMBOL,
  type Slot,
  type TradeRow,
  userCashSpent,
} from './draft-validation.ts';

/** drafts.pick_source (CHECK in 20261010000000). UI: "Auto-picked" = auto_*. */
export type PickSource = 'manual' | 'bot' | 'skip' | 'auto_queue' | 'auto_best' | 'auto_skip';

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
 *
 * Order matters:
 *  1. already_recorded FIRST, regardless of status — a late client firing for
 *     the draft's final pick (which finalized the league) must hear "done",
 *     not "draft not in progress". Idempotent, and costs no Alpaca call.
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
// Best-available strategy (pluggable)
// ---------------------------------------------------------------------------

export interface PriceBracket {
  min: number | null;
  max: number | null;
}

export interface BestAvailableStrategy {
  /** Stable id, logged with each auto-pick so a changed basis is visible. */
  id: string;
  /** symbols column the pool query orders by (desc) before ranking. */
  poolOrderColumn: 'market_cap';
  /** How many symbols to fetch per open price bracket. */
  poolPerBracket: number;
  /** Order a pre-fetched pool best-first (it may also filter). */
  rank(inputs: {
    rules: LeagueRules;
    slots: Slot[];
    picks: PickRow[];
    trades: TradeRow[];
    pickerId: string;
    candidates: BotSymbolCandidate[];
  }): string[];
}

/** Default: largest market cap first among legal-looking symbols — the same
 * basis bots already use (rankBotCandidates), pending Giorgio's confirmation
 * that it is the "good stock" rule he wants. */
export const MARKET_CAP_STRATEGY: BestAvailableStrategy = {
  id: 'market_cap_desc',
  poolOrderColumn: 'market_cap',
  poolPerBracket: 25,
  rank: (i) => rankBotCandidates({ ...i, botId: i.pickerId }),
};

export const BEST_AVAILABLE_STRATEGY: BestAvailableStrategy = MARKET_CAP_STRATEGY;

/**
 * The price brackets this picker could still fill: one per slot with spare
 * capacity (occupancy = the picker's non-SKIP picks' slot_id), de-duplicated,
 * with the upper bound clamped to the remaining budget in budget_cap mode. A
 * slot-less league has a single bracket bounded only by budget.
 *
 * WHY: the old bot pool was "top 150 by market cap" — in a league with a
 * narrow low-price bracket that pool can contain NO legal stock while legal
 * stocks exist, and the pick silently becomes a skip. Querying the pool PER
 * OPEN BRACKET makes "skip only when nothing is legal" true rather than
 * approximately true. An empty result means no slot can take anything.
 */
export function openBrackets(
  rules: LeagueRules,
  slots: Slot[],
  picks: PickRow[],
  trades: TradeRow[],
  pickerId: string,
): PriceBracket[] {
  const budgetMax = rules.stakeMode === 'budget_cap'
    ? Math.max((Number(rules.budgetAmount) || 0) - userCashSpent(pickerId, picks, trades), 0)
    : null;
  const clamp = (max: number | null) => budgetMax == null ? max : max == null ? budgetMax : Math.min(max, budgetMax);

  const raw: PriceBracket[] = [];
  if (slots.length === 0) {
    raw.push({ min: null, max: clamp(null) });
  } else {
    const occupancy = new Map<string, number>();
    for (const p of picks) {
      if (String(p.user_id) !== pickerId || (p.symbol ?? '').toUpperCase() === SKIP_SYMBOL || !p.slot_id) continue;
      occupancy.set(p.slot_id, (occupancy.get(p.slot_id) ?? 0) + 1);
    }
    for (const s of slots) {
      if ((occupancy.get(s.id) ?? 0) >= s.slotCount) continue;
      raw.push({ min: s.priceMin, max: clamp(s.priceMax) });
    }
  }

  const seen = new Set<string>();
  return raw.filter((b) => {
    if (b.max != null && !(b.max > 0)) return false; // budget exhausted
    if (b.min != null && b.max != null && b.min > b.max) return false;
    const key = `${b.min}:${b.max}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Candidate planning
// ---------------------------------------------------------------------------

/** Live attempts (fetchFillPrice + validatePick) per source. The bot cap
 * stays BOT_PICK_MAX_ATTEMPTS (5) via BEST_MAX_ATTEMPTS. */
export const QUEUE_MAX_ATTEMPTS = 5;
export const BEST_MAX_ATTEMPTS = 5;

export interface AutoPickCandidate {
  symbol: string;
  source: 'auto_queue' | 'auto_best' | 'bot';
}

export interface PlanInputs {
  isBot: boolean;
  rules: LeagueRules;
  slots: Slot[];
  picks: PickRow[];
  trades: TradeRow[];
  pickerId: string;
  /** The manager's queue, position order (ignored for bots — bots never queue). */
  queue: string[];
  /** Cached symbols rows for the queued symbols (a missing row = unknown, dropped). */
  queueMeta: BotSymbolCandidate[];
  /** The best-available pool (openBrackets-bounded query). */
  pool: BotSymbolCandidate[];
  strategy: BestAvailableStrategy;
  /** symbol -> effective category ids, when the league has category slots.
   * When present, candidates must fit an OPEN slot by price AND category. */
  eligibility?: Map<string, Set<string>>;
}

/**
 * The ordered list of symbols to try live, best first:
 *   human: queue (manager's order, cheap-filtered, ≤ QUEUE_MAX_ATTEMPTS), then
 *          best available (strategy order, minus anything already listed,
 *          ≤ BEST_MAX_ATTEMPTS);
 *   bot:   best available only (source 'bot').
 * The cheap filter uses the enrichment cron's cached last_price; every
 * candidate still goes through the live fetchFillPrice + validatePick gate a
 * manual pick uses, so a stale cached price costs one attempt, never a wrong
 * pick. An empty list means nothing even looks legal.
 */
export function planAutoPickCandidates(i: PlanInputs): AutoPickCandidate[] {
  const base = { rules: i.rules, slots: i.slots, picks: i.picks, trades: i.trades, botId: i.pickerId };
  const slotFit = openSlotFit(i);
  const out: AutoPickCandidate[] = [];
  const listed = new Set<string>();

  if (!i.isBot) {
    const meta = new Map(i.queueMeta.map((c) => [c.symbol.toUpperCase(), c]));
    const keep = candidateFilter(base, { unpricedOk: true });
    for (const raw of i.queue) {
      if (out.length >= QUEUE_MAX_ATTEMPTS) break;
      const sym = raw.toUpperCase();
      const c = meta.get(sym);
      if (!c || listed.has(sym) || !keep(c) || !slotFit(c)) continue;
      listed.add(sym);
      out.push({ symbol: sym, source: 'auto_queue' });
    }
  }

  const ranked = i.strategy.rank({
    rules: i.rules,
    slots: i.slots,
    picks: i.picks,
    trades: i.trades,
    pickerId: i.pickerId,
    candidates: i.pool,
  });
  const poolBySymbol = new Map(i.pool.map((c) => [c.symbol.toUpperCase(), c]));
  let best = 0;
  for (const raw of ranked) {
    if (best >= BEST_MAX_ATTEMPTS) break;
    const sym = raw.toUpperCase();
    const c = poolBySymbol.get(sym);
    if (!c || listed.has(sym) || !slotFit(c)) continue;
    listed.add(sym);
    out.push({ symbol: sym, source: i.isBot ? 'bot' : 'auto_best' });
    best++;
  }
  return out;
}

/** Occupancy- and category-aware slot fit on the cached price, used only when
 * the caller supplied eligibility (category leagues). Without it, the
 * any-bracket check inside candidateFilter is the (coarser) pre-filter. An
 * unpriced candidate passes — the live gate decides. */
function openSlotFit(i: PlanInputs): (c: BotSymbolCandidate) => boolean {
  if (!i.eligibility || i.slots.length === 0) return () => true;
  const occupied = i.picks
    .filter((p) => String(p.user_id) === i.pickerId && (p.symbol ?? '').toUpperCase() !== SKIP_SYMBOL)
    .map((p) => p.slot_id);
  const elig = i.eligibility;
  return (c) => {
    if (c.lastPrice == null) return true;
    return assignSlot(i.slots, occupied, c.lastPrice, elig.get(c.symbol.toUpperCase()) ?? new Set()) !== null;
  };
}

// ---------------------------------------------------------------------------
// Outcome when no candidate was recorded
// ---------------------------------------------------------------------------

export type NoPickOutcome =
  /** Something was priced and every priced candidate was illegal (or nothing
   * looked legal at all): record the skip so the draft advances. */
  | { kind: 'skip'; source: 'auto_skip' | 'skip' }
  /** Candidates existed but NONE could be priced (vendor outage): do not
   * forfeit a human's turn over an Alpaca outage — leave the turn open for
   * the next attempt (the sweep retries every tick). */
  | { kind: 'retry_later' };

/**
 * After the live loop found nothing legal. Bots keep their existing rule
 * (skip even on a vendor outage — mobile fires bot_pick once per turn and
 * would otherwise stall until someone reopens the screen). Humans only
 * auto_skip when the refusal was about LEGALITY, never about pricing.
 */
export function decideNoPick(isBot: boolean, planned: number, priced: number): NoPickOutcome {
  if (isBot) return { kind: 'skip', source: 'skip' };
  if (planned > 0 && priced === 0) return { kind: 'retry_later' };
  return { kind: 'skip', source: 'auto_skip' };
}

/** PostgREST `in` list for excluding owned symbols from the pool query.
 * Symbols are quoted so dotted class shares (BRK.B) survive. */
export function postgrestInList(symbols: Iterable<string>): string {
  const safe = [...symbols].map((s) => s.toUpperCase()).filter((s) => /^[A-Z0-9.\-]+$/.test(s));
  return `(${safe.map((s) => `"${s}"`).join(',')})`;
}
