/**
 * useMoneyStockSearch: the search behind the stock-search screen (3e STEP 2).
 * Thin seam over the shared useSymbolSearch: in the dev fixture it never
 * touches the network (the query passed to the live hook is forced empty, so
 * its own early return keeps it idle) and reads the stress catalog
 * synchronously instead. Production reads the real symbols-search function,
 * same as the draft room and TradeModal.
 */
import { useMemo } from 'react';

import { useSymbolSearch, type UseSymbolSearchResult } from '@/lib/useSymbolSearch';

import { MONEY_FIXTURE_CONFIG } from './devFixture';
import { filterStressSearchCatalog } from './stressFixture';

export function useMoneyStockSearch(query: string, selectedSymbol: string): UseSymbolSearchResult {
  const live = useSymbolSearch(MONEY_FIXTURE_CONFIG ? '' : query, selectedSymbol);
  const fixtureResults = useMemo(
    () => (MONEY_FIXTURE_CONFIG ? filterStressSearchCatalog(query) : []),
    [query],
  );
  if (MONEY_FIXTURE_CONFIG) return { results: fixtureResults, loading: false, error: false, retry: () => {} };
  return live;
}
