import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from './supabase';
import { DraftPick, Trade } from './usePortfolio';
import { buildPLSeries, PLDataPoint, PositionEvent } from './plCoverage';

export type { PLDataPoint };

interface HistoricalBar {
  t: string; // timestamp
  c: number; // close price
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
          proceeds: isBuy ? undefined : trade.price * trade.quantity,
        });
      }

      // Holdings without a bar are counted at cost (and counted per point),
      // not dropped from value and basis — see lib/plCoverage.ts.
      const plData = buildPLSeries(events, priceLookup);

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
