/**
 * useMoneyStockSearch: the search behind the stock-search screen (3e STEP 2).
 * Thin seam over the shared useSymbolSearch: in the dev fixture it never
 * touches the network (the query passed to the live hook is forced empty, so
 * its own early return keeps it idle) and reads the stress catalog
 * synchronously instead. Production reads the real symbols-search function,
 * same as the draft room and TradeModal.
 *
 * Two scenarios (E-1/E-2, 3e UX audit stills) step outside that synchronous
 * path: search_fail answers every attempt as a failure (never a clean "no
 * matches" -- E-1 pins that a thrown search must read as `error`, and the
 * fixture needs to produce the same state to capture it), and search_delay
 * holds the loading state for a beat so the skeleton (E-2) is catchable in a
 * screenshot. searchFixtureBehavior (fixtureMode.ts) is the pure decision;
 * this hook only carries its own timer. Neither scenario's retry does
 * anything -- the fixture's answer is deterministic from the query alone, so
 * there is nothing a retry would change; it exists only so the error state's
 * "Try again" control has something to call.
 */
import { useEffect, useMemo, useState } from 'react';

import { useSymbolSearch, type UseSymbolSearchResult } from '@/lib/useSymbolSearch';

import { MONEY_FIXTURE_CONFIG } from './devFixture';
import { filterStressSearchCatalog } from './stressFixture';
import { searchFixtureBehavior } from './fixtureMode';

const NOOP = () => {};

export function useMoneyStockSearch(query: string, selectedSymbol: string): UseSymbolSearchResult {
  const live = useSymbolSearch(MONEY_FIXTURE_CONFIG ? '' : query, selectedSymbol);
  const fixtureResults = useMemo(
    () => (MONEY_FIXTURE_CONFIG ? filterStressSearchCatalog(query) : []),
    [query],
  );
  const behavior = MONEY_FIXTURE_CONFIG ? searchFixtureBehavior(MONEY_FIXTURE_CONFIG.scenario) : { kind: 'normal' as const };
  const delayMs = behavior.kind === 'delay' ? behavior.ms : 0;
  const [delayedLoading, setDelayedLoading] = useState(false);

  useEffect(() => {
    if (delayMs === 0 || query.length === 0) {
      setDelayedLoading(false);
      return;
    }
    setDelayedLoading(true);
    const t = setTimeout(() => setDelayedLoading(false), delayMs);
    return () => clearTimeout(t);
  }, [query, delayMs]);

  if (!MONEY_FIXTURE_CONFIG) return live;

  if (behavior.kind === 'fail') {
    return { results: [], loading: false, error: query.length > 0, retry: NOOP };
  }
  if (behavior.kind === 'delay') {
    return { results: delayedLoading ? [] : fixtureResults, loading: delayedLoading, error: false, retry: NOOP };
  }
  return { results: fixtureResults, loading: false, error: false, retry: NOOP };
}
