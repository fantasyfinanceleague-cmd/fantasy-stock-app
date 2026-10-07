import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { SEAM_ON } from '@/lib/game/devSeam';
import { invokeFixtureFor } from '@/lib/game/seamFixtures';
import { shapeSearchResults, type RawSearchItem, type ShapedSearchResult, type ShapeSearchResultsOptions } from '@/lib/symbolSearch';

export interface UseSymbolSearchOptions extends ShapeSearchResultsOptions {
  /** Debounce delay in ms — matches TradeModal's original 300ms. */
  debounceMs?: number;
  /** Max results requested from symbols-search — matches TradeModal's original 8. */
  limit?: number;
}

export interface UseSymbolSearchResult {
  results: ShapedSearchResult[];
  loading: boolean;
}

/**
 * Debounced `symbols-search` lookup, shared by TradeModal and the draft
 * screen (see components/SymbolSearchField.tsx for the shared UI, and
 * lib/symbolSearch.ts for the pure result-shaping this hook calls).
 *
 * Pass a query and the currently-confirmed symbol (if any) — searching is
 * suppressed once the input matches the confirmed symbol, same as
 * TradeModal's original guard.
 *
 * `ownedSymbols` should be a MEMOIZED Set (useMemo) — it's a dependency of
 * the effect, and a fresh Set identity every render would re-fire the search
 * on every keystroke's parent re-render, not just on actual query changes.
 */
export function useSymbolSearch(
  query: string,
  selectedSymbol: string,
  opts: UseSymbolSearchOptions = {},
): UseSymbolSearchResult {
  const { ownedSymbols, allowUndraftable, ownedBadgeLabel, debounceMs = 300, limit = 8 } = opts;
  const [results, setResults] = useState<ShapedSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic request sequence: an in-flight search whose response arrives
  // AFTER a newer search was already issued must not overwrite the newer
  // (or empty) result set. TradeModal's original effect had no such guard.
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (!query || query.length < 1) {
      requestSeqRef.current++; // invalidate any in-flight response
      setResults([]);
      setLoading(false);
      return;
    }
    if (selectedSymbol && query.toUpperCase() === selectedSymbol.toUpperCase()) {
      requestSeqRef.current++;
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const mySeq = ++requestSeqRef.current;

    timeoutRef.current = setTimeout(async () => {
      try {
        const body = { q: query, limit, includePrices: true };
        // DEV capture seam (off outside a dev build): sample results, no real call.
        const fixture = SEAM_ON ? invokeFixtureFor('symbols-search', body) : null;
        const { data, error } = fixture ?? (await supabase.functions.invoke('symbols-search', { body }));
        if (mySeq !== requestSeqRef.current) return; // superseded — drop it
        if (error) throw error;
        const items = (data as { items?: RawSearchItem[] } | null)?.items || [];
        setResults(shapeSearchResults(items, { ownedSymbols, allowUndraftable, ownedBadgeLabel }));
      } catch (err) {
        if (mySeq !== requestSeqRef.current) return;
        console.error('Symbol search failed:', err);
        setResults([]);
      } finally {
        if (mySeq === requestSeqRef.current) setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [query, selectedSymbol, limit, debounceMs, ownedSymbols, allowUndraftable, ownedBadgeLabel]);

  return { results, loading };
}
