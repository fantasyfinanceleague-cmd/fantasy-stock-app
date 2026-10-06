/**
 * budgetFigures: the budget a budget or tier league's review shows (3e, D4 A).
 * A sale's cash goes back into the budget (userCashSpent); a buy takes one
 * share's price out. Cash spent comes from the caller's ledger rows, through the
 * same formula as the server (cashSpent). Pure.
 */
import { cashSpent } from './cashSpent';
import type { PortfolioLedger } from './portfolioLedger';

const cents = (v: number) => Math.round(v * 100) / 100;

/** The caller's cash spent in the league: draft costs plus buys, minus sale proceeds. */
export function userCashSpentFromLedger(ledger: PortfolioLedger, userId: string): number {
  const drafts = ledger.activity
    .filter((a) => a.kind === 'draft' && a.price != null)
    .map((a) => ({ user_id: a.user_id, entry_price: a.price!, quantity: a.quantity }));
  const trades = ledger.activity
    .filter((a) => a.kind === 'trade' && a.price != null)
    .map((a) => ({ user_id: a.user_id, action: a.action, price: a.price!, quantity: a.quantity }));
  return cents(cashSpent(userId, drafts, trades));
}

/** The budget left after a one-share sale: the sale's cash goes back in. */
export function budgetAfterSell(before: number, quantity: number, price: number): number {
  return cents(before + quantity * price);
}

/** The budget left after a one-share buy. */
export function budgetAfterBuy(before: number, price: number): number {
  return cents(before - price);
}
