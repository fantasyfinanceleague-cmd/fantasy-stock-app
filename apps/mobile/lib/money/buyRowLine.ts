/**
 * buyRowLine: the "Buy a stock" row's second line (3e, E-4). Pure: (stake
 * mode, open sales/slots, budget, roster) -> the Design Lead's verbatim line,
 * per sale or per slot, never a total -- one buy spends exactly one sale's
 * cash or fills exactly one slot (2026-10-06 ruling).
 *
 * Every input here already comes from a read the app makes anyway: the
 * preview's sources/slots (fetchPreview, already called once per Portfolio
 * load for the holdings' slot labels) and the ledger (userCashSpentFromLedger
 * + the league's own budget_amount). No new network call.
 */
import { formatMoney } from '../../components/sp/logic/money';
import { COPY } from './moneyCopy';

export interface BuyRowSale {
  symbol: string;
  amount: number;
}

export type BuyRowStakeMode = 'fixed_notional' | 'budget_cap' | 'price_tiers' | null;

export interface BuyRowInput {
  stakeMode: BuyRowStakeMode;
  /** fixed_notional: the preview's open sale proceeds (preview.sources). */
  sales: BuyRowSale[];
  /** budget_cap: budget_amount minus cash spent. Null when either is unreadable. */
  budgetLeft: number | null;
  /** budget_cap: every roster slot filled (held positions >= numRounds) --
   * checked before budgetLeft, since a league can have cash left but no open
   * slot to spend it in. */
  rosterFull: boolean;
  /** price_tiers: each currently-open slot's label (tierContract's
   * slotLabelFor output, e.g. "$100–$200 slot", "Tech slot", "Flex slot").
   * A slot whose category didn't resolve is left out entirely (never shown
   * as "Category") rather than guessed. */
  openSlotLabels: string[];
}

export interface BuyRowLine {
  text: string;
}

const strippedLabel = (label: string) => label.replace(/ slot$/, '');

export function buyRowLine(input: BuyRowInput): BuyRowLine | null {
  if (input.stakeMode === 'fixed_notional') {
    const sales = input.sales;
    if (sales.length === 0) return { text: COPY.everySlotInvested };
    if (sales.length === 1) {
      return { text: COPY.oneSaleReady(formatMoney(sales[0].amount), sales[0].symbol.toUpperCase()) };
    }
    if (sales.length === 2) {
      const [a, b] = sales;
      return { text: COPY.twoSalesReady(formatMoney(a.amount), a.symbol.toUpperCase(), formatMoney(b.amount), b.symbol.toUpperCase()) };
    }
    return { text: COPY.manySalesReady(sales.length) };
  }

  if (input.stakeMode === 'budget_cap') {
    if (input.rosterFull) return { text: COPY.rosterFull };
    if (input.budgetLeft == null) return null;
    return { text: COPY.budgetLeftToSpend(formatMoney(input.budgetLeft)) };
  }

  if (input.stakeMode === 'price_tiers') {
    const labels = input.openSlotLabels;
    if (labels.length === 0) return { text: COPY.everySlotFilled };
    if (labels.length === 1) return { text: COPY.oneSlotOpen(labels[0]) };
    if (labels.length === 2) return { text: COPY.twoSlotsOpen(strippedLabel(labels[0]), strippedLabel(labels[1])) };
    return { text: COPY.manySlotsOpen(labels.length) };
  }

  return null;
}
