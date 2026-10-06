/**
 * useStockSheetData: the stock sheet's facts for one symbol in the active
 * league (3e). It reuses the league ledger (shared with Portfolio), a short
 * quote cache and a name cache, and fetches only what is genuinely missing
 * (sheetRequests.planSheetRequests). Every read is error-checked: a failed
 * price or name stays unknown, never a number. Ownership comes from the ledger;
 * if the ledger can't be read, the sheet is in error rather than guessing.
 */
import { useCallback, useEffect, useState } from 'react';

import { useLeagueContext } from '@/lib/LeagueContext';
import { useSession } from '@/lib/SessionProvider';
import { supabase } from '@/lib/supabase';

import { planSheetRequests } from './sheetRequests';
import { sheetInputsFromLedger } from './portfolioLedger';
import { deriveStockSheetFacts, type StockSheetFacts } from './stockSheetFacts';
import { usePortfolioLedger } from './usePortfolioLedger';

/** A quote is fresh for two minutes, the same window as useStockPrices. */
const QUOTE_TTL_MS = 120_000;

interface CachedQuote {
  price: number | null;
  prevClose: number | null;
  at: number;
}
const quoteCache = new Map<string, CachedQuote>();
// Company names are stable: cached for the session, never refetched.
const nameCache = new Map<string, string>();

export interface StockSheetData {
  status: 'loading' | 'ready' | 'error';
  price: number | null;
  prevClose: number | null;
  companyName: string | null;
  facts: StockSheetFacts | null;
  leagueName: string | null;
  /** The case this open falls in, and how many network reads it cost. Logged in __DEV__. */
  requestCase: 'held' | 'free' | 'owned-by-other' | null;
  requestCount: number | null;
  refresh: () => void;
}

const EMPTY: StockSheetData = {
  status: 'loading', price: null, prevClose: null, companyName: null, facts: null,
  leagueName: null, requestCase: null, requestCount: null, refresh: () => {},
};

export function useStockSheetData(symbol: string): StockSheetData {
  const { user } = useSession();
  const { activeLeague } = useLeagueContext();
  const leagueId = activeLeague?.id ?? null;
  const leagueName = activeLeague?.name ?? null;
  const userId = user?.id ?? null;
  const ledgerState = usePortfolioLedger(leagueId);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<StockSheetData>(EMPTY);

  const refresh = useCallback(() => {
    quoteCache.delete(symbol.toUpperCase());
    setTick((t) => t + 1);
  }, [symbol]);

  useEffect(() => {
    if (ledgerState.status === 'loading') return;
    if (ledgerState.status === 'error' || !ledgerState.ledger || !userId) {
      setState({ ...EMPTY, status: 'error', leagueName, refresh });
      return;
    }
    const ledger = ledgerState.ledger;
    const sym = symbol.toUpperCase();
    let cancelled = false;

    (async () => {
      const inputs = sheetInputsFromLedger(ledger);
      const facts = deriveStockSheetFacts({ symbol: sym, userId, ...inputs });

      const cachedQuote = quoteCache.get(sym);
      const quoteFresh = !!cachedQuote && Date.now() - cachedQuote.at < QUOTE_TTL_MS;
      const ledgerName = ledger.symbol_names[sym] ?? null;
      const nameKnown = !!ledgerName || nameCache.has(sym);

      // Only the missing reads are made.
      const plan = planSheetRequests({ ledgerLoaded: !ledgerState.fetchedNow, quoteCached: quoteFresh, nameKnown });

      let quote = cachedQuote ?? null;
      if (!quoteFresh) {
        const { data, error } = await supabase.functions.invoke('ticker-quotes', { body: { symbol: sym } });
        if (cancelled) return;
        if (error) {
          console.warn('[stock-sheet] quote failed', error.message);
          quote = null;
        } else {
          const d = data as { price?: unknown; prevClose?: unknown } | null;
          const price = typeof d?.price === 'number' && Number.isFinite(d.price) && d.price > 0 ? d.price : null;
          const prevClose = typeof d?.prevClose === 'number' && d.prevClose > 0 ? d.prevClose : null;
          quote = { price, prevClose, at: Date.now() };
          quoteCache.set(sym, quote);
        }
      }

      let companyName: string | null = ledgerName ?? nameCache.get(sym) ?? null;
      if (!nameKnown) {
        const { data, error } = await supabase.functions.invoke('symbol-name', { body: { symbol: sym } });
        if (cancelled) return;
        const name = !error && typeof (data as { name?: unknown } | null)?.name === 'string' ? (data as { name: string }).name : null;
        if (name) nameCache.set(sym, name);
        companyName = name;
      }

      const requestCase: StockSheetData['requestCase'] = facts.held
        ? 'held'
        : facts.owner?.kind === 'other'
          ? 'owned-by-other'
          : 'free';
      // The ledger counts only when this open is the one that loaded it.
      const requestCount = plan.count + (ledgerState.fetchedNow ? 1 : 0);
      if (__DEV__) {
        console.log(`[stock-sheet] ${sym} ${requestCase}: ${requestCount} new request(s) (ledger ${ledgerState.fetchedNow ? 'fetched' : 'shared'}, quote ${plan.quote && !quoteFresh ? 'fetched' : 'cached'}, name ${nameKnown ? 'known' : 'fetched'})`);
      }

      setState({
        status: 'ready',
        price: quote?.price ?? null,
        prevClose: quote?.prevClose ?? null,
        companyName,
        facts,
        leagueName,
        requestCase,
        requestCount,
        refresh,
      });
    })();

    return () => {
      cancelled = true;
    };
    // `refresh` depends on the symbol and is re-created with it; `tick` re-runs the reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, leagueId, leagueName, userId, ledgerState.status, ledgerState.ledger, ledgerState.fetchedNow, tick]);

  return state;
}
