/**
 * useStockChartData: the stock sheet's chart history (3e, M2). One
 * historical-bars read per symbol per sheet-open, wide enough for the
 * longest range (1Y) -- the shorter ranges are a client-side slice
 * (stockChartSeries.barsForRange), never a separate request per tab.
 * DEV fixture: stressFixture.stressChartBars, no network.
 */
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

import type { DailyBar } from './stockChartSeries';
import { MONEY_FIXTURE_CONFIG } from './devFixture';
import { stressChartBars } from './stressFixture';

export interface StockChartData {
  status: 'loading' | 'ready' | 'error';
  bars: DailyBar[];
}

const LOOKBACK_DAYS = 400; // covers 1Y (366) with a buffer for the window's own edge.

export function useStockChartData(symbol: string, enabled: boolean): StockChartData {
  const [state, setState] = useState<StockChartData>({ status: 'loading', bars: [] });

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'loading', bars: [] });
      return;
    }
    if (MONEY_FIXTURE_CONFIG) {
      setState({ status: 'ready', bars: stressChartBars(symbol) });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading', bars: [] });
    (async () => {
      const start = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase.functions.invoke('historical-bars', { body: { symbols: [symbol], start } });
      if (cancelled) return;
      if (error) {
        console.warn('[stock-chart] historical-bars failed', error.message);
        setState({ status: 'error', bars: [] });
        return;
      }
      const raw = (data?.bars?.[symbol] ?? data?.bars?.[symbol.toUpperCase()] ?? []) as { t: string; c: number }[];
      const bars: DailyBar[] = raw
        .map((b) => ({ date: b.t.slice(0, 10), close: b.c }))
        .filter((b) => typeof b.close === 'number' && Number.isFinite(b.close) && b.close > 0);
      setState({ status: 'ready', bars });
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, enabled]);

  return state;
}
