// src/context/PriceContext.jsx
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabase/supabaseClient';

// Cache TTL in milliseconds (2 minutes)
const CACHE_TTL = 2 * 60 * 1000;

// Max concurrent requests to avoid rate limiting
const MAX_CONCURRENT = 3;
const REQUEST_DELAY = 60;

const PriceContext = createContext(null);

export function PriceProvider({ children }) {
  // prices: { SYMBOL: { price: number, timestamp: number } }
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Track in-flight requests to avoid duplicates
  const inFlightRef = useRef(new Set());

  // Check if a cached price is still valid
  const isCacheValid = useCallback((symbol) => {
    const cached = prices[symbol];
    if (!cached) return false;
    return Date.now() - cached.timestamp < CACHE_TTL;
  }, [prices]);

  // Get cached price for a symbol (returns null if expired or missing)
  const getCachedPrice = useCallback((symbol) => {
    const sym = String(symbol || '').toUpperCase();
    if (!sym) return null;
    const cached = prices[sym];
    if (!cached || Date.now() - cached.timestamp >= CACHE_TTL) {
      return null;
    }
    return cached.price;
  }, [prices]);

  // Get all cached prices as a simple { SYMBOL: price } map
  const getPriceMap = useCallback(() => {
    const now = Date.now();
    const result = {};
    for (const [sym, data] of Object.entries(prices)) {
      if (now - data.timestamp < CACHE_TTL) {
        result[sym] = data.price;
      }
    }
    return result;
  }, [prices]);

  // Fetch a single quote from the edge function
  const fetchSingleQuote = async (symbol) => {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return null;

    const { data, error } = await supabase.functions.invoke('quote', { body: { symbol: sym } });
    if (error) return null;

    const price = Number(
      data?.price ??
      data?.quote?.ap ??
      data?.quote?.bp ??
      data?.trade?.p ??
      data?.bar?.c
    );

    return Number.isFinite(price) ? price : null;
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

    // Mark symbols as in-flight
    toFetch.forEach(sym => inFlightRef.current.add(sym));

    const results = {};
    let i = 0;

    async function runNext() {
      if (i >= toFetch.length) return;
      const s = toFetch[i++];
      try {
        const price = await fetchSingleQuote(s);
        if (price != null) {
          results[s] = price;
          // Update state immediately for each successful fetch
          setPrices(prev => ({
            ...prev,
            [s]: { price, timestamp: Date.now() }
          }));
        }
      } catch (err) {
        console.error(`Failed to fetch price for ${s}:`, err);
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

  // Clear the cache (useful for testing or manual refresh)
  const clearCache = useCallback(() => {
    setPrices({});
    setLastUpdate(null);
  }, []);

  const value = {
    prices: getPriceMap(),
    loading,
    lastUpdate,
    fetchPrices,
    getCachedPrice,
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
