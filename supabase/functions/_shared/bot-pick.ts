/**
 * Pure candidate ranking for a bot's draft pick (mobile launch-blocker: mobile
 * has no bot auto-picker at all — see draft-control's header comment). Mirrors
 * the intent of web's DraftPage.jsx botAutoPick (budget-tiered stock pool) but
 * draws from the live `symbols` catalog instead of a hard-coded ticker list,
 * so bots respect this league's actual slot brackets and the draftable-universe
 * gate instead of a fixed pool that predates Phase 4 categories/slots.
 *
 * DELIBERATELY COARSE: this only pre-filters using symbols.last_price (the
 * enrichment cron's cached price), NOT a live quote, and does NOT check
 * category eligibility (that needs a DB read per symbol — see
 * category-eligibility.ts). The caller (validate-and-record-pick) still runs
 * each returned candidate through the real gate — a live fetchFillPrice +
 * validatePick (which re-derives slot fit, including category eligibility,
 * from the authoritative price) — and moves to the next candidate on any
 * refusal. So a stale last_price or a category mismatch costs one wasted
 * Alpaca call, never a wrong pick.
 *
 * No randomization: the league's own leagueOwnedSymbols set already produces
 * pick-to-pick variety (the first bot's pick removes it from every later
 * bot's candidate list), so a deterministic market-cap-desc ordering keeps
 * this module simple to test and its output reproducible.
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

  const filtered = i.candidates.filter((c) => {
    if (!c.isDraftable && !i.rules.allowUndraftable) return false;
    const price = c.lastPrice;
    if (price == null || !(price > 0)) return false;
    if (owned.has(c.symbol.toUpperCase())) return false;
    if (price > budgetRemaining + 1e-9) return false;
    if (!fitsAnyBracket(price)) return false;
    return true;
  });

  return filtered
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0) || a.symbol.localeCompare(b.symbol))
    .map((c) => c.symbol);
}

/** How many ranked candidates the caller should actually try live (fetch a
 * real price + run validatePick) before giving up and recording a SKIP. Kept
 * here so the edge function and its tests agree on one number. */
export const BOT_PICK_MAX_ATTEMPTS = 5;
