/**
 * portfolioView: every number and line on the Portfolio screen (3e), as pure
 * data. The component renders this and nothing else.
 *
 *  - value is the team value (teamValue, the same formula Home uses): holdings
 *    at live prices, unpriced ones at cost, plus cash.
 *  - "since the draft" is value minus the stake: deliberately NOT Home's "season
 *    gain" (D1, Concept A). The two labels never swap.
 *  - "today" needs EVERY held position to have both a price and a previous
 *    close. One missing quote hides the line; it never shows as $0.
 *  - rows are sorted by value, largest first. A row with no live price shows its
 *    cost and is counted in the caption, never shown as $0.
 */
import { formatMoney, formatPercent } from '../../components/sp/logic/money';
import { cleanCompanyName } from './cleanCompanyName';
import { formatShares } from './formatShares';
import { COPY } from './moneyCopy';
import { unpricedNote } from '../plCoverage';

export interface ViewHolding {
  symbol: string;
  quantity: number;
  costBasis: number;
  price: number | null;
  prevClose: number | null;
  name: string | null;
}

export interface PortfolioViewInput {
  value: number;
  cash: number;
  stake: number;
  holdings: ViewHolding[];
  numRounds: number;
  /** fixed_notional leagues show the slot language; others don't. */
  perSlotNotional: number | null;
  stakeMode: 'fixed_notional' | 'budget_cap' | 'price_tiers' | null;
}

export interface HoldingRow {
  symbol: string;
  name: string;
  quantityText: string;
  valueText: string;
  value: number;
  valueIsCost: boolean;
  todayText: string | null;
  todayTone: 'gain' | 'loss' | 'zero' | null;
}

export interface PortfolioView {
  valueLabel: string;
  valueText: string;
  gainText: string | null;
  gainTone: 'gain' | 'loss' | 'zero' | null;
  sinceDraftLabel: string;
  todayText: string | null;
  todayTone: 'gain' | 'loss' | 'zero' | null;
  slotsText: string | null;
  perSlotText: string | null;
  cashText: string | null;
  unpricedNote: string | null;
  rows: HoldingRow[];
  creditText: string;
}

const cents = (v: number) => Math.round(v * 100) / 100;
const toneOf = (v: number): 'gain' | 'loss' | 'zero' => (Math.abs(v) < 0.005 ? 'zero' : v > 0 ? 'gain' : 'loss');

export function buildPortfolioView(i: PortfolioViewInput): PortfolioView {
  const valueText = formatMoney(i.value);
  const valueLabel = Math.abs(i.cash) >= 0.005 ? COPY.portfolioValueIncludesCash : 'Portfolio value';

  let gainText: string | null = null;
  let gainTone: PortfolioView['gainTone'] = null;
  if (i.stake > 0) {
    const gain = cents(i.value - i.stake);
    const pct = (gain / i.stake) * 100;
    gainText = `${formatMoney(gain, { sign: 'always' })} · ${formatPercent(pct, { sign: 'always' })}`;
    gainTone = toneOf(gain);
  }

  // Today: only when every held position has a price AND a previous close.
  let todayText: string | null = null;
  let todayTone: PortfolioView['todayTone'] = null;
  const held = i.holdings;
  if (held.length > 0 && held.every((h) => h.price != null && h.prevClose != null && h.prevClose > 0)) {
    const change = held.reduce((a, h) => a + h.quantity * (h.price! - h.prevClose!), 0);
    const base = held.reduce((a, h) => a + h.quantity * h.prevClose!, 0);
    const pct = base > 0 ? (change / base) * 100 : 0;
    todayText = `${formatMoney(cents(change), { sign: 'always' })} · ${formatPercent(pct, { sign: 'always' })}`;
    todayTone = toneOf(change);
  }

  const fixed = i.stakeMode === 'fixed_notional';
  const rows: HoldingRow[] = held
    .map((h) => {
      const priced = h.price != null;
      const value = priced ? cents(h.quantity * h.price!) : cents(h.costBasis);
      const rowPct = priced && h.prevClose != null && h.prevClose > 0 ? ((h.price! - h.prevClose) / h.prevClose) * 100 : null;
      return {
        symbol: h.symbol,
        name: cleanCompanyName(h.name) || h.symbol,
        quantityText: formatShares(h.quantity),
        valueText: formatMoney(value),
        value,
        valueIsCost: !priced,
        todayText: rowPct == null ? null : formatPercent(rowPct, { sign: 'always' }),
        todayTone: rowPct == null ? null : toneOf(rowPct),
      };
    })
    .sort((a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol));

  return {
    valueLabel,
    valueText,
    gainText,
    gainTone,
    sinceDraftLabel: COPY.sinceTheDraft,
    todayText,
    todayTone,
    slotsText: fixed ? COPY.slotsInvested(held.length, i.numRounds) : null,
    perSlotText: fixed && i.perSlotNotional != null ? COPY.perSlotAtDraft(formatMoney(i.perSlotNotional)) : null,
    cashText: !fixed && Math.abs(i.cash) >= 0.005 ? `${COPY.cashFromSales} ${formatMoney(i.cash)}` : null,
    unpricedNote: unpricedNote(held.filter((h) => h.price == null).length),
    rows,
    creditText: COPY.alpacaCredit,
  };
}
