/**
 * usePortfolioLedger: the league's get_portfolio_ledger, loaded at most once
 * per league per session and shared by the stock sheet and Portfolio (3e).
 * Failures are never cached, so a retry really retries. A malformed response
 * is refused (see portfolioLedger.parsePortfolioLedger).
 */
import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

import { parsePortfolioLedger, type PortfolioLedger } from './portfolioLedger';
import { MONEY_FIXTURE } from './devFixture';
import { buildStressMarket } from './stressFixture';

const loaded = new Map<string, PortfolioLedger>();
const inFlight = new Map<string, Promise<PortfolioLedger | null>>();

/** Loads the ledger for a league, de-duplicated and cached on success. */
export function loadPortfolioLedger(leagueId: string): Promise<PortfolioLedger | null> {
  // DEV fixture: the stress ledger, no network (see devFixture.ts).
  if (MONEY_FIXTURE) return Promise.resolve(buildStressMarket().ledger);
  const hit = loaded.get(leagueId);
  if (hit) return Promise.resolve(hit);
  const pending = inFlight.get(leagueId);
  if (pending) return pending;

  const p = (async () => {
    const { data, error } = await supabase.rpc('get_portfolio_ledger', { p_league_id: leagueId });
    if (error) {
      console.warn('[ledger] get_portfolio_ledger failed', error.message);
      return null;
    }
    const parsed = parsePortfolioLedger(data);
    if (!parsed) {
      console.warn('[ledger] get_portfolio_ledger response refused (malformed)');
      return null;
    }
    loaded.set(leagueId, parsed);
    return parsed;
  })().finally(() => inFlight.delete(leagueId));

  inFlight.set(leagueId, p);
  return p;
}

export interface PortfolioLedgerState {
  status: 'loading' | 'ready' | 'error';
  ledger: PortfolioLedger | null;
  /** True when this hook's load was a network read, not a cache hit. */
  fetchedNow: boolean;
  /** Re-runs the load. Use it after an error (failures are never cached). */
  refresh: () => void;
}

export function usePortfolioLedger(leagueId: string | null): PortfolioLedgerState {
  const [state, setState] = useState<Omit<PortfolioLedgerState, 'refresh'>>({ status: 'loading', ledger: null, fetchedNow: false });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!leagueId) {
      setState({ status: 'error', ledger: null, fetchedNow: false });
      return;
    }
    let cancelled = false;
    const wasCached = loaded.has(leagueId);
    setState({ status: 'loading', ledger: loaded.get(leagueId) ?? null, fetchedNow: false });
    loadPortfolioLedger(leagueId).then((ledger) => {
      if (cancelled) return;
      setState({
        status: ledger ? 'ready' : 'error',
        ledger,
        fetchedNow: !wasCached,
      });
    });
    return () => {
      cancelled = true;
    };
    // `tick` re-runs the load after an error.
  }, [leagueId, tick]);

  return { ...state, refresh };
}
