/**
 * teamValue: the Home hero's big number (D1, Concept A — "the big number
 * is team value"). Portfolio (3e) reuses this same helper (Orchestrator
 * ruling, 2026-09-29) rather than a second, independently-derived formula.
 *
 * value = current holdings, priced live (unpriced counts at cost, never
 *         $0 — plCoverage's existing convention) + cash
 * cash   = (stake - draftCost) + all sell proceeds since the draft -
 *          all buy cost since the draft
 *
 * STAKE, per mode (Orchestrator ruling):
 *   fixed_notional            notionalPerSlot * numRounds — a SKIPPED slot
 *                             is never drafted, so it never reduces
 *                             draftCost, and shows up as pure cash.
 *   price_tiers | budget_cap  the drafted roster's cost basis (Σ draft
 *                             price * qty), NOT budgetAmount — a cap is a
 *                             spending LIMIT, not an investment. Both
 *                             modes fill exactly one share per pick
 *                             (fillQuantity, _shared/draft-validation.ts),
 *                             so qty is always 1 there.
 *   null (legacy)             treated like price_tiers/budget_cap
 *                             (one-share, draft-cost stake) — flagged in
 *                             the worker's DONE report as ambiguous.
 *
 * WHY CASH CAN GO NEGATIVE, AND WHY THAT'S NOT CLAMPED (Orchestrator
 * ruling: "if cash can go negative or the identity breaks in a mode, flag
 * it in the report rather than smoothing it"):
 *   - price_tiers has NO spending constraint at all (no over_budget check
 *     in draft-validation.ts): a user can buy without ever selling, so
 *     cash is unbounded below.
 *   - budget_cap's own limit (userCashSpent <= budgetAmount,
 *     _shared/draft-validation.ts:251-267,553-558) is checked against
 *     budgetAmount, NOT against this helper's draft-cost stake. Whenever
 *     budgetAmount > draftCost, the server legally lets the team spend
 *     that extra headroom on further buys with no matching sell — which
 *     this helper (deliberately using draft-cost as stake, per the
 *     ruling above) then shows as negative cash. That is a real, honest
 *     signal — the team spent capital this helper doesn't count as part
 *     of their stake — not a bug to hide.
 *   - fixed_notional's proceeds-reinvest rule (record-trade; see
 *     20261006000000_trades_funded_by_trade_id.sql) should keep cash >= 0
 *     always; a negative value there would itself be worth flagging.
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
  const stake =
    input.stakeMode === 'fixed_notional'
      ? (input.notionalPerSlot ?? 0) * (input.numRounds ?? 0)
      : draftCost;

  let cash = stake - draftCost;
  for (const t of input.trades) {
    const notional = t.price * t.quantity;
    cash += t.action === 'sell' ? notional : -notional;
  }
  cash = cents(cash);

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
