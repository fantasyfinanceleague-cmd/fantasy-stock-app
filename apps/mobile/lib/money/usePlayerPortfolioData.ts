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
import type { PortfolioLedger } from './portfolioLedger';
import type { DailyBar } from './prevClose';
import { readPriceMarks, type PriceMarks } from './priceReads';
import { seamBars, seamQuote } from './portfolioSeam';
import { CAPTURE_LOSS, MATCHUP_FIXTURE_VARIANT, SEAM_ON } from '../game/devSeam';
import { HOME_FIXTURE } from '../home/devFixture';
import { buildStressMarket, STRESS_LEAGUE_NAME } from './stressFixture';
import { usePortfolioLedger } from './usePortfolioLedger';

export interface PlayerPortfolioData {
  status: 'loading' | 'ready' | 'error';
  portfolio: PlayerPortfolio | null;
  leagueName: string | null;
  /** The league the team belongs to (null: no active league). */
  leagueId: string | null;
  /** The shared league ledger the team was built from (the player card's opening events and names). */
  ledger: PortfolioLedger | null;
  /** Live prices and previous closes by symbol (the player card's figures). */
  prices: Record<string, number>;
  /** Daily bars per symbol they ever held, from their first activity on (the card's lines). */
  bars: Record<string, DailyBar[]>;
  /** Re-runs the ledger and the price reads (the Try again control). */
  refresh: () => void;
}

export function usePlayerPortfolioData(userId: string | null): PlayerPortfolioData {
  const { activeLeague } = useLeagueContext();
  const leagueId = activeLeague?.id ?? (MONEY_FIXTURE_CONFIG ? FIXTURE_LEAGUE_ID : null);
  const ledgerState = usePortfolioLedger(leagueId);
  const [state, setState] = useState<Pick<PlayerPortfolioData, 'status' | 'portfolio' | 'leagueName' | 'prices' | 'bars'>>({ status: 'loading', portfolio: null, leagueName: null, prices: {}, bars: {} });
  const ledgerRefresh = ledgerState.refresh;

  const settings = MONEY_FIXTURE_CONFIG ? fixtureLeague(MONEY_FIXTURE_CONFIG.stake) : null;
  const stakeMode = settings ? settings.stake_mode : (activeLeague?.stake_mode ?? null);
  const notional = settings ? settings.notional_per_slot : (activeLeague?.notional_per_slot ?? null);
  const numRounds = settings ? settings.num_rounds : (activeLeague?.num_rounds ?? null);
  const leagueName = MONEY_FIXTURE_CONFIG ? STRESS_LEAGUE_NAME : (activeLeague?.name ?? null);

  useEffect(() => {
    // No manager to show is a failure with a retry, never a spinner that never ends.
    if (!userId) {
      setState({ status: 'error', portfolio: null, leagueName, prices: {}, bars: {} });
      return;
    }
    if (ledgerState.status === 'loading') return;
    if (ledgerState.status === 'error' || !ledgerState.ledger || numRounds == null) {
      setState({ status: 'error', portfolio: null, leagueName, prices: {}, bars: {} });
      return;
    }
    const ledger = ledgerState.ledger;
    let cancelled = false;
    (async () => {
      const theirs = ledger.activity.filter((a) => a.user_id === userId);
      const unique = [...new Set(theirs.map((a) => a.symbol.toUpperCase()))];
      // Bars from their first activity (the card's season line), the same request as the previous closes.
      const firstDate = theirs.map((a) => a.occurred_at.slice(0, 10)).sort()[0] ?? null;
      let marks: Pick<PriceMarks, 'prices' | 'prevCloses'> & { bars?: PriceMarks['bars'] };
      if (MONEY_FIXTURE_CONFIG) {
        marks = buildStressMarket();
      } else if (SEAM_ON) {
        // The capture seam: the Matchup fixture's quotes and daily paths, no network.
        marks = { prices: {}, prevCloses: {}, bars: {} };
        for (const sym of unique) {
          const q = seamQuote(sym, MATCHUP_FIXTURE_VARIANT, { homeFixture: HOME_FIXTURE, loss: CAPTURE_LOSS });
          if (q) {
            marks.prices[sym] = q.price;
            marks.prevCloses[sym] = q.prevClose;
          }
          marks.bars![sym] = seamBars(sym, MATCHUP_FIXTURE_VARIANT, { loss: CAPTURE_LOSS });
        }
      } else {
        marks = await readPriceMarks(unique, new Date(), { barsSymbols: unique, barsStart: firstDate });
      }
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
      setState({ status: portfolio ? 'ready' : 'error', portfolio, leagueName, prices: marks.prices, bars: marks.bars ?? {} });
    })();
    return () => {
      cancelled = true;
    };
    // The ledger object and the league settings are the inputs; the price reads follow them.
  }, [userId, ledgerState.status, ledgerState.ledger, stakeMode, notional, numRounds, leagueName]);

  return { ...state, leagueId, ledger: ledgerState.ledger, refresh: ledgerRefresh };
}
