import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabase';

export interface StockPrice {
  symbol: string;
  price: number;
  prevClose: number | null;
  todayOpen: number | null;
  changePercent: number | null;
  cached?: boolean;
  fetchedAt: number;
}

interface PriceCache {
  [symbol: string]: StockPrice;
}

// Client-side cache (shared across hook instances)
const priceCache: PriceCache = {};
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// Rate limiting
const REQUEST_DELAY_MS = 100; // 100ms between requests
const MAX_CONCURRENT = 3;

function isCacheValid(price: StockPrice): boolean {
  return Date.now() - price.fetchedAt < CACHE_TTL_MS;
}

async function fetchSingleQuote(symbol: string): Promise<StockPrice | null> {
  try {
    const { data, error } = await supabase.functions.invoke('ticker-quotes', {
      body: { symbol: symbol.toUpperCase() },
    });

    if (error) {
      console.error(`Error fetching quote for ${symbol}:`, error);
      return null;
    }

    if (data?.error) {
      console.error(`API error for ${symbol}:`, data.error);
      return null;
    }

    const stockPrice: StockPrice = {
      symbol: data.symbol,
      price: data.price,
      prevClose: data.prevClose ?? null,
      todayOpen: data.todayOpen ?? null,
      changePercent: data.changePercent ?? null,
      cached: data.cached,
      fetchedAt: Date.now(),
    };

    // Update cache
    priceCache[symbol.toUpperCase()] = stockPrice;

    return stockPrice;
  } catch (err) {
    console.error(`Failed to fetch quote for ${symbol}:`, err);
    return null;
  }
}

async function fetchQuotesWithRateLimit(symbols: string[]): Promise<PriceCache> {
  const results: PriceCache = {};
  const symbolsToFetch: string[] = [];

  // Check cache first
  for (const symbol of symbols) {
    const upperSymbol = symbol.toUpperCase();
    const cached = priceCache[upperSymbol];
    if (cached && isCacheValid(cached)) {
      results[upperSymbol] = cached;
    } else {
      symbolsToFetch.push(upperSymbol);
    }
  }

  if (symbolsToFetch.length === 0) {
    return results;
  }

  // Fetch in batches with rate limiting
  const fetchPromises: Promise<void>[] = [];
  let activeCount = 0;

  for (let i = 0; i < symbolsToFetch.length; i++) {
    const symbol = symbolsToFetch[i];

    // Wait if we've hit max concurrent requests
    while (activeCount >= MAX_CONCURRENT) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    activeCount++;

    const fetchPromise = (async () => {
      // Add delay between requests
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
      }

      const quote = await fetchSingleQuote(symbol);
      if (quote) {
        results[symbol] = quote;
      }
      activeCount--;
    })();

    fetchPromises.push(fetchPromise);
  }

  await Promise.all(fetchPromises);

  return results;
}

export function useStockPrices(symbols: string[]) {
  const [prices, setPrices] = useState<PriceCache>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchPrices = useCallback(async (forceRefresh = false) => {
    if (symbols.length === 0) {
      setPrices({});
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // If force refresh, clear cache for these symbols
      if (forceRefresh) {
        for (const symbol of symbols) {
          delete priceCache[symbol.toUpperCase()];
        }
      }

      const fetchedPrices = await fetchQuotesWithRateLimit(symbols);

      if (isMountedRef.current) {
        setPrices(fetchedPrices);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError('Failed to fetch stock prices');
        console.error('useStockPrices error:', err);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [symbols.join(',')]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchPrices();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchPrices]);

  const refresh = useCallback(() => fetchPrices(true), [fetchPrices]);

  // Helper to get price for a specific symbol
  const getPrice = useCallback((symbol: string): StockPrice | null => {
    return prices[symbol.toUpperCase()] || null;
  }, [prices]);

  return {
    prices,
    loading,
    error,
    refresh,
    getPrice,
  };
}

// Utility function to clear entire cache (useful for sign out)
export function clearPriceCache() {
  Object.keys(priceCache).forEach(key => delete priceCache[key]);
}
