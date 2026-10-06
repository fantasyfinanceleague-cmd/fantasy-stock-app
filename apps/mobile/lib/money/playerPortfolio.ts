/**
 * playerPortfolio: another manager's portfolio in a league (3e), read-only. The
 * same accounting as the caller's Portfolio (holdings, team value, gain since
 * the draft), built from the league ledger for that manager. It carries no trade
 * action: nothing here can buy or sell for anyone. Pure.
 */
import { buildPortfolioView, type PortfolioView, type ViewHolding } from './portfolioView';
import { portfolioHoldings, portfolioSummary } from './portfolioModel';
import type { PortfolioLedger } from './portfolioLedger';
import type { StakeMode } from '../home/teamValue';

export interface PlayerPortfolio {
  displayName: string;
  isBot: boolean;
  view: PortfolioView;
}

export function playerPortfolio(i: {
  ledger: PortfolioLedger;
  userId: string;
  stakeMode: StakeMode;
  notionalPerSlot: number | null;
  numRounds: number;
  prices: Record<string, number>;
  prevCloses: Record<string, number>;
}): PlayerPortfolio | null {
  const member = i.ledger.members.find((m) => m.user_id === i.userId);
  if (!member) return null;
  const mine = i.ledger.activity.filter((a) => a.user_id === i.userId);
  const drafts = mine.filter((a) => a.kind === 'draft' && a.price != null)
    .map((a) => ({ symbol: a.symbol, entryPrice: a.price!, quantity: a.quantity }));
  const trades = mine.filter((a) => a.kind === 'trade' && a.price != null)
    .map((a) => ({ symbol: a.symbol, action: a.action as 'buy' | 'sell', quantity: a.quantity, price: a.price! }));
  const price = (sym: string) => i.prices[sym.toUpperCase()] ?? null;

  const summary = portfolioSummary({
    stakeMode: i.stakeMode, notionalPerSlot: i.notionalPerSlot, numRounds: i.numRounds,
    drafts, trades, price,
  });
  const holdings: ViewHolding[] = portfolioHoldings(drafts, trades).map((h) => ({
    symbol: h.symbol,
    quantity: h.quantity,
    costBasis: h.costBasis,
    price: price(h.symbol),
    prevClose: i.prevCloses[h.symbol.toUpperCase()] ?? null,
    name: i.ledger.symbol_names[h.symbol.toUpperCase()] ?? null,
  }));
  const view = buildPortfolioView({
    value: summary.value,
    cash: summary.cash,
    stake: summary.stake,
    holdings,
    numRounds: i.numRounds,
    perSlotNotional: i.notionalPerSlot,
    stakeMode: i.stakeMode,
  });
  return { displayName: member.display_name, isBot: member.is_bot, view };
}
