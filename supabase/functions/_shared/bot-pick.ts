/**
 * Cheap cached-price candidate filtering for draft auto-picks.
 *
 * HISTORY: this module used to BE the bot picker — rankBotCandidates over a
 * top-150-by-market-cap pool, 5 live attempts. The pick clock
 * (20261010000000) replaced that production path: best available now comes
 * from public.auto_pick_search_candidates (searched per open slot, category-
 * aware) ranked by ./auto-pick.ts MARKET_CAP_STRATEGY, for bots and humans
 * alike. What remains live here is `candidateFilter`, the cheap pre-filter
 * ./auto-pick.ts applies to a manager's queue. `rankBotCandidates` is kept as
 * the thin sort-over-filter its tests exercise (they pin candidateFilter's
 * rules: draftable, unpriced, owned, budget, bracket).
 *
 * DELIBERATELY COARSE: cached symbols.last_price only, no category check.
 * Nothing here decides legality — every candidate still goes through
 * ./pick-gate.ts gatePick (validatePick on the LIVE fill price + category
 * eligibility) before any row is written. A stale last_price costs one wasted
 * Alpaca call, never a wrong pick.
 */
import {
  type LeagueRules,
  leagueOwnedSymbols,
  type PickRow,
  type Slot,
  type TradeRow,
  userCashSpent,
} from './draft-validation.ts';

export interface BotSymbolCandidate {
  symbol: string;
  lastPrice: number | null;
  isDraftable: boolean;
  marketCap: number | null;
}

export interface BotCandidateInputs {
  rules: LeagueRules;
  slots: Slot[];
  picks: PickRow[];
  trades: TradeRow[];
  botId: string;
  /** A pre-fetched pool (e.g. the top ~150 by market cap with a non-null
   * last_price) — this module ranks/filters, it does not fetch. */
  candidates: BotSymbolCandidate[];
}

/**
 * Ordered list of symbols worth trying for this bot's next pick (best first).
 * Empty means "no cached-price candidate looks pickable" — the caller should
 * fall back to SKIP without spending an Alpaca call.
 */
export function rankBotCandidates(i: BotCandidateInputs): string[] {
  return i.candidates
    .filter(candidateFilter(i))
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0) || a.symbol.localeCompare(b.symbol))
    .map((c) => c.symbol);
}

/**
 * The cheap cached-price pre-filter on its own, WITHOUT reordering — so a
 * manager's draft queue (../_shared/auto-pick.ts) can be filtered by exactly
 * the same rules while keeping the manager's order. `unpricedOk` keeps
 * candidates with no cached last_price (a queued symbol the enrichment cron
 * hasn't priced yet is still worth one live attempt; for the market-cap pool
 * it is not, because the pool query already excludes them).
 */
export function candidateFilter(
  i: Omit<BotCandidateInputs, 'candidates'>,
  opts: { unpricedOk?: boolean } = {},
): (c: BotSymbolCandidate) => boolean {
  const owned = leagueOwnedSymbols(i.picks, i.trades);

  const budgetRemaining = i.rules.stakeMode === 'budget_cap'
    ? Math.max((Number(i.rules.budgetAmount) || 0) - userCashSpent(i.botId, i.picks, i.trades), 0)
    : Infinity;

  // Slot-less leagues (no brackets defined) accept any price; otherwise a
  // candidate must fit AT LEAST ONE slot's bracket to be worth trying (the
  // caller's validatePick still does real slot ASSIGNMENT, which additionally
  // accounts for per-slot occupancy and category eligibility).
  const brackets = i.slots.length > 0
    ? i.slots.map((s) => ({ min: s.priceMin, max: s.priceMax }))
    : [{ min: null as number | null, max: null as number | null }];
  const fitsAnyBracket = (price: number) =>
    brackets.some((b) => (b.min == null || price >= b.min) && (b.max == null || price <= b.max));

  return (c) => {
    if (!c.isDraftable && !i.rules.allowUndraftable) return false;
    if (owned.has(c.symbol.toUpperCase())) return false;
    const price = c.lastPrice;
    if (price == null) return opts.unpricedOk === true;
    if (!(price > 0)) return false;
    if (price > budgetRemaining + 1e-9) return false;
    if (!fitsAnyBracket(price)) return false;
    return true;
  };
}
