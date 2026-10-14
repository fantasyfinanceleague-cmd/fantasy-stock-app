/**
 * usePortfolioData: the caller's Portfolio for the active league (3e; W4 Game Night), built
 * on the shared league ledger. Requests: the ledger (shared with the stock sheet, once per
 * league per session), one batch quote for the held symbols, one daily-bars read, and the
 * record-trade preview (slot labels and the buy row). Each read is error-checked: a failed
 * quote leaves those holdings at cost (captioned); a failed bars read hides "today" and draws
 * the value line with its base and axis only; neither shows a $0.
 *
 * W4: the bars read now starts at the draft and covers every stock ever held (the same one
 * request, wider), so it also feeds the value line (portfolioChart) and each player card's
 * season line, with no new request.
 */
import { useCallback, useEffect, useState } from 'react';

import { useLeagueContext } from '@/lib/LeagueContext';
import { useSession } from '@/lib/SessionProvider';

import { readPriceMarks } from './priceReads';
import { portfolioHoldings, portfolioSummary } from './portfolioModel';
import { buildPortfolioView, type PortfolioView, type ViewHolding } from './portfolioView';
import { usePortfolioLedger } from './usePortfolioLedger';
import { fetchPreview } from './recordTrade';
import { previewBody } from './tradeBodies';
import { slotLabelFor, slotLabelsBySymbol } from './tierContract';
import { categoryNameOf, loadCategoryNames } from './categoryNames';
import { MONEY_FIXTURE, MONEY_FIXTURE_CONFIG } from './devFixture';
import { buildStressMarket, stressChartBars, STRESS_CALLER, STRESS_LEAGUE_NAME } from './stressFixture';
import { FIXTURE_LEAGUE_ID, fixtureLeague } from './fixtureMode';
import { budgetLeftOf, effectiveBudgetCap, userCashSpentFromLedger } from './budgetFigures';
import { draftDateOf, type ChartActivityRow, type ChartStake } from './portfolioChart';
import { seamBars, seamOpenSales, seamPortfolioLeague, seamQuote } from './portfolioSeam';
import { CAPTURE_LOSS, MATCHUP_FIXTURE_VARIANT, PORTFOLIO_STAKE_VARIANT, SEAM_ON } from '../game/devSeam';
import { HOME_FIXTURE } from '../home/devFixture';
import type { DailyBar } from './prevClose';
import type { BuyRowInput } from './buyRowLine';

export interface PortfolioChartInputs {
  /** The caller's ledger rows, for the value line (portfolioChart.dailyValues). */
  rows: ChartActivityRow[];
  /** Daily bars per symbol ever held, from the draft on. */
  bars: Record<string, DailyBar[]>;
  stake: ChartStake;
  /** The draft's instant (the 1W line starts there in a season drafted this week). */
  draftAt: string | null;
  /** The header's value: the line's live end. */
  liveValue: number;
}

export interface PortfolioData {
  status: 'loading' | 'ready' | 'error';
  /** Re-runs the ledger and the price reads (the Try again control). */
  refresh: () => void;
  view: PortfolioView | null;
  chart: PortfolioChartInputs | null;
  /** Live prices and previous closes by symbol (the player card's figures). */
  prices: Record<string, number>;
  /** New network reads this load cost (the shared ledger counts only when this load fetched it). */
  requestCount: number | null;
  leagueName: string | null;
}

// No `refresh` here: the hook returns `{ ...state, refresh }`, the real one, in every state.
const EMPTY: Omit<PortfolioData, 'refresh'> = { status: 'loading', view: null, chart: null, prices: {}, requestCount: null, leagueName: null };

