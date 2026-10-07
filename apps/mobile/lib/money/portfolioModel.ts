/**
 * portfolioModel: the Portfolio screen's value, cash and holdings (3e), built
 * on 3b-2's teamValue (one formula for Home and Portfolio).
 *
 * A draft pick can never be unused (Giorgio, D3 closed): the server is being
 * made to guarantee it. Until then, a legacy SKIP row is handled defensively:
 * it produces no holding row and no cash. Its slot is removed from the stake
 * (numRounds minus skipped rows), so it does not count as an invested or
 * available $2,000.
 */
import { teamValue, type StakeMode, type TeamValueTradeRow } from '../home/teamValue';
import type { PortfolioLedger } from './portfolioLedger';

export const SKIP_SYMBOL = 'SKIP';

export interface PortfolioDraftRow {
  symbol: string;
  entryPrice: number;
  quantity: number;
}

export interface PortfolioInput {
  stakeMode: StakeMode;
  notionalPerSlot: number | null;
  numRounds: number | null;
  drafts: PortfolioDraftRow[];
  trades: TeamValueTradeRow[];
  price: (symbol: string) => number | null;
}

export interface PortfolioSummary {
  value: number;
  cash: number;
  /** The starting stake the gain is measured from (teamValue's stake). */
  stake: number;
  /** Symbols currently held (net quantity > 0), SKIP excluded. */
  holdingSymbols: string[];
  /** Legacy SKIP rows seen and ignored (0 once the backend guarantee lands). */
  legacySkipRows: number;
}

const isSkip = (symbol: string) => symbol.toUpperCase() === SKIP_SYMBOL;

export function portfolioSummary(input: PortfolioInput): PortfolioSummary {
  const real = input.drafts.filter((d) => !isSkip(d.symbol));
  const legacySkipRows = input.drafts.length - real.length;

  const numRounds = input.numRounds == null ? null : Math.max(0, input.numRounds - legacySkipRows);
  const tv = teamValue({
    stakeMode: input.stakeMode,
    notionalPerSlot: input.notionalPerSlot,
    numRounds,
    drafts: real.map((d) => ({ symbol: d.symbol, entryPrice: d.entryPrice, quantity: d.quantity })),
    trades: input.trades,
    price: input.price,
  });

  const net = new Map<string, number>();
  for (const d of real) net.set(d.symbol.toUpperCase(), (net.get(d.symbol.toUpperCase()) ?? 0) + d.quantity);
  for (const t of input.trades) {
    const sym = t.symbol.toUpperCase();
    net.set(sym, (net.get(sym) ?? 0) + (t.action === 'sell' ? -t.quantity : t.quantity));
  }
  const holdingSymbols = [...net].filter(([, q]) => q > 1e-9).map(([sym]) => sym).sort();

  return { value: tv.value, cash: tv.cash, stake: tv.stake, holdingSymbols, legacySkipRows };
}

export interface PortfolioHolding {
  symbol: string;
  quantity: number;
  /** Average-cost basis of the open quantity (what the position cost). */
  costBasis: number;
}

/**
 * Open holdings with their average-cost basis, from the league's draft picks
 * and trades in chronological order. The same accounting teamValue uses: a sell
 * releases its share of the average cost, and a position that closes at zero is
 * dropped. SKIP rows are never holdings.
 */
export function portfolioHoldings(drafts: PortfolioDraftRow[], trades: TeamValueTradeRow[]): PortfolioHolding[] {
  const book = new Map<string, { quantity: number; totalCost: number }>();
  for (const d of drafts) {
    if (isSkip(d.symbol)) continue;
    const sym = d.symbol.toUpperCase();
    const h = book.get(sym) ?? { quantity: 0, totalCost: 0 };
    h.quantity += d.quantity;
    h.totalCost += d.entryPrice * d.quantity;
    book.set(sym, h);
  }
  for (const t of trades) {
    const sym = t.symbol.toUpperCase();
    const h = book.get(sym) ?? { quantity: 0, totalCost: 0 };
    if (t.action === 'buy') {
      h.quantity += t.quantity;
      h.totalCost += t.price * t.quantity;
    } else {
      const avg = h.quantity > 0 ? h.totalCost / h.quantity : t.price;
      h.quantity -= t.quantity;
      h.totalCost = h.quantity > 0 ? avg * h.quantity : 0;
    }
    book.set(sym, h);
  }
  return [...book]
    .filter(([, h]) => h.quantity > 1e-9)
    .map(([symbol, h]) => ({ symbol, quantity: h.quantity, costBasis: Math.round(h.totalCost * 100) / 100 }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** The caller's own open holdings, straight from the league ledger (the same
 * read Portfolio and the stock sheet both already fetch -- no new request).
 * A row without its price can't enter the cost basis, so it's left out,
 * same as every other reader of this ledger. */
export function myHoldingsFromLedger(ledger: PortfolioLedger, userId: string): PortfolioHolding[] {
  const mine = ledger.activity.filter((a) => a.user_id === userId);
  const drafts: PortfolioDraftRow[] = [];
  const trades: TeamValueTradeRow[] = [];
  for (const a of mine) {
    if (a.price == null) continue;
    if (a.kind === 'draft') drafts.push({ symbol: a.symbol, entryPrice: a.price, quantity: a.quantity });
    else trades.push({ symbol: a.symbol, action: a.action as 'buy' | 'sell', quantity: a.quantity, price: a.price });
  }
  return portfolioHoldings(drafts, trades);
}

export interface StockPosition {
  quantity: number;
  /** Average cost per share of the open quantity. */
  avgEntry: number;
  /** Current market value at the given live price. */
  value: number;
  gain: number;
  gainPct: number;
}

/** key screen 5, "Your position": shares, avg entry, value and gain, from a
 * holding's own cost basis (myHoldingsFromLedger) and the sheet's live price. */
export function stockPosition(holding: PortfolioHolding, price: number): StockPosition {
  const avgEntry = holding.quantity > 0 ? holding.costBasis / holding.quantity : 0;
  const value = Math.round(holding.quantity * price * 100) / 100;
  const gain = Math.round((value - holding.costBasis) * 100) / 100;
  const gainPct = holding.costBasis > 0 ? (gain / holding.costBasis) * 100 : 0;
  return { quantity: holding.quantity, avgEntry, value, gain, gainPct };
}
