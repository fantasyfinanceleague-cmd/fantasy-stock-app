import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from './supabase';
import { useAuth } from './useAuth';
import { useLeagueContext, League } from './LeagueContext';
import { useStockPrices } from './useStockPrices';
import { DraftPick, Trade } from './usePortfolio';
import { summarizeHoldings, HoldingsSummary } from './plCoverage';
import { getSeasonPhase, isPreSeasonPhase, getUpcomingMatchupLabel, SeasonPhase } from './weekStatus';
import { isUuid } from './uuid';

// --- Types ---

interface BaseHolding {
  symbol: string;
  quantity: number;
  totalCost: number;
}

export interface LeagueRow {
  league: League;
  seasonNumber: number;
  record: { wins: number; losses: number; ties: number } | null;
  rank: number;
  totalPlayers: number;
  portfolioValue: number;
  totalGain: number | null;
}

export interface MatchupCard {
  id: string;
  leagueName: string;
  leagueEmoji: string;
  weekNumber: number;
  leagueId: string;
  myUsername: string;
  opponentUsername: string;
  myValue: number;
  opponentValue: number;
  myGain: number;
  opponentGain: number;
  seasonPhase: SeasonPhase;
  /** "Week 1 starts Tue, Sep 29" when seasonPhase is 'pre_season' — the
   * league has a real schedule (drafted) but the week hasn't started, so
   * myGain/opponentGain are not real scores yet (see the card's own
   * rendering in app/(tabs)/index.tsx for why those get hidden). null for
   * every other phase, where the ordinary Week-N value/gain display applies. */
  upcomingLabel: string | null;
}

