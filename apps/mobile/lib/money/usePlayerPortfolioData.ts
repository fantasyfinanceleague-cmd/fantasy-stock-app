/**
 * usePlayerPortfolioData: another manager's portfolio in the active league (3e),
 * read-only. The league ledger (shared), then the price reads for that manager's
 * holdings. DEV fixture: the stress ledger and market, with no network.
 */
import { useEffect, useState } from 'react';

import { useLeagueContext } from '@/lib/LeagueContext';

import { MONEY_FIXTURE_CONFIG } from './devFixture';
import { fixtureLeague, FIXTURE_LEAGUE_ID } from './fixtureMode';
import { playerPortfolio, type PlayerPortfolio } from './playerPortfolio';
import { readPriceMarks } from './priceReads';
import { buildStressMarket, STRESS_LEAGUE_NAME } from './stressFixture';
import { usePortfolioLedger } from './usePortfolioLedger';

export interface PlayerPortfolioData {
  status: 'loading' | 'ready' | 'error';
  portfolio: PlayerPortfolio | null;
  leagueName: string | null;
  /** Re-runs the ledger and the price reads (the Try again control). */
  refresh: () => void;
}

export function usePlayerPortfolioData(userId: string | null): PlayerPortfolioData {
  const { activeLeague } = useLeagueContext();
  const leagueId = activeLeague?.id ?? (MONEY_FIXTURE_CONFIG ? FIXTURE_LEAGUE_ID : null);
  const ledgerState = usePortfolioLedger(leagueId);
  const [state, setState] = useState<Omit<PlayerPortfolioData, 'refresh'>>({ status: 'loading', portfolio: null, leagueName: null });
  const ledgerRefresh = ledgerState.refresh;

  const settings = MONEY_FIXTURE_CONFIG ? fixtureLeague(MONEY_FIXTURE_CONFIG.stake) : null;
  const stakeMode = settings ? settings.stake_mode : (activeLeague?.stake_mode ?? null);
  const notional = settings ? settings.notional_per_slot : (activeLeague?.notional_per_slot ?? null);
  const numRounds = settings ? settings.num_rounds : (activeLeague?.num_rounds ?? null);
  const leagueName = MONEY_FIXTURE_CONFIG ? STRESS_LEAGUE_NAME : (activeLeague?.name ?? null);

  useEffect(() => {
    if (!userId || ledgerState.status === 'loading') return;
    if (ledgerState.status === 'error' || !ledgerState.ledger || numRounds == null) {
      setState({ status: 'error', portfolio: null, leagueName });
      return;
    }
    const ledger = ledgerState.ledger;
    let cancelled = false;
    (async () => {
      const symbols = ledger.activity.filter((a) => a.user_id === userId).map((a) => a.symbol.toUpperCase());
      const unique = [...new Set(symbols)];
      const marks = MONEY_FIXTURE_CONFIG
        ? { ...buildStressMarket(), requests: 0 }
        : await readPriceMarks(unique);
      if (cancelled) return;
      const portfolio = playerPortfolio({
        ledger,
        userId,
        stakeMode,
        notionalPerSlot: notional,
        numRounds,
        prices: marks.prices,
        prevCloses: marks.prevCloses,
      });
      setState({ status: portfolio ? 'ready' : 'error', portfolio, leagueName });
    })();
    return () => {
      cancelled = true;
    };
    // The ledger object and the league settings are the inputs; the price reads follow them.
  }, [userId, ledgerState.status, ledgerState.ledger, stakeMode, notional, numRounds, leagueName]);

  return { ...state, refresh: ledgerRefresh };
}
