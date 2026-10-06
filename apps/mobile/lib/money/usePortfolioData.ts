/**
 * usePortfolioData: the caller's Portfolio for the active league (3e), built on
 * the shared league ledger. Requests: the ledger (shared with the stock sheet,
 * once per league per session), one batch quote for the held symbols, and one
 * daily-bars read for their previous closes. Three at most. Each read is
 * error-checked: a failed quote leaves those holdings at cost (captioned); a
 * failed bars read hides "today"; neither shows a $0.
 */
import { useCallback, useEffect, useState } from 'react';

import { etDateParts } from '@/lib/time/etParts';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useSession } from '@/lib/SessionProvider';
import { supabase } from '@/lib/supabase';

import { prevCloseFromBars, type DailyBar } from './prevClose';
import { portfolioHoldings, portfolioSummary } from './portfolioModel';
import { buildPortfolioView, type PortfolioView, type ViewHolding } from './portfolioView';
import { usePortfolioLedger } from './usePortfolioLedger';

export interface PortfolioData {
  status: 'loading' | 'ready' | 'error';
  /** Re-runs the ledger and the price reads (the Try again control). */
  refresh: () => void;
  view: PortfolioView | null;
  /** New network reads this load cost (the shared ledger counts only when this load fetched it). */
  requestCount: number | null;
  leagueName: string | null;
}

const NOOP = () => {};
const EMPTY: Omit<PortfolioData, 'refresh'> & { refresh: () => void } = { status: 'loading', view: null, requestCount: null, leagueName: null, refresh: NOOP };

/** ET calendar date of a Date, YYYY-MM-DD, or null when Intl can't say. */
function etIsoDate(d: Date): string | null {
  const p = etDateParts(d);
  if (!p) return null;
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function usePortfolioData(): PortfolioData {
  const { user } = useSession();
  const { activeLeague } = useLeagueContext();
  // Key on primitives, not the league object: a LeagueContext refresh that rebuilds
  // the object must not refetch the quotes and bars.
  const leagueId = activeLeague?.id ?? null;
  const leagueName = activeLeague?.name ?? null;
  const stakeMode = activeLeague?.stake_mode ?? null;
  const notional = activeLeague?.notional_per_slot ?? null;
  const numRounds = activeLeague?.num_rounds ?? null;
  const userId = user?.id ?? null;
  const ledgerState = usePortfolioLedger(leagueId);
  const [state, setState] = useState<Omit<PortfolioData, 'refresh'>>(EMPTY);
  const [tick, setTick] = useState(0);
  const ledgerRefresh = ledgerState.refresh;
  const refresh = useCallback(() => {
    ledgerRefresh();
    setTick((t) => t + 1);
  }, [ledgerRefresh]);

  useEffect(() => {
    if (!leagueId || !userId || numRounds == null) {
      setState({ ...EMPTY, status: 'error', leagueName });
      return;
    }
    if (ledgerState.status === 'loading') return;
    if (ledgerState.status === 'error' || !ledgerState.ledger) {
      setState({ ...EMPTY, status: 'error', leagueName });
      return;
    }

    const ledger = ledgerState.ledger;
    let cancelled = false;

    (async () => {
      // The caller's own rows only (the ledger is league-wide).
      const mine = ledger.activity.filter((a) => a.user_id === userId);
      const drafts = mine
        .filter((a) => a.kind === 'draft')
        .map((a) => ({ symbol: a.symbol, entryPrice: a.price, quantity: a.quantity }));
      const trades = mine
        .filter((a) => a.kind === 'trade')
        .map((a) => ({ symbol: a.symbol, action: a.action as 'buy' | 'sell', quantity: a.quantity, price: a.price }));

      // A row without its price can't be valued: refuse rather than show $0.
      if (drafts.some((d) => d.entryPrice == null) || trades.some((t) => t.price == null)) {
        setState({ ...EMPTY, status: 'error', leagueName });
        return;
      }
      const costDrafts = drafts as { symbol: string; entryPrice: number; quantity: number }[];
      const costTrades = trades as { symbol: string; action: 'buy' | 'sell'; quantity: number; price: number }[];

      const holdings = portfolioHoldings(costDrafts, costTrades);
      const symbols = holdings.map((h) => h.symbol);
      let requests = ledgerState.fetchedNow ? 1 : 0;

      const prices: Record<string, number> = {};
      const prevCloses: Record<string, number> = {};
      if (symbols.length > 0) {
        const todayEt = etIsoDate(new Date());
        const start = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);

        requests += 1;
        const { data: quoteData, error: quoteError } = await supabase.functions.invoke('quote', { body: { symbols } });
        if (quoteError) console.warn('[portfolio] quote failed', quoteError.message);
        else {
          for (const [sym, p] of Object.entries((quoteData?.prices ?? {}) as Record<string, unknown>)) {
            if (typeof p === 'number' && Number.isFinite(p) && p > 0) prices[sym.toUpperCase()] = p;
          }
        }

        if (todayEt) {
          requests += 1;
          const { data: barsData, error: barsError } = await supabase.functions.invoke('historical-bars', {
            body: { symbols, start },
          });
          if (barsError) console.warn('[portfolio] historical-bars failed', barsError.message);
          else {
            const raw = (barsData?.bars ?? {}) as Record<string, { t: string; c: number }[]>;
            for (const [sym, series] of Object.entries(raw)) {
              const bars: DailyBar[] = series.map((b) => ({ date: b.t.slice(0, 10), close: b.c }));
              const prev = prevCloseFromBars(bars, todayEt);
              if (prev != null) prevCloses[sym.toUpperCase()] = prev;
            }
          }
        }
      }
      if (cancelled) return;

      const price = (sym: string) => prices[sym] ?? null;
      const summary = portfolioSummary({
        stakeMode,
        notionalPerSlot: notional,
        numRounds,
        drafts: costDrafts,
        trades: costTrades,
        price,
      });

      const viewHoldings: ViewHolding[] = holdings.map((h) => ({
        symbol: h.symbol,
        quantity: h.quantity,
        costBasis: h.costBasis,
        price: price(h.symbol),
        prevClose: prevCloses[h.symbol] ?? null,
        name: ledger.symbol_names[h.symbol] ?? null,
      }));

      const view = buildPortfolioView({
        value: summary.value,
        cash: summary.cash,
        stake: summary.stake,
        holdings: viewHoldings,
        numRounds,
        perSlotNotional: notional,
        stakeMode,
      });

      if (__DEV__) {
        console.log(`[portfolio] ${requests} new request(s) (ledger ${ledgerState.fetchedNow ? 'fetched' : 'shared'}, ${symbols.length} holding(s))`);
      }
      setState({ status: 'ready', view, requestCount: requests, leagueName });
    })();

    return () => {
      cancelled = true;
    };
    // `tick` re-runs the price reads on Try again.
  }, [leagueId, leagueName, stakeMode, notional, numRounds, userId, ledgerState.status, ledgerState.ledger, ledgerState.fetchedNow, tick]);

  return { ...state, refresh };
}