export interface HomeData {
  totalValue: number;
  totalCost: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  /** Whole-portfolio summary the totals above come from (unpriced at cost). */
  portfolio: HoldingsSummary;
  leagueCount: number;
  hasLivePrices: boolean;
  leagueRows: LeagueRow[];
  matchups: MatchupCard[];
  winCount: number;
  loseCount: number;
  // Aggregate drafts/trades for historical chart
  allDrafts: DraftPick[];
  allTrades: Trade[];
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

// --- Helpers ---

function getLeagueEmoji(league: League): string {
  return league.league_type === 'matchup' ? '🤑' : '📈';
}

function computeHoldings(
  drafts: { symbol: string; entry_price: number; quantity: number }[],
  trades: { symbol: string; action: string; quantity: number; price: number }[],
): BaseHolding[] {
  const map = new Map<string, { quantity: number; totalCost: number }>();

  for (const d of drafts) {
    const existing = map.get(d.symbol) || { quantity: 0, totalCost: 0 };
    existing.quantity += d.quantity;
    existing.totalCost += d.entry_price * d.quantity;
    map.set(d.symbol, existing);
  }

  for (const t of trades) {
    const existing = map.get(t.symbol) || { quantity: 0, totalCost: 0 };
    if (t.action === 'buy') {
      existing.quantity += t.quantity;
      existing.totalCost += t.price * t.quantity;
    } else {
      existing.quantity -= t.quantity;
      if (existing.quantity > 0) {
        const avgCost = existing.totalCost / (existing.quantity + t.quantity);
        existing.totalCost = avgCost * existing.quantity;
      } else {
        existing.totalCost = 0;
      }
    }
    map.set(t.symbol, existing);
  }

  const result: BaseHolding[] = [];
  map.forEach((value, symbol) => {
    if (value.quantity > 0) {
      result.push({ symbol, quantity: value.quantity, totalCost: value.totalCost });
    }
  });
  return result;
}

// --- Hook ---

export function useHomeData(): HomeData {
  const { user } = useAuth();
  const { leagues, loading: leaguesLoading, refresh: refreshLeagues } = useLeagueContext();

  const [holdingsByLeague, setHoldingsByLeague] = useState<Record<string, BaseHolding[]>>({});
  const [standings, setStandings] = useState<Record<string, { rank: number; totalPlayers: number; wins: number; losses: number; ties: number; pointsFor: number }>>({});
  const [seasonNumbers, setSeasonNumbers] = useState<Record<string, number>>({});
  const [matchupData, setMatchupData] = useState<MatchupCard[]>([]);
  const [allDrafts, setAllDrafts] = useState<DraftPick[]>([]);
  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [username, setUsername] = useState<string>('You');
  const [dataLoading, setDataLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Collect all unique symbols across all leagues for price fetching
  const allSymbols = useMemo(() => {
    const symbolSet = new Set<string>();
    Object.values(holdingsByLeague).forEach(holdings => {
      holdings.forEach(h => symbolSet.add(h.symbol));
    });
    return Array.from(symbolSet);
  }, [holdingsByLeague]);

  const { prices, loading: pricesLoading, refresh: refreshPrices } = useStockPrices(allSymbols);

  // Compute per-league portfolio values using live prices. An unpriced holding
  // (quote missing or not loaded yet) counts at cost, not $0 — see
  // lib/plCoverage.ts.
  const priceOf = useCallback((symbol: string) => prices[symbol]?.price ?? null, [prices]);
  const leaguePortfolioValues = useMemo(() => {
    const values: Record<string, HoldingsSummary> = {};
    for (const [leagueId, holdings] of Object.entries(holdingsByLeague)) {
      values[leagueId] = summarizeHoldings(holdings, priceOf);
    }
    return values;
  }, [holdingsByLeague, priceOf]);

  // Build league rows
  const leagueRows: LeagueRow[] = useMemo(() => {
    return leagues.map(league => {
      const standing = standings[league.id];
      const pv = leaguePortfolioValues[league.id];
      const isMatchup = league.league_type === 'matchup';

      return {
        league,
        seasonNumber: seasonNumbers[league.id] ?? 1,
        record: isMatchup && standing
          ? { wins: standing.wins, losses: standing.losses, ties: standing.ties }
          : null,
        rank: standing?.rank ?? 0,
        totalPlayers: standing?.totalPlayers ?? 0,
        portfolioValue: pv?.value ?? 0,
        totalGain: !isMatchup && standing ? standing.pointsFor : null,
      };
    });
  }, [leagues, standings, seasonNumbers, leaguePortfolioValues]);

  // Aggregate portfolio — one summary over every league's holdings, so value,
  // gain and percent always share one scope and unpricedCount says what was
  // assumed.
  const portfolio = useMemo(
    () => summarizeHoldings(Object.values(holdingsByLeague).flat(), priceOf),
    [holdingsByLeague, priceOf],
  );
  const hasLivePrices = allSymbols.length > 0 && Object.keys(prices).length > 0;

  // Matchup win/lose counts
  // Pre-season cards have no real score yet (see MatchupCard.upcomingLabel),
  // so they're excluded here rather than counted as a "win" whenever
  // myValue happens to be above the opponentValue placeholder of 0.
  const winCount = useMemo(
    () => matchupData.filter(m => !isPreSeasonPhase(m.seasonPhase) && m.myValue > m.opponentValue).length,
    [matchupData],
  );
  const loseCount = useMemo(
    () => matchupData.filter(m => !isPreSeasonPhase(m.seasonPhase) && m.myValue < m.opponentValue).length,
    [matchupData],
  );

  // --- Data fetching ---
  const fetchAllData = useCallback(async () => {
    if (!user?.id || leagues.length === 0) {
      setHoldingsByLeague({});
      setStandings({});
      setSeasonNumbers({});
      setMatchupData([]);
      setDataLoading(false);
      return;
    }

    setDataLoading(true);

    try {
      // Fetch username
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('username')
        .eq('id', user.id)
        .single();
      if (profile?.username) setUsername(profile.username);

      // Parallel fetches per league + cross-league matchups
      const holdingsResults: Record<string, BaseHolding[]> = {};
      const standingsResults: Record<string, { rank: number; totalPlayers: number; wins: number; losses: number; ties: number; pointsFor: number }> = {};
      const seasonResults: Record<string, number> = {};
      const aggregatedDrafts: DraftPick[] = [];
      const aggregatedTrades: Trade[] = [];

      // Fetch all league data in parallel
      await Promise.all(leagues.map(async (league) => {
        // 1. Portfolio holdings (drafts + trades) — fetch full records for chart
        const [{ data: drafts }, { data: trades }] = await Promise.all([
          supabase
            .from('drafts')
            .select('*')
            .eq('user_id', user.id)
            .eq('league_id', league.id)
            .order('created_at', { ascending: true }),
          supabase
            .from('trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('league_id', league.id)
            .order('created_at', { ascending: true }),
        ]);

        if (drafts) aggregatedDrafts.push(...drafts);
        if (trades) aggregatedTrades.push(...trades);
        holdingsResults[league.id] = computeHoldings(drafts || [], trades || []);

        // 2. Season info
        if (league.current_season_id) {
          const { data: season } = await supabase
            .from('league_seasons')
            .select('season_number')
            .eq('id', league.current_season_id)
            .single();
          seasonResults[league.id] = season?.season_number ?? 1;
        } else {
          seasonResults[league.id] = 1;
        }

        // 3. Standings
        if (league.league_type === 'matchup') {
          const { data: standingsData } = await supabase
            .from('league_standings')
            .select('user_id, wins, losses, ties')
            .eq('league_id', league.id)
            .order('wins', { ascending: false });

          if (standingsData) {
            const userStanding = standingsData.find(s => s.user_id === user.id);
            const userRank = standingsData.findIndex(s => s.user_id === user.id) + 1;
            standingsResults[league.id] = {
              rank: userRank || standingsData.length,
              totalPlayers: standingsData.length,
              wins: userStanding?.wins ?? 0,
              losses: userStanding?.losses ?? 0,
              ties: userStanding?.ties ?? 0,
              pointsFor: 0,
            };
          }
        } else {
          const { data: standingsData } = await supabase
            .from('league_standings')
            .select('user_id, points_for')
            .eq('league_id', league.id)
            .order('points_for', { ascending: false });

          if (standingsData) {
            const userStanding = standingsData.find(s => s.user_id === user.id);
            const userRank = standingsData.findIndex(s => s.user_id === user.id) + 1;
            standingsResults[league.id] = {
              rank: userRank || standingsData.length,
              totalPlayers: standingsData.length,
              wins: 0,
              losses: 0,
              ties: 0,
              pointsFor: Number(userStanding?.points_for) || 0,
            };
          }
        }
      }));

      setHoldingsByLeague(holdingsResults);
      setStandings(standingsResults);
      setSeasonNumbers(seasonResults);
      setAllDrafts(aggregatedDrafts);
      setAllTrades(aggregatedTrades);

      // 4. Cross-league matchups (matchup-type leagues only)
      const matchupLeagues = leagues.filter(l => l.league_type === 'matchup');
      const matchupCards: MatchupCard[] = [];

      if (matchupLeagues.length > 0) {
        // Fetch current-week matchups for all matchup leagues
        const matchupPromises = matchupLeagues.map(async (league) => {
          const { data: matchups } = await supabase
            .from('matchups')
            .select('id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain')
            .eq('league_id', league.id)
            .eq('week_number', league.current_week)
            .or(`team1_user_id.eq.${user.id},team2_user_id.eq.${user.id}`);

          return { league, matchups: matchups || [] };
        });

        const matchupResults = await Promise.all(matchupPromises);

        // Collect opponent IDs for batch username fetch
        const opponentIds = new Set<string>();
        for (const { matchups } of matchupResults) {
          for (const m of matchups) {
            const opponentId = m.team1_user_id === user.id ? m.team2_user_id : m.team1_user_id;
            if (opponentId) opponentIds.add(opponentId);
          }
        }

        // Batch fetch opponent usernames. isUuid, not left unfiltered — a
        // bot or synthetic test-participant id (neither a real UUID) would
        // otherwise 22P02 the whole .in() query, failing username lookup for
        // every OTHER real opponent in this batch too. See lib/uuid.ts. This
        // does not add a "Bot N" synthesized name for bot opponents (unlike
        // league.tsx/matchup.tsx's getDisplayName) — a bot has no
        // user_profiles row to fetch regardless, so it still falls back to
        // the generic 'Opponent' label below; that gap is separate from this
        // fix.
        const opponentNames: Record<string, string> = {};
        const opponentIdsToFetch = Array.from(opponentIds).filter(isUuid);
        if (opponentIdsToFetch.length > 0) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, username')
            .in('id', opponentIdsToFetch);
          if (profiles) {
            for (const p of profiles) {
              opponentNames[p.id] = p.username;
            }
          }
        }

        // Build matchup cards
        for (const { league, matchups } of matchupResults) {
          // Draft-pending/drafting leagues have no matchups rows at all yet
          // (finalize_league_draft is what creates the schedule), so this
          // never fires in practice today — kept as a defensive guard rather
          // than assuming that pipeline detail can't change.
          const seasonPhase = getSeasonPhase(league);
          if (seasonPhase === 'pre_draft' || seasonPhase === 'drafting') continue;

          for (const m of matchups) {
            const isTeam1 = m.team1_user_id === user.id;
            const opponentId = isTeam1 ? m.team2_user_id : m.team1_user_id;

            // Get portfolio values for this matchup from league holdings
            const myHoldings = holdingsResults[league.id] || [];
            let myValue = 0;
            let myCost = 0;
            for (const h of myHoldings) {
              const priceData = prices[h.symbol.toUpperCase()];
              myValue += (priceData?.price ?? 0) * h.quantity;
              myCost += h.totalCost;
            }

            // Use gain from matchup data if available, otherwise compute from portfolio
            const myGain = m.team1_gain !== null
              ? (isTeam1 ? m.team1_gain : (m.team2_gain ?? 0))
              : myValue - myCost;
            const opponentGain = m.team1_gain !== null
              ? (isTeam1 ? (m.team2_gain ?? 0) : m.team1_gain)
              : 0;

            matchupCards.push({
              id: m.id,
              leagueName: league.name,
              leagueEmoji: getLeagueEmoji(league),
              weekNumber: m.week_number,
              leagueId: league.id,
              myUsername: profile?.username || 'You',
              opponentUsername: opponentId ? (opponentNames[opponentId] || 'Opponent') : 'BYE',
              myValue,
              opponentValue: 0, // Opponent portfolio not accessible client-side
              myGain,
              opponentGain,
              seasonPhase,
              upcomingLabel: seasonPhase === 'pre_season' ? getUpcomingMatchupLabel(league) : null,
            });
          }
        }
      }

      setMatchupData(matchupCards);
    } catch (err) {
      console.error('useHomeData fetch error:', err);
    } finally {
      setDataLoading(false);
    }
  }, [user?.id, leagues]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await refreshLeagues();
    await fetchAllData();
    await refreshPrices();
    setRefreshing(false);
  }, [refreshLeagues, fetchAllData, refreshPrices]);

  return {
    totalValue: portfolio.value,
    totalCost: portfolio.cost,
    totalGainLoss: portfolio.gainLoss,
    totalGainLossPercent: portfolio.gainLossPercent,
    portfolio,
    leagueCount: leagues.length,
    hasLivePrices,
    leagueRows,
    matchups: matchupData,
    winCount,
    loseCount,
    allDrafts,
    allTrades,
    loading: leaguesLoading || dataLoading || pricesLoading,
    refreshing,
    refresh,
  };
}
