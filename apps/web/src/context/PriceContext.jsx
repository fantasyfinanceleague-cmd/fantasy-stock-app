// src/context/PriceContext.jsx
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabase/supabaseClient';

// Cache TTL in milliseconds (2 minutes)
const CACHE_TTL = 2 * 60 * 1000;

// Max concurrent requests to avoid rate limiting
const MAX_CONCURRENT = 3;
const REQUEST_DELAY = 60;

// Status constants
export const PRICE_STATUS = {
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
  RATE_LIMITED: 'rate_limited',
};

const PriceContext = createContext(null);

export function PriceProvider({ children }) {
  // prices: { SYMBOL: { price: number | null, timestamp: number, status: 'loading' | 'success' | 'error' } }
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Track in-flight requests to avoid duplicates
  const inFlightRef = useRef(new Set());

  // Check if a cached price is still valid (must be successful and not expired)
  const isCacheValid = useCallback((symbol) => {
    const cached = prices[symbol];
    if (!cached) return false;
    if (cached.status !== PRICE_STATUS.SUCCESS) return false;
    return Date.now() - cached.timestamp < CACHE_TTL;
  }, [prices]);

  // Get cached price for a symbol (returns null if expired, missing, or error)
  const getCachedPrice = useCallback((symbol) => {
    const sym = String(symbol || '').toUpperCase();
    if (!sym) return null;
    const cached = prices[sym];
    if (!cached || cached.status !== PRICE_STATUS.SUCCESS || Date.now() - cached.timestamp >= CACHE_TTL) {
      return null;
    }
    return cached.price;
  }, [prices]);

  // Get status for a symbol
  const getStatus = useCallback((symbol) => {
    const sym = String(symbol || '').toUpperCase();
    if (!sym) return null;
    return prices[sym]?.status || null;
  }, [prices]);

  // Get all cached prices as a simple { SYMBOL: price } map (only successful fetches)
  const getPriceMap = useCallback(() => {
    const now = Date.now();
    const result = {};
    for (const [sym, data] of Object.entries(prices)) {
      if (data.status === PRICE_STATUS.SUCCESS && now - data.timestamp < CACHE_TTL) {
        result[sym] = data.price;
      }
    }
    return result;
  }, [prices]);

  // Get all statuses as { SYMBOL: status } map
  const getStatusMap = useCallback(() => {
    const result = {};
    for (const [sym, data] of Object.entries(prices)) {
      result[sym] = data.status;
    }
    return result;
  }, [prices]);

  // Get symbols that failed to fetch
  const getFailedSymbols = useCallback(() => {
    return Object.entries(prices)
      .filter(([_, data]) => data.status === PRICE_STATUS.ERROR)
      .map(([sym]) => sym);
  }, [prices]);

  // Get symbols that were rate limited
  const getRateLimitedSymbols = useCallback(() => {
    return Object.entries(prices)
      .filter(([_, data]) => data.status === PRICE_STATUS.RATE_LIMITED)
      .map(([sym]) => sym);
  }, [prices]);

  // Fetch a single quote from the edge function
  // Returns { price, status } object
  const fetchSingleQuote = async (symbol) => {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return { price: null, status: PRICE_STATUS.ERROR };

    try {
      const { data, error } = await supabase.functions.invoke('quote', { body: { symbol: sym } });

      // Check for rate limiting
      if (error?.message?.includes('429') || data?.error === 'rate_limit') {
        return { price: null, status: PRICE_STATUS.RATE_LIMITED };
      }

      if (error) return { price: null, status: PRICE_STATUS.ERROR };

      const price = Number(
        data?.price ??
        data?.quote?.ap ??
        data?.quote?.bp ??
        data?.trade?.p ??
        data?.bar?.c
      );

      return Number.isFinite(price)
        ? { price, status: PRICE_STATUS.SUCCESS }
        : { price: null, status: PRICE_STATUS.ERROR };
    } catch (err) {
      // Check for rate limiting in error
      if (err?.message?.includes('429') || err?.status === 429) {
        return { price: null, status: PRICE_STATUS.RATE_LIMITED };
      }
      return { price: null, status: PRICE_STATUS.ERROR };
    }
  };

  // Fetch prices for multiple symbols with rate limiting
  const fetchPrices = useCallback(async (symbols, forceRefresh = false) => {
    if (!symbols || symbols.length === 0) return {};

    const uniqueSymbols = [...new Set(
      symbols.map(s => String(s || '').toUpperCase()).filter(Boolean)
    )];

    // Filter to only symbols that need fetching
    const toFetch = forceRefresh
      ? uniqueSymbols
      : uniqueSymbols.filter(sym => !isCacheValid(sym) && !inFlightRef.current.has(sym));

    if (toFetch.length === 0) {
      // Return current cached prices for requested symbols
      return getPriceMap();
    }

    setLoading(true);

    // Mark symbols as in-flight and set loading status
    toFetch.forEach(sym => {
      inFlightRef.current.add(sym);
      setPrices(prev => ({
        ...prev,
        [sym]: { price: prev[sym]?.price ?? null, timestamp: Date.now(), status: PRICE_STATUS.LOADING }
      }));
    });

    const results = {};
    let i = 0;
    let rateLimitedCount = 0;

    async function runNext() {
      if (i >= toFetch.length) return;
      const s = toFetch[i++];
      try {
        const result = await fetchSingleQuote(s);

        if (result.status === PRICE_STATUS.SUCCESS) {
          results[s] = result.price;
          setPrices(prev => ({
            ...prev,
            [s]: { price: result.price, timestamp: Date.now(), status: PRICE_STATUS.SUCCESS }
          }));
        } else if (result.status === PRICE_STATUS.RATE_LIMITED) {
          rateLimitedCount++;
          setPrices(prev => ({
            ...prev,
            [s]: { price: null, timestamp: Date.now(), status: PRICE_STATUS.RATE_LIMITED }
          }));
          // If rate limited, increase delay to back off
          await new Promise(r => setTimeout(r, REQUEST_DELAY * 3));
        } else {
          setPrices(prev => ({
            ...prev,
            [s]: { price: null, timestamp: Date.now(), status: PRICE_STATUS.ERROR }
          }));
        }
      } catch (err) {
        console.error(`Failed to fetch price for ${s}:`, err);
        setPrices(prev => ({
          ...prev,
          [s]: { price: null, timestamp: Date.now(), status: PRICE_STATUS.ERROR }
        }));
      }
      await new Promise(r => setTimeout(r, REQUEST_DELAY));
      return runNext();
    }

    // Run concurrent fetches
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT, toFetch.length) }, () => runNext())
    );

    // Clear in-flight markers
    toFetch.forEach(sym => inFlightRef.current.delete(sym));

    setLoading(false);
    setLastUpdate(new Date());

    // Return all current prices (including newly fetched)
    return { ...getPriceMap(), ...results };
  }, [isCacheValid, getPriceMap]);

  // Retry only failed symbols
  const retryFailed = useCallback(async () => {
    const failed = getFailedSymbols();
    if (failed.length === 0) return {};
    return fetchPrices(failed, true);
  }, [getFailedSymbols, fetchPrices]);

  // Clear the cache (useful for testing or manual refresh)
  const clearCache = useCallback(() => {
    setPrices({});
    setLastUpdate(null);
  }, []);

  const value = {
    prices: getPriceMap(),
    statuses: getStatusMap(),
    loading,
    lastUpdate,
    fetchPrices,
    getCachedPrice,
    getStatus,
    getFailedSymbols,
    getRateLimitedSymbols,
    retryFailed,
    isCacheValid,
    clearCache,
  };

  return (
    <PriceContext.Provider value={value}>
      {children}
    </PriceContext.Provider>
  );
}

export function usePrices() {
  const context = useContext(PriceContext);
  if (!context) {
    throw new Error('usePrices must be used within a PriceProvider');
  }
  return context;
}
