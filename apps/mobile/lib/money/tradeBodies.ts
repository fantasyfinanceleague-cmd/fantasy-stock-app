/**
 * tradeBodies: the request bodies for record-trade (3e). The server is the
 * authority on every trade: the client sends WHAT to trade, never how much.
 * A sell is the whole position, and a buy's quantity is sized by the server.
 * So none of these bodies carries a quantity, an amount, a price or a user id.
 * tests-deno/money-trade-bodies.test.ts pins the exact keys.
 */
export interface SellBody {
  action: 'sell';
  league_id: string;
  symbol: string;
}

export interface BuyBody {
  action: 'buy';
  league_id: string;
  symbol: string;
  /** Per-slot leagues only: the sale whose cash pays for this buy (the picker's choice). */
  sold_trade_id?: string;
}

export interface PreviewBody {
  action: 'preview';
  league_id: string;
}

export function sellBody(leagueId: string, symbol: string): SellBody {
  return { action: 'sell', league_id: leagueId, symbol: symbol.trim().toUpperCase() };
}

export function buyBody(leagueId: string, symbol: string, soldTradeId?: string | null): BuyBody {
  const body: BuyBody = { action: 'buy', league_id: leagueId, symbol: symbol.trim().toUpperCase() };
  if (soldTradeId) body.sold_trade_id = soldTradeId;
  return body;
}

export function previewBody(leagueId: string): PreviewBody {
  return { action: 'preview', league_id: leagueId };
}