/** The league settings Portfolio reads: the stress money fixture's, the capture seam's, or the real league's. */
function settingsOf(activeLeague: { stake_mode: string | null; notional_per_slot: number | null; num_rounds: number; budget_amount: number | null } | null) {
  if (MONEY_FIXTURE_CONFIG) return fixtureLeague(MONEY_FIXTURE_CONFIG.stake);
  if (SEAM_ON) return seamPortfolioLeague(PORTFOLIO_STAKE_VARIANT, MATCHUP_FIXTURE_VARIANT);
  if (!activeLeague) return null;
  return {
    stake_mode: activeLeague.stake_mode as 'fixed_notional' | 'budget_cap' | 'price_tiers' | null,
    notional_per_slot: activeLeague.notional_per_slot,
    budget_amount: activeLeague.budget_amount,
    num_rounds: activeLeague.num_rounds,
  };
}

export function usePortfolioData(): PortfolioData {
  const { user, loading: sessionLoading } = useSession();
  const { activeLeague, loading: leaguesLoading } = useLeagueContext();
  // Key on primitives, not the league object: a LeagueContext refresh that rebuilds
  // the object must not refetch the quotes and bars.
  const settings = settingsOf(activeLeague);
  const leagueId = activeLeague?.id ?? (MONEY_FIXTURE ? FIXTURE_LEAGUE_ID : null);
  // DEV fixture: the stress league's settings (price tiers, six rounds, no notional), so the
  // numbers match the stress holdings. Production reads the real league.
  const leagueName = MONEY_FIXTURE ? STRESS_LEAGUE_NAME : (activeLeague?.name ?? null);
  const stakeMode = settings?.stake_mode ?? null;
  const notional = settings?.notional_per_slot ?? null;
  const numRounds = settings?.num_rounds ?? null;
  const budgetAmount = settings?.budget_amount ?? null;
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
      // The session or the leagues aren't read yet: that's loading, not a failure (the W4
      // capture caught "didn't load" flashing at every launch).
      const pending = sessionLoading || leaguesLoading;
      setState(pending ? { ...EMPTY, status: 'loading', leagueName } : { ...EMPTY, status: 'error', leagueName });
      return;
    }
    // Still loading: say so. (Without this, an earlier render's 'error' — the session's user
    // not read yet — stuck on screen as "didn't load" for as long as the ledger took.)
    if (ledgerState.status === 'loading') {
      setState((cur) => (cur.status === 'loading' ? cur : { ...EMPTY, status: 'loading', leagueName }));
      return;
    }
    if (ledgerState.status === 'error' || !ledgerState.ledger) {
      setState({ ...EMPTY, status: 'error', leagueName });
      return;
    }

    const ledger = ledgerState.ledger;
    let cancelled = false;

    (async () => {
      // The caller's own rows only (the ledger is league-wide).
      // DEV fixture: the stress caller, with the stress market's prices (no quote or bars read).
      const market = MONEY_FIXTURE ? buildStressMarket() : null;
      const callerId = market ? STRESS_CALLER : userId;
      const mine = ledger.activity.filter((a) => a.user_id === callerId);
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
      const everHeld = [...new Set(mine.map((a) => a.symbol.toUpperCase()))];
      const chartRows: ChartActivityRow[] = mine.map((a) => ({
        kind: a.kind, action: a.action as 'buy' | 'sell', symbol: a.symbol.toUpperCase(), quantity: a.quantity, price: a.price as number, occurredAt: a.occurred_at,
      }));
      const draftDate = draftDateOf(chartRows);
      let requests = ledgerState.fetchedNow ? 1 : 0;

      const prices: Record<string, number> = {};
      const prevCloses: Record<string, number> = {};
      const bars: Record<string, DailyBar[]> = {};
      if (market) {
        for (const [sym, p] of Object.entries(market.prices)) prices[sym] = p;
        for (const [sym, p] of Object.entries(market.prevCloses)) prevCloses[sym] = p;
        for (const sym of everHeld) bars[sym] = stressChartBars(sym);
      } else if (SEAM_ON) {
        // The capture seam: the Matchup fixture's quotes and daily paths, no network.
        for (const sym of everHeld) {
          const q = seamQuote(sym, MATCHUP_FIXTURE_VARIANT, { homeFixture: HOME_FIXTURE, loss: CAPTURE_LOSS });
          if (q) {
            prices[sym] = q.price;
            prevCloses[sym] = q.prevClose;
          }
          bars[sym] = seamBars(sym, MATCHUP_FIXTURE_VARIANT, { loss: CAPTURE_LOSS });
        }
      } else {
        // priceReads.readPriceMarks: the same quote + daily-bars read the stock sheet uses
        // (shared, error-checked the same way — a failed read leaves its marks empty, never $0),
        // widened to every stock ever held since the draft for the value line.
        const marks = await readPriceMarks(symbols, new Date(), { barsSymbols: everHeld, barsStart: draftDate });
        requests += marks.requests;
        Object.assign(prices, marks.prices);
        Object.assign(prevCloses, marks.prevCloses);
        Object.assign(bars, marks.bars);
      }
      if (cancelled) return;

      // The slot labels come from the server's preview (the caller's slot map), not from the ledger.
      // E-4: the same preview also carries fixed_notional's open sale proceeds (sources) and
      // price_tiers' open slots (slots) -- the "Buy a stock" row's second line, no extra request.
      let slotLabels: Record<string, string> = {};
      let sales: BuyRowInput['sales'] = [];
      let openSlotLabels: string[] = [];
      if (SEAM_ON) {
        sales = seamOpenSales(ledger, callerId);
      } else if (!market && leagueId) {
        requests += 1;
        const preview = await fetchPreview(previewBody(leagueId));
        if (preview) {
          await loadCategoryNames();
          slotLabels = slotLabelsBySymbol(preview.slots, categoryNameOf);
          sales = preview.sources.map((s) => ({ symbol: s.symbol, amount: s.amount }));
          openSlotLabels = (preview.slots ?? [])
            .filter((s) => s.open > 0)
            .map((s) => slotLabelFor(s, categoryNameOf))
            .filter((l): l is string => l != null);
        }
      }
      if (cancelled) return;

      // budget_cap's "budget left": the league's own budget_amount minus cash spent, from the
      // ledger alone (same formula the budget review already shows) -- no extra request either.
      const cashSpent = userCashSpentFromLedger(ledger, callerId);
      // The server's cap (a NULL budget_amount is $0 there and here: effectiveBudgetCap).
      const cap = effectiveBudgetCap(stakeMode, budgetAmount);
      const budgetLeft = cap == null ? null : budgetLeftOf(cap, cashSpent);
      const rosterFull = holdings.length >= numRounds;

      const price = (sym: string) => prices[sym] ?? null;
      const stake: ChartStake = { stakeMode, notionalPerSlot: notional, numRounds };
      const summary = portfolioSummary({ ...stake, drafts: costDrafts, trades: costTrades, price });

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
        slotLabels,
        buyRow: { stakeMode, sales, budgetLeft, rosterFull, openSlotLabels },
      });
      const firstDraft = mine.filter((a) => a.kind === 'draft').map((a) => a.occurred_at).sort()[0] ?? null;

      if (__DEV__) {
        console.log(`[portfolio] ${requests} new request(s) (ledger ${ledgerState.fetchedNow ? 'fetched' : 'shared'}, ${symbols.length} holding(s))`);
      }
      setState({
        status: 'ready',
        view,
        chart: { rows: chartRows, bars, stake, draftAt: firstDraft, liveValue: summary.value },
        prices,
        requestCount: requests,
        leagueName,
      });
    })();

    return () => {
      cancelled = true;
    };
    // `tick` re-runs the price reads on Try again.
  }, [leagueId, leagueName, stakeMode, notional, numRounds, budgetAmount, userId, sessionLoading, leaguesLoading, ledgerState.status, ledgerState.ledger, ledgerState.fetchedNow, tick]);

  return { ...state, refresh };
}
