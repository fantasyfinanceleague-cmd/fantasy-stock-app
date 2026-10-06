/**
 * useStockSheetData: the stock sheet's facts for one symbol in the active
 * league (3e). Everything is read with its error checked (supabase-js resolves
 * errors, it doesn't throw). A failed read leaves that fact null, and the
 * model shows it as unknown, never as a number. Ownership is the one exception:
 * if the draft or trade rows can't be read, the whole sheet is `error`, because
 * it could not say who owns the stock.
 */
import { useCallback, useEffect, useState } from 'react';

import { useLeagueContext } from '@/lib/LeagueContext';
import { useSession } from '@/lib/SessionProvider';
import { supabase } from '@/lib/supabase';

import { deriveStockSheetFacts, type FactsDraft, type FactsName, type FactsTrade, type StockSheetFacts } from './stockSheetFacts';

export interface StockSheetData {
  status: 'loading' | 'ready' | 'error';
  price: number | null;
  prevClose: number | null;
  companyName: string | null;
  facts: StockSheetFacts | null;
  leagueName: string | null;
  refresh: () => void;
}

const EMPTY: StockSheetData = {
  status: 'loading', price: null, prevClose: null, companyName: null, facts: null, leagueName: null, refresh: () => {},
};

export function useStockSheetData(symbol: string): StockSheetData {
  const { user } = useSession();
  const { activeLeague } = useLeagueContext();
  const leagueId = activeLeague?.id ?? null;
  const leagueName = activeLeague?.name ?? null;
  const userId = user?.id ?? null;
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<StockSheetData>(EMPTY);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!leagueId || !userId) {
      // No active league or signed-in user: nothing to read, so say so rather than load forever.
      setState({ ...EMPTY, status: 'error', refresh });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, status: 'loading', leagueName, refresh }));

    (async () => {
      const [quoteRes, nameRes, draftsRes, tradesRes, namesRes] = await Promise.all([
        supabase.functions.invoke('ticker-quotes', { body: { symbol } }),
        supabase.functions.invoke('symbol-name', { body: { symbol } }),
        supabase.from('drafts').select('user_id, symbol, quantity, round, pick_number').eq('league_id', leagueId),
        supabase.from('trades').select('user_id, symbol, action, quantity').eq('league_id', leagueId),
        supabase.rpc('get_league_display_names', { p_league_id: leagueId }),
      ]);
      if (cancelled) return;

      // Ownership is all-or-nothing: without the rows we cannot say who owns it.
      if (draftsRes.error || tradesRes.error) {
        console.warn('[stock-sheet] ownership read failed', draftsRes.error?.message ?? tradesRes.error?.message);
        setState((prev) => ({ ...prev, status: 'error', refresh }));
        return;
      }

      const q = quoteRes.error ? null : (quoteRes.data as { price?: number | null; prevClose?: number | null } | null);
      const price = q && typeof q.price === 'number' && Number.isFinite(q.price) && q.price > 0 ? q.price : null;
      const prevClose = q && typeof q.prevClose === 'number' && q.prevClose > 0 ? q.prevClose : null;
      const companyName = !nameRes.error && typeof (nameRes.data as { name?: unknown } | null)?.name === 'string'
        ? ((nameRes.data as { name: string }).name)
        : null;

      const names: Record<string, FactsName> = {};
      if (namesRes.error) {
        console.warn('[stock-sheet] display names failed', namesRes.error.message);
      } else {
        for (const n of (namesRes.data ?? []) as { user_id: string; display_name: string; is_bot: boolean }[]) {
          names[String(n.user_id)] = { displayName: n.display_name, isBot: n.is_bot };
        }
      }

      const drafts = (draftsRes.data ?? []) as FactsDraft[];
      const facts = deriveStockSheetFacts({
        symbol,
        userId,
        drafts,
        trades: (tradesRes.data ?? []) as FactsTrade[],
        leaguePicks: drafts.map((d) => ({ round: d.round, user_id: String(d.user_id) })),
        names,
      });

      setState({ status: 'ready', price, prevClose, companyName, facts, leagueName, refresh });
    })();

    return () => {
      cancelled = true;
    };
    // `refresh` is stable; `tick` re-runs the reads on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, leagueId, leagueName, userId, tick]);

  return state;
}
