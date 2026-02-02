import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabase';

interface NameCache {
  [symbol: string]: string;
}

// Client-side cache (shared across hook instances, names rarely change)
const nameCache: NameCache = {};

async function fetchName(symbol: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('symbol-name', {
      body: { symbol: symbol.toUpperCase() },
    });

    if (error || !data?.name) {
      return null;
    }

    const name = data.name;
    nameCache[symbol.toUpperCase()] = name;
    return name;
  } catch (err) {
    console.error(`Failed to fetch name for ${symbol}:`, err);
    return null;
  }
}

// Abbreviate long names (e.g., "Chipotle Mexican Grill Inc" -> "Chipotle Mexican Grill")
export function abbreviateName(name: string, maxLength: number = 28): string {
  if (name.length <= maxLength) return name;

  // Common suffixes to remove for abbreviation
  const suffixes = [
    ', Inc.',
    ', Inc',
    ' Inc.',
    ' Inc',
    ' Corporation',
    ' Corp.',
    ' Corp',
    ' Company',
    ' Co.',
    ' Co',
    ' Limited',
    ' Ltd.',
    ' Ltd',
    ' Holdings',
    ' Group',
    ' International',
    ' Technologies',
    ' Technology',
    ' Incorporated',
  ];

  let shortened = name;
  for (const suffix of suffixes) {
    if (shortened.endsWith(suffix)) {
      shortened = shortened.slice(0, -suffix.length);
      if (shortened.length <= maxLength) return shortened;
    }
  }

  // If still too long, truncate with ellipsis
  if (shortened.length > maxLength) {
    return shortened.slice(0, maxLength - 1).trim() + '…';
  }

  return shortened;
}

export function useStockNames(symbols: string[]) {
  const [names, setNames] = useState<NameCache>({});
  const [loading, setLoading] = useState(false);
  const isMountedRef = useRef(true);

  const fetchNames = useCallback(async () => {
    if (symbols.length === 0) {
      setNames({});
      return;
    }

    // Check which symbols we need to fetch
    const symbolsToFetch: string[] = [];
    const cachedResults: NameCache = {};

    for (const symbol of symbols) {
      const upperSymbol = symbol.toUpperCase();
      if (nameCache[upperSymbol]) {
        cachedResults[upperSymbol] = nameCache[upperSymbol];
      } else {
        symbolsToFetch.push(upperSymbol);
      }
    }

    // If all cached, just return those
    if (symbolsToFetch.length === 0) {
      setNames(cachedResults);
      return;
    }

    setLoading(true);

    try {
      // Fetch names in parallel (with some rate limiting)
      const fetchPromises = symbolsToFetch.map(async (symbol, i) => {
        // Stagger requests slightly
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 50 * i));
        }
        const name = await fetchName(symbol);
        return { symbol, name };
      });

      const results = await Promise.all(fetchPromises);

      if (isMountedRef.current) {
        const newNames = { ...cachedResults };
        for (const { symbol, name } of results) {
          if (name) {
            newNames[symbol] = name;
          }
        }
        setNames(newNames);
      }
    } catch (err) {
      console.error('useStockNames error:', err);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [symbols.join(',')]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchNames();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchNames]);

  // Helper to get name for a specific symbol
  const getName = useCallback((symbol: string): string | null => {
    return names[symbol.toUpperCase()] || null;
  }, [names]);

  return {
    names,
    loading,
    getName,
  };
}

// Utility to clear cache (useful for testing)
export function clearNameCache() {
  Object.keys(nameCache).forEach(key => delete nameCache[key]);
}
