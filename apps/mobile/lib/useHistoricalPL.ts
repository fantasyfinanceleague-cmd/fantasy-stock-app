import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from './supabase';
import { DraftPick, Trade } from './usePortfolio';

export interface PLDataPoint {
  date: string; // YYYY-MM-DD
  value: number; // portfolio value
  cost: number; // cost basis
  pl: number; // profit/loss
  plPercent: number; // P/L as percentage
}

interface HistoricalBar {
  t: string; // timestamp
  c: number; // close price
}

interface PositionEntry {
  symbol: string;
  quantity: number;
  costBasis: number;
  date: string; // when position was opened/modified
}

export function useHistoricalPL(
  drafts: DraftPick[],
  trades: Trade[],
  enabled: boolean = true
) {
  const [data, setData] = useState<PLDataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get the earliest date we need data from
  const startDate = useMemo(() => {
    let earliest: Date | null = null;

    for (const draft of drafts) {
      const date = new Date(draft.created_at);
      if (!earliest || date < earliest) {
        earliest = date;
      }
    }

    for (const trade of trades) {
      const date = new Date(trade.created_at);
      if (!earliest || date < earliest) {
        earliest = date;
      }
    }

    if (!earliest) return null;

    // Format as YYYY-MM-DD
    return earliest.toISOString().split('T')[0];
  }, [drafts, trades]);

  // Get all unique symbols
  const symbols = useMemo(() => {
    const symbolSet = new Set<string>();
    drafts.forEach(d => symbolSet.add(d.symbol.toUpperCase()));
    trades.forEach(t => symbolSet.add(t.symbol.toUpperCase()));
    return Array.from(symbolSet);
  }, [drafts, trades]);

  const fetchHistoricalData = useCallback(async () => {
    if (!enabled || !startDate || symbols.length === 0) {
      setData([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch historical bars for all symbols
      const { data: barsData, error: barsError } = await supabase.functions.invoke('historical-bars', {
        body: {
          symbols,
          start: startDate,
        },
      });

      if (barsError) throw barsError;

      const bars: Record<string, HistoricalBar[]> = barsData?.bars || {};

      // Build a timeline of all unique dates
      const dateSet = new Set<string>();
      for (const symbol of symbols) {
        const symbolBars = bars[symbol] || [];
        for (const bar of symbolBars) {
          const dateStr = bar.t.split('T')[0];
          dateSet.add(dateStr);
        }
      }

      const sortedDates = Array.from(dateSet).sort();

      if (sortedDates.length === 0) {
        setData([]);
        setLoading(false);
        return;
      }

      // Build price lookup: { date: { symbol: price } }
      const priceLookup: Record<string, Record<string, number>> = {};
      for (const symbol of symbols) {
        const symbolBars = bars[symbol] || [];
        for (const bar of symbolBars) {
          const dateStr = bar.t.split('T')[0];
          if (!priceLookup[dateStr]) {
            priceLookup[dateStr] = {};
          }
          priceLookup[dateStr][symbol] = bar.c;
        }
      }

      // Build position history (what we held on each date)
      // Sort all events by date
      interface PositionEvent {
        date: string;
        symbol: string;
        quantity: number; // positive for buy/draft, negative for sell
        cost: number; // total cost for this transaction
      }

      const events: PositionEvent[] = [];

      for (const draft of drafts) {
        const dateStr = new Date(draft.created_at).toISOString().split('T')[0];
        events.push({
          date: dateStr,
          symbol: draft.symbol.toUpperCase(),
          quantity: draft.quantity,
          cost: draft.entry_price * draft.quantity,
        });
      }

      for (const trade of trades) {
        const dateStr = new Date(trade.created_at).toISOString().split('T')[0];
        const isBuy = trade.action === 'buy';
        events.push({
          date: dateStr,
          symbol: trade.symbol.toUpperCase(),
          quantity: isBuy ? trade.quantity : -trade.quantity,
          cost: isBuy ? trade.price * trade.quantity : 0, // For sells, we'll adjust cost proportionally
        });
      }

      events.sort((a, b) => a.date.localeCompare(b.date));

      // Calculate P/L for each date
      const plData: PLDataPoint[] = [];
      const positions: Record<string, { quantity: number; costBasis: number }> = {};
      let lastPrices: Record<string, number> = {};

      let eventIndex = 0;

      for (const date of sortedDates) {
        // Apply all events up to and including this date
        while (eventIndex < events.length && events[eventIndex].date <= date) {
          const event = events[eventIndex];
          const symbol = event.symbol;

          if (!positions[symbol]) {
            positions[symbol] = { quantity: 0, costBasis: 0 };
          }

          if (event.quantity > 0) {
            // Buy/draft: add to position
            positions[symbol].quantity += event.quantity;
            positions[symbol].costBasis += event.cost;
          } else {
            // Sell: reduce position proportionally
            const sellQty = Math.abs(event.quantity);
            if (positions[symbol].quantity > 0) {
              const avgCost = positions[symbol].costBasis / positions[symbol].quantity;
              positions[symbol].quantity -= sellQty;
              positions[symbol].costBasis = avgCost * positions[symbol].quantity;
            }
          }

          // Clean up zero positions
          if (positions[symbol].quantity <= 0) {
            delete positions[symbol];
          }

          eventIndex++;
        }

        // Update prices for this date (use last known price if not available)
        if (priceLookup[date]) {
          lastPrices = { ...lastPrices, ...priceLookup[date] };
        }

        // Calculate portfolio value and cost
        let totalValue = 0;
        let totalCost = 0;

        for (const [symbol, pos] of Object.entries(positions)) {
          const price = lastPrices[symbol];
          if (price && pos.quantity > 0) {
            totalValue += price * pos.quantity;
            totalCost += pos.costBasis;
          }
        }

        // Only add data point if we have positions
        if (totalCost > 0) {
          const pl = totalValue - totalCost;
          const plPercent = (pl / totalCost) * 100;

          plData.push({
            date,
            value: totalValue,
            cost: totalCost,
            pl,
            plPercent,
          });
        }
      }

      setData(plData);
    } catch (err: any) {
      console.error('Error fetching historical P/L:', err);
      setError(err.message || 'Failed to load historical data');
    } finally {
      setLoading(false);
    }
  }, [enabled, startDate, symbols.join(','), drafts.length, trades.length]);

  useEffect(() => {
    fetchHistoricalData();
  }, [fetchHistoricalData]);

  return {
    data,
    loading,
    error,
    refresh: fetchHistoricalData,
  };
}
