import { useEffect, useState, useMemo } from 'react';
import { supabase } from './supabase';
import { useAuth } from './useAuth';
import { useStockPrices, StockPrice } from './useStockPrices';

export interface DraftPick {
  id: string;
  symbol: string;
  entry_price: number;
  quantity: number;
  round: number;
  pick_number: number;
  created_at: string;
}

export interface Trade {
  id: string;
  symbol: string;
  action: 'buy' | 'sell';
  quantity: number;
  price: number;
  total_value: number;
  created_at: string;
}

export interface Holding {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  totalCost: number;
  // Live price data
  currentPrice: number | null;
  currentValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
  dayChangePercent: number | null;
}

// Base holding without live prices (internal use)
interface BaseHolding {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  totalCost: number;
}

export function usePortfolio(leagueId: string | null) {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<DraftPick[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [baseHoldings, setBaseHoldings] = useState<BaseHolding[]>([]);
  const [loading, setLoading] = useState(true);

  // Get symbols for price fetching
  const symbols = useMemo(() => baseHoldings.map(h => h.symbol), [baseHoldings]);

  // Fetch live prices for all holdings
  const { prices, loading: pricesLoading, refresh: refreshPrices } = useStockPrices(symbols);

  // Combine holdings with live prices
  const holdings: Holding[] = useMemo(() => {
    return baseHoldings.map(holding => {
      const priceData = prices[holding.symbol.toUpperCase()];

      if (!priceData) {
        return {
          ...holding,
          currentPrice: null,
          currentValue: null,
          gainLoss: null,
          gainLossPercent: null,
          dayChangePercent: null,
        };
      }

      const currentValue = priceData.price * holding.quantity;
      const gainLoss = currentValue - holding.totalCost;
      const gainLossPercent = (gainLoss / holding.totalCost) * 100;

      return {
        ...holding,
        currentPrice: priceData.price,
        currentValue,
        gainLoss,
        gainLossPercent,
        dayChangePercent: priceData.changePercent,
      };
    });
  }, [baseHoldings, prices]);

  // Calculate portfolio totals
  const portfolioSummary = useMemo(() => {
    const totalCost = holdings.reduce((sum, h) => sum + h.totalCost, 0);
    const totalValue = holdings.reduce((sum, h) => sum + (h.currentValue ?? h.totalCost), 0);
    const totalGainLoss = totalValue - totalCost;
    const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
    const hasLivePrices = holdings.some(h => h.currentPrice !== null);

    return {
      totalCost,
      totalValue,
      totalGainLoss,
      totalGainLossPercent,
      hasLivePrices,
      holdingsCount: holdings.length,
    };
  }, [holdings]);

  useEffect(() => {
    if (!user || !leagueId) {
      setDrafts([]);
      setTrades([]);
      setBaseHoldings([]);
      setLoading(false);
      return;
    }

    fetchPortfolio();
  }, [user, leagueId]);

  async function fetchPortfolio() {
    if (!user || !leagueId) return;

    setLoading(true);

    // Fetch draft picks
    const { data: draftData, error: draftError } = await supabase
      .from('drafts')
      .select('*')
      .eq('user_id', user.id)
      .eq('league_id', leagueId)
      .order('created_at', { ascending: true });

    if (draftError) {
      console.error('Error fetching drafts:', draftError);
    }

    // Fetch trades
    const { data: tradeData, error: tradeError } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .eq('league_id', leagueId)
      .order('created_at', { ascending: true });

    if (tradeError) {
      console.error('Error fetching trades:', tradeError);
    }

    const fetchedDrafts = draftData || [];
    const fetchedTrades = tradeData || [];

    setDrafts(fetchedDrafts);
    setTrades(fetchedTrades);

    // Calculate holdings
    const holdingsMap = new Map<string, { quantity: number; totalCost: number }>();

    // Add draft picks
    for (const draft of fetchedDrafts) {
      const existing = holdingsMap.get(draft.symbol) || { quantity: 0, totalCost: 0 };
      existing.quantity += draft.quantity;
      existing.totalCost += draft.entry_price * draft.quantity;
      holdingsMap.set(draft.symbol, existing);
    }

    // Add/subtract trades
    for (const trade of fetchedTrades) {
      const existing = holdingsMap.get(trade.symbol) || { quantity: 0, totalCost: 0 };
      if (trade.action === 'buy') {
        existing.quantity += trade.quantity;
        existing.totalCost += trade.price * trade.quantity;
      } else {
        existing.quantity -= trade.quantity;
        // Keep cost basis proportional
        if (existing.quantity > 0) {
          const avgCost = existing.totalCost / (existing.quantity + trade.quantity);
          existing.totalCost = avgCost * existing.quantity;
        } else {
          existing.totalCost = 0;
        }
      }
      holdingsMap.set(trade.symbol, existing);
    }

    // Convert to array, filter out zero holdings
    const holdingsArray: BaseHolding[] = [];
    holdingsMap.forEach((value, symbol) => {
      if (value.quantity > 0) {
        holdingsArray.push({
          symbol,
          quantity: value.quantity,
          avgEntryPrice: value.totalCost / value.quantity,
          totalCost: value.totalCost,
        });
      }
    });

    setBaseHoldings(holdingsArray);
    setLoading(false);
  }

  async function refresh() {
    await fetchPortfolio();
    await refreshPrices();
  }

  return {
    drafts,
    trades,
    holdings,
    portfolioSummary,
    loading: loading || pricesLoading,
    pricesLoading,
    refresh,
    refreshPrices,
  };
}
