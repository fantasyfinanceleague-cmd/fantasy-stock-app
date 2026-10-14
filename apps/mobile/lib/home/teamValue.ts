/**
 * teamValue: the Home hero's big number (D1, Concept A — "the big number
 * is team value"). Portfolio (3e) reuses this same helper (Orchestrator
 * ruling, 2026-09-29) rather than a second, independently-derived formula.
 *
 * value = current holdings, priced live (unpriced counts at cost, never
 *         $0 — plCoverage's existing convention) + cash
 *
 * STAKE AND CASH, per mode:
 *   fixed_notional            stake = notionalPerSlot * numRounds; cash =
 *                             (stake - draftCost) + sells - buys. A SKIPPED
 *                             slot is never drafted, so it shows as cash; the
 *                             proceeds-reinvest rule (record-trade) keeps it
 *                             >= 0.
 *   price_tiers | budget_cap  (and null, legacy) one share per pick, so the
 *                             starting stake is the drafted roster's cost
 *                             basis (Σ draft price * qty), NOT budgetAmount —
 *                             a cap is a spending LIMIT, not an investment.
 *                             After the draft, net = sells - buys:
 *                               net >= 0 → it is "Cash from sales": cash = net,
 *                                          stake = draftCost;
 *                               net <  0 → the buys spent money no sale paid
 *                                          for (a budget cap's headroom, or a
 *                                          tier league with no budget at all).
 *                                          That is MORE CAPITAL PUT IN, never
 *                                          negative cash: cash = 0, stake =
 *                                          draftCost + (buys - sells).
 *
 * WHY (W4 Portfolio, defect (b) of the auto-pick review): the old formula
 * kept stake = draftCost and let cash go negative, so any post-draft net buy
 * inside the budget read "Cash from sales −$X" on Portfolio and pulled the
 * team value down by money the manager had legally invested. The gain is
 * the same either way (value − stake = holdings − every dollar put in);
 * only the split between "cash" and "stake" changes, so "since the draft"
 * never moves. Cash can no longer go negative in any mode, so
 * `cashWentNegative` now only ever flags a fixed_notional ledger that broke
 * its own reinvest rule.
 */

export type StakeMode = 'fixed_notional' | 'price_tiers' | 'budget_cap' | null;

export interface TeamValueDraftRow {
  symbol: string;
  entryPrice: number;
  /** Caller excludes SKIP sentinel rows before calling (they're 0-cost
   * anyway, but keeping the filter at the call site matches every other
   * ledger reader in this codebase — see CLAUDE.md / user-score.ts). */
  quantity: number;
}

export interface TeamValueTradeRow {
  symbol: string;
  action: 'buy' | 'sell';
  quantity: number;
  price: number;
}

export interface TeamValueInput {
  stakeMode: StakeMode;
  notionalPerSlot: number | null;
  numRounds: number | null;
  drafts: TeamValueDraftRow[];
  /** ALL of the caller's trades since the draft — not scoped to one week. */
  trades: TeamValueTradeRow[];
  price: (symbol: string) => number | null;
}

export interface TeamValueResult {
  value: number;
  cash: number;
  stake: number;
  unpriced: string[];
  cashWentNegative: boolean;
}

function cents(v: number): number {
  return Math.round(v * 100) / 100;
}

export function teamValue(input: TeamValueInput): TeamValueResult {
  const draftCost = input.drafts.reduce((sum, d) => sum + d.entryPrice * d.quantity, 0);
  let net = 0; // sells − buys since the draft
  for (const t of input.trades) {
    const notional = t.price * t.quantity;
    net += t.action === 'sell' ? notional : -notional;
  }

  let stake: number;
  let cash: number;
  if (input.stakeMode === 'fixed_notional') {
    stake = (input.notionalPerSlot ?? 0) * (input.numRounds ?? 0);
    cash = cents(stake - draftCost + net);
  } else {
    // A net buy is capital put in, not negative cash (see the header).
    cash = cents(Math.max(0, net));
    stake = draftCost + Math.max(0, -net);
  }

  // Current net holdings, average-cost basis — the same accounting the
  // rest of the app uses for "an unpriced holding counts at cost, not $0"
  // (lib/plCoverage.ts, and the pre-3b-1 useHomeData.ts's computeHoldings).
  const holdings = new Map<string, { quantity: number; totalCost: number }>();
  for (const d of input.drafts) {
    const h = holdings.get(d.symbol) ?? { quantity: 0, totalCost: 0 };
    h.quantity += d.quantity;
    h.totalCost += d.entryPrice * d.quantity;
    holdings.set(d.symbol, h);
  }
  for (const t of input.trades) {
    const h = holdings.get(t.symbol) ?? { quantity: 0, totalCost: 0 };
    if (t.action === 'buy') {
      h.quantity += t.quantity;
      h.totalCost += t.price * t.quantity;
    } else {
      const avgCost = h.quantity > 0 ? h.totalCost / h.quantity : t.price;
      h.quantity -= t.quantity;
      h.totalCost = h.quantity > 0 ? avgCost * h.quantity : 0;
    }
    holdings.set(t.symbol, h);
  }

  let holdingsValue = 0;
  const unpriced: string[] = [];
  for (const [symbol, h] of holdings) {
    if (h.quantity <= 0) continue;
    const live = input.price(symbol);
    if (live == null) {
      unpriced.push(symbol);
      holdingsValue += h.totalCost; // cost-basis fallback, never $0
      continue;
    }
    holdingsValue += h.quantity * live;
  }

  return {
    value: cents(holdingsValue + cash),
    cash,
    stake: cents(stake),
    unpriced,
    cashWentNegative: cash < -0.01,
  };
}
