import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';
import WeekNavigator from '@/components/WeekNavigator';
import StatusBadge from '@/components/StatusBadge';
import LeagueSwitcher from '@/components/LeagueSwitcher';
import { getWeekStatus, isWeekActive as checkWeekActive } from '@/lib/weekStatus';

interface Matchup {
  id: string;
  league_id: string;
  week_number: number;
  team1_user_id: string;
  team2_user_id: string;
  team1_gain: number | null;
  team2_gain: number | null;
  winner_user_id: string | null;
}

interface Pick {
  id: string;
  symbol: string;
  entry_price: number;
  quantity: number;
  user_id: string;
}

interface Trade {
  id: string;
  symbol: string;
  price: number;
  quantity: number;
  action: 'buy' | 'sell';
  user_id: string;
}

interface HoldingBase {
  symbol: string;
  quantity: number;
  totalCost: number;
}

interface Holding {
  symbol: string;
  quantity: number;
  avgEntry: number;
  currentPrice: number;
  gain: number;
  gainPercent: number;
}

interface UserProfile {
  id: string;
  username?: string;
  avatar?: string;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MatchupScreen() {
  const { user } = useAuth();
  const { activeLeagueId, activeLeague } = useLeagueContext();
  const params = useLocalSearchParams<{
    week?: string;
    matchupId?: string;
    team1?: string;
    team2?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [matchup, setMatchup] = useState<Matchup | null>(null);
  const [team1Holdings, setTeam1Holdings] = useState<HoldingBase[]>([]);
  const [team2Holdings, setTeam2Holdings] = useState<HoldingBase[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [weekSnapshots, setWeekSnapshots] = useState<Record<string, { quantity: number; weekStartPrice: number }>>({});
  const [hasSnapshots, setHasSnapshots] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [playoffRounds, setPlayoffRounds] = useState<Record<number, string>>({});
  const [lastMatchupWeek, setLastMatchupWeek] = useState(0);
  const [error, setError] = useState('');

  const viewingSpecificMatchup = !!(params.matchupId || (params.team1 && params.team2));

  const isMatchupLeague = activeLeague?.league_type === 'matchup';
  const currentWeek = activeLeague?.current_week || 1;

  const initialWeek = params.week ? parseInt(params.week, 10) : currentWeek;
  const [selectedWeek, setSelectedWeek] = useState(initialWeek);

  useEffect(() => {
    if (currentWeek > 0 && !viewingSpecificMatchup) {
      const effectiveWeek = (activeLeague?.season_status === 'completed' && lastMatchupWeek > 0)
        ? Math.min(currentWeek, lastMatchupWeek)
        : currentWeek;
      setSelectedWeek(effectiveWeek);
    }
  }, [currentWeek, viewingSpecificMatchup, lastMatchupWeek]);

  useEffect(() => {
    if (params.week) {
      setSelectedWeek(parseInt(params.week, 10));
    }
  }, [params.week]);

  const weekStatus = useMemo(() => {
    return getWeekStatus(activeLeague, matchup);
  }, [activeLeague, matchup]);

  const isActiveWeek = useMemo(() => {
    return matchup ? checkWeekActive(matchup) : false;
  }, [matchup]);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (!isActiveWeek || selectedWeek !== currentWeek) return;

    pollingRef.current = setInterval(() => {
      fetchCurrentPrices();
    }, 5 * 60 * 1000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [isActiveWeek, selectedWeek, currentWeek]);

  useEffect(() => {
    if (activeLeagueId && user && isMatchupLeague) {
      fetchMatchupData();
    } else {
      setLoading(false);
    }
  }, [activeLeagueId, user, isMatchupLeague, selectedWeek, params.matchupId, params.team1, params.team2]);

  useEffect(() => {
    if (!matchup || team1Holdings.length === 0 && team2Holdings.length === 0) return;

    const isCompletedWeek = matchup.team1_gain != null || matchup.team2_gain != null;
    if (isCompletedWeek) return;

    const interval = setInterval(() => {
      fetchCurrentPrices();
    }, 30000);

    return () => clearInterval(interval);
  }, [matchup, team1Holdings, team2Holdings]);

  async function fetchMatchupData() {
    if (!activeLeagueId || !user) return;

    setLoading(true);
    setError('');

    try {
      // Fetch playoff round mapping for WeekNavigator labels
      const { data: playoffMatchups } = await supabase
        .from('matchups')
        .select('week_number, playoff_round')
        .eq('league_id', activeLeagueId)
        .eq('is_playoff', true);

      if (playoffMatchups && playoffMatchups.length > 0) {
        const rounds: Record<number, string> = {};
        playoffMatchups.forEach(m => {
          if (m.playoff_round) rounds[m.week_number] = m.playoff_round;
        });
        setPlayoffRounds(rounds);
        setLastMatchupWeek(Math.max(...playoffMatchups.map(m => m.week_number)));
      } else {
        setLastMatchupWeek(activeLeague?.num_weeks || currentWeek);
      }

      let matchupData: Matchup | null = null;

      if (params.matchupId) {
        const { data, error: matchupError } = await supabase
          .from('matchups')
          .select('*')
          .eq('id', params.matchupId)
          .single();

        if (matchupError) {
          if (matchupError.code === 'PGRST116') {
            setMatchup(null);
            setLoading(false);
            return;
          }
          throw matchupError;
        }
        matchupData = data;
      } else if (params.team1 && params.team2) {
        const { data, error: matchupError } = await supabase
          .from('matchups')
          .select('*')
          .eq('league_id', activeLeagueId)
          .eq('week_number', selectedWeek)
          .eq('team1_user_id', params.team1)
          .eq('team2_user_id', params.team2)
          .single();

        if (matchupError) {
          if (matchupError.code === 'PGRST116') {
            setMatchup(null);
            setLoading(false);
            return;
          }
          throw matchupError;
        }
        matchupData = data;
      } else {
        const { data, error: matchupError } = await supabase
          .from('matchups')
          .select('*')
          .eq('league_id', activeLeagueId)
          .eq('week_number', selectedWeek)
          .or(`team1_user_id.eq.${user.id},team2_user_id.eq.${user.id}`)
          .single();

        if (matchupError) {
          if (matchupError.code === 'PGRST116') {
            setMatchup(null);
            setLoading(false);
            return;
          }
          throw matchupError;
        }
        matchupData = data;
      }

      setMatchup(matchupData);

      if (!matchupData) {
        setLoading(false);
        return;
      }

      const userIds = [matchupData.team1_user_id, matchupData.team2_user_id]
        .filter(id => id && !id.startsWith('bot-'));

      if (userIds.length > 0) {
        const { data: profileData } = await supabase
          .from('user_profiles')
          .select('id, username, avatar')
          .in('id', userIds);

        if (profileData) {
          const profileMap: Record<string, UserProfile> = {};
          profileData.forEach(p => {
            profileMap[p.id] = p;
          });
          setProfiles(profileMap);
        }
      }

      const allUserIds = [matchupData.team1_user_id, matchupData.team2_user_id].filter(Boolean);
      const { data: snapshots } = await supabase
        .from('week_snapshots')
        .select('user_id, symbol, quantity, week_start_price, week_end_price')
        .eq('league_id', activeLeagueId)
        .eq('week_number', selectedWeek)
        .in('user_id', allUserIds);

      const snapshotMap: Record<string, { quantity: number; weekStartPrice: number }> = {};
      let isPastWeek = false;

      if (snapshots && snapshots.length > 0) {
        isPastWeek = snapshots.some(s => s.week_end_price != null);

        for (const s of snapshots) {
          const key = `${s.user_id}-${s.symbol}`;
          snapshotMap[key] = {
            quantity: Number(s.quantity),
            weekStartPrice: Number(s.week_start_price),
          };
        }
        setWeekSnapshots(snapshotMap);
        setHasSnapshots(true);
      } else {
        setWeekSnapshots({});
        setHasSnapshots(false);
      }

      let team1: HoldingBase[] = [];
      let team2: HoldingBase[] = [];

      if (isPastWeek && snapshots && snapshots.length > 0) {
        const team1Snapshots = snapshots.filter(s => s.user_id === matchupData.team1_user_id);
        const team2Snapshots = snapshots.filter(s => s.user_id === matchupData.team2_user_id);

        team1 = team1Snapshots.map(s => ({
          symbol: s.symbol,
          quantity: Number(s.quantity),
          totalCost: Number(s.quantity) * Number(s.week_start_price),
        }));

        team2 = team2Snapshots.map(s => ({
          symbol: s.symbol,
          quantity: Number(s.quantity),
          totalCost: Number(s.quantity) * Number(s.week_start_price),
        }));
      } else {
        [team1, team2] = await Promise.all([
          fetchTeamHoldings(matchupData.team1_user_id),
          fetchTeamHoldings(matchupData.team2_user_id),
        ]);
      }

      setTeam1Holdings(team1);
      setTeam2Holdings(team2);

      if (isPastWeek && snapshots && snapshots.length > 0) {
        const snapshotPrices: Record<string, number> = {};
        for (const s of snapshots) {
          if (s.week_end_price != null) {
            snapshotPrices[s.symbol] = Number(s.week_end_price);
          }
        }
        setPrices(snapshotPrices);
      } else {
        const allSymbols = [...team1.map(h => h.symbol), ...team2.map(h => h.symbol)];
        const uniqueSymbols = [...new Set(allSymbols)];

        if (uniqueSymbols.length > 0) {
          const { data: quoteData } = await supabase.functions.invoke('quote', {
            body: { symbols: uniqueSymbols }
          });
          if (quoteData?.prices) {
            setPrices(quoteData.prices);
          }
        }
      }

    } catch (err: any) {
      console.error('Error fetching matchup:', err);
      setError(err.message || 'Failed to load matchup');
    } finally {
      setLoading(false);
    }
  }

  async function fetchTeamHoldings(userId: string): Promise<HoldingBase[]> {
    if (!activeLeagueId) return [];

    const { data: picks } = await supabase
      .from('drafts')
      .select('id, symbol, entry_price, quantity, user_id')
      .eq('league_id', activeLeagueId)
      .eq('user_id', userId);

    const { data: trades } = await supabase
      .from('trades')
      .select('id, symbol, price, quantity, action, user_id')
      .eq('league_id', activeLeagueId)
      .eq('user_id', userId);

    const holdingsMap: Record<string, HoldingBase> = {};

    (picks || []).forEach((pick: Pick) => {
      const sym = pick.symbol?.toUpperCase();
      if (!sym) return;

      if (!holdingsMap[sym]) {
        holdingsMap[sym] = { symbol: sym, quantity: 0, totalCost: 0 };
      }

      const qty = Number(pick.quantity || 1);
      const price = Number(pick.entry_price);
      holdingsMap[sym].quantity += qty;
      holdingsMap[sym].totalCost += price * qty;
    });

    (trades || []).forEach((trade: Trade) => {
      const sym = trade.symbol?.toUpperCase();
      if (!sym) return;

      if (!holdingsMap[sym]) {
        holdingsMap[sym] = { symbol: sym, quantity: 0, totalCost: 0 };
      }

      const qty = Number(trade.quantity);
      const price = Number(trade.price);

      if (trade.action === 'buy') {
        holdingsMap[sym].quantity += qty;
        holdingsMap[sym].totalCost += price * qty;
      } else if (trade.action === 'sell') {
        const avgEntry = holdingsMap[sym].quantity > 0
          ? holdingsMap[sym].totalCost / holdingsMap[sym].quantity
          : price;
        holdingsMap[sym].quantity -= qty;
        holdingsMap[sym].totalCost = avgEntry * holdingsMap[sym].quantity;
      }
    });

    return Object.values(holdingsMap).filter(h => h.quantity > 0);
  }

  async function fetchCurrentPrices() {
    const allSymbols = [
      ...team1Holdings.map(h => h.symbol),
      ...team2Holdings.map(h => h.symbol),
    ];
    const uniqueSymbols = [...new Set(allSymbols)];

    if (uniqueSymbols.length === 0) return;

    try {
      const { data: quoteData } = await supabase.functions.invoke('quote', {
        body: { symbols: uniqueSymbols }
      });

      if (quoteData?.prices) {
        setPrices(quoteData.prices);
      }
    } catch (err) {
      console.error('Error fetching prices:', err);
    }
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMatchupData();
    setRefreshing(false);
  };

  const getDisplayName = (userId: string): string => {
    if (!userId) return 'TBD';
    if (userId.startsWith('bot-')) {
      return `Bot ${userId.replace('bot-', '')}`;
    }
    const profile = profiles[userId];
    if (profile?.username) return profile.username;
    return userId.substring(0, 8) + '...';
  };

  const getAvatar = (userId: string): string => {
    if (!userId) return '❓';
    if (userId.startsWith('bot-')) return '🤖';
    return profiles[userId]?.avatar || '📊';
  };

  const team1WithGains = useMemo(() => {
    const userId = matchup?.team1_user_id;
    return team1Holdings.map(h => {
      const currentPrice = prices[h.symbol] || h.totalCost / h.quantity;
      const snapshotKey = `${userId}-${h.symbol}`;
      const snapshot = weekSnapshots[snapshotKey];

      let gain: number;
      let gainPercent: number;

      if (hasSnapshots && snapshot) {
        gain = (currentPrice - snapshot.weekStartPrice) * snapshot.quantity;
        gainPercent = snapshot.weekStartPrice > 0
          ? ((currentPrice - snapshot.weekStartPrice) / snapshot.weekStartPrice) * 100
          : 0;
      } else {
        gain = hasSnapshots ? 0 : (currentPrice * h.quantity) - h.totalCost;
        gainPercent = hasSnapshots ? 0 : (h.totalCost > 0 ? (gain / h.totalCost) * 100 : 0);
      }

      const avgEntry = h.quantity > 0 ? h.totalCost / h.quantity : 0;
      return { ...h, currentPrice, avgEntry, gain, gainPercent };
    }).sort((a, b) => b.gain - a.gain);
  }, [team1Holdings, prices, weekSnapshots, hasSnapshots, matchup]);

  const team2WithGains = useMemo(() => {
    const userId = matchup?.team2_user_id;
    return team2Holdings.map(h => {
      const currentPrice = prices[h.symbol] || h.totalCost / h.quantity;
      const snapshotKey = `${userId}-${h.symbol}`;
      const snapshot = weekSnapshots[snapshotKey];

      let gain: number;
      let gainPercent: number;

      if (hasSnapshots && snapshot) {
        gain = (currentPrice - snapshot.weekStartPrice) * snapshot.quantity;
        gainPercent = snapshot.weekStartPrice > 0
          ? ((currentPrice - snapshot.weekStartPrice) / snapshot.weekStartPrice) * 100
          : 0;
      } else {
        gain = hasSnapshots ? 0 : (currentPrice * h.quantity) - h.totalCost;
        gainPercent = hasSnapshots ? 0 : (h.totalCost > 0 ? (gain / h.totalCost) * 100 : 0);
      }

      const avgEntry = h.quantity > 0 ? h.totalCost / h.quantity : 0;
      return { ...h, currentPrice, avgEntry, gain, gainPercent };
    }).sort((a, b) => b.gain - a.gain);
  }, [team2Holdings, prices, weekSnapshots, hasSnapshots, matchup]);

  const team1Total = useMemo(() => team1WithGains.reduce((sum, h) => sum + h.gain, 0), [team1WithGains]);
  const team2Total = useMemo(() => team2WithGains.reduce((sum, h) => sum + h.gain, 0), [team2WithGains]);

  const isTeam1Winning = team1Total > team2Total;
  const isTeam2Winning = team2Total > team1Total;
  const isTied = team1Total === team2Total;

  if (!isMatchupLeague) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <LeagueSwitcher />
        <View style={styles.centeredFlex}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={styles.emptyTitle}>Duration League</Text>
          <Text style={styles.emptySubtitle}>
            This league doesn't have weekly matchups.{'\n'}Check the Leaderboard for standings.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0891B2" />
          <Text style={styles.loadingText}>Loading matchup...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!matchup) {
    const isSeasonDone = activeLeague?.season_status === 'completed';
    const isPlayoffs = activeLeague?.season_status === 'playoffs';
    const numWeeks = activeLeague?.num_weeks || 0;
    const isEliminated = isPlayoffs && selectedWeek > numWeeks;
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <LeagueSwitcher />
        <View style={styles.weekNavContainerTop}>
          <WeekNavigator
            currentWeek={currentWeek}
            selectedWeek={selectedWeek}
            totalWeeks={activeLeague?.num_weeks}
            maxWeek={lastMatchupWeek > 0 ? lastMatchupWeek : undefined}
            onWeekChange={setSelectedWeek}
            phase={weekStatus.phase}
            playoffRoundForWeek={(week) => playoffRounds[week] || null}
          />
        </View>
        <View style={styles.centeredFlex}>
          <Text style={styles.emptyIcon}>{isSeasonDone ? '🏁' : isEliminated ? '🏁' : '📈'}</Text>
          <Text style={styles.emptyTitle}>
            {isSeasonDone ? 'Season Complete' : 'No Matchup This Week'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {isSeasonDone
              ? 'The season has ended. Check the League tab for final standings.'
              : isEliminated
              ? "You've been eliminated from playoff contention. Check the League tab to follow the remaining matchups."
              : `You don't have a matchup scheduled for Week ${selectedWeek}.`
            }
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isUserTeam1 = matchup.team1_user_id === user?.id;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LeagueSwitcher />

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0891B2" />
        }
      >
        {/* Scoreboard */}
        <View style={styles.scoreboard}>
          {/* Team 1 */}
          <View style={[styles.scoreTeam, isTeam1Winning && styles.scoreTeamWinning]}>
            <Text style={styles.scoreAvatar}>{getAvatar(matchup.team1_user_id)}</Text>
            <Text style={styles.scoreName} numberOfLines={1}>
              {getDisplayName(matchup.team1_user_id)}
              {matchup.team1_user_id === user?.id && ' (You)'}
            </Text>
            <Text style={[
              styles.scoreValue,
              team1Total >= 0 ? styles.positive : styles.negative
            ]}>
              {team1Total >= 0 ? '+' : ''}${formatCurrency(team1Total)}
            </Text>
            {isTeam1Winning && <Text style={styles.winningBadge}>Leading</Text>}
          </View>

          {/* VS */}
          <View style={styles.scoreVs}>
            <Text style={styles.scoreVsText}>VS</Text>
          </View>

          {/* Team 2 */}
          <View style={[styles.scoreTeam, isTeam2Winning && styles.scoreTeamWinning]}>
            <Text style={styles.scoreAvatar}>{getAvatar(matchup.team2_user_id)}</Text>
            <Text style={styles.scoreName} numberOfLines={1}>
              {getDisplayName(matchup.team2_user_id)}
              {matchup.team2_user_id === user?.id && ' (You)'}
            </Text>
            <Text style={[
              styles.scoreValue,
              team2Total >= 0 ? styles.positive : styles.negative
            ]}>
              {team2Total >= 0 ? '+' : ''}${formatCurrency(team2Total)}
            </Text>
            {isTeam2Winning && <Text style={styles.winningBadge}>Leading</Text>}
          </View>
        </View>

        {/* Week Navigator */}
        <View style={styles.weekNavContainer}>
          <WeekNavigator
            currentWeek={currentWeek}
            selectedWeek={selectedWeek}
            totalWeeks={activeLeague?.num_weeks}
            maxWeek={lastMatchupWeek > 0 ? lastMatchupWeek : undefined}
            onWeekChange={setSelectedWeek}
            phase={weekStatus.phase}
            playoffRoundForWeek={(week) => playoffRounds[week] || null}
          />
        </View>

        {/* Side-by-side Lineups */}
        <View style={styles.lineupsContainer}>
          {/* Headers */}
          <View style={styles.lineupHeaders}>
            <View style={[styles.lineupHeaderBox, isTeam1Winning && styles.lineupHeaderWinning]}>
              <Text style={styles.lineupHeaderText}>
                {isUserTeam1 ? 'You' : getDisplayName(matchup.team1_user_id)}
              </Text>
            </View>
            <View style={styles.lineupHeaderDivider} />
            <View style={[styles.lineupHeaderBox, isTeam2Winning && styles.lineupHeaderWinning]}>
              <Text style={styles.lineupHeaderText}>
                {!isUserTeam1 ? 'You' : getDisplayName(matchup.team2_user_id)}
              </Text>
            </View>
          </View>

          {/* Stock rows */}
          {Array.from({ length: Math.max(team1WithGains.length, team2WithGains.length, 1) }).map((_, idx) => {
            const h1 = team1WithGains[idx];
            const h2 = team2WithGains[idx];

            return (
              <View key={idx} style={styles.comparisonRow}>
                <View style={styles.stockCell}>
                  {h1 ? (
                    <>
                      <Text style={styles.stockSymbol}>{h1.symbol}</Text>
                      <Text style={[
                        styles.stockGain,
                        h1.gain >= 0 ? styles.positive : styles.negative
                      ]}>
                        {h1.gain >= 0 ? '+' : ''}${formatCurrency(h1.gain)}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.emptySlot}>—</Text>
                  )}
                </View>

                <View style={styles.slotDivider}>
                  <Text style={styles.slotNumber}>{idx + 1}</Text>
                </View>

                <View style={styles.stockCell}>
                  {h2 ? (
                    <>
                      <Text style={styles.stockSymbol}>{h2.symbol}</Text>
                      <Text style={[
                        styles.stockGain,
                        h2.gain >= 0 ? styles.positive : styles.negative
                      ]}>
                        {h2.gain >= 0 ? '+' : ''}${formatCurrency(h2.gain)}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.emptySlot}>—</Text>
                  )}
                </View>
              </View>
            );
          })}

          {/* Totals row */}
          <View style={styles.totalsRow}>
            <View style={styles.totalCell}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={[
                styles.totalValue,
                team1Total >= 0 ? styles.positive : styles.negative
              ]}>
                {team1Total >= 0 ? '+' : ''}${formatCurrency(team1Total)}
              </Text>
            </View>
            <View style={styles.totalDivider} />
            <View style={styles.totalCell}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={[
                styles.totalValue,
                team2Total >= 0 ? styles.positive : styles.negative
              ]}>
                {team2Total >= 0 ? '+' : ''}${formatCurrency(team2Total)}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 14,
    marginTop: 12,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
  },
  weekNavContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  weekNavContainerTop: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  centeredFlex: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  // Scoreboard
  scoreboard: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginTop: 16,
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  scoreTeam: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 12,
  },
  scoreTeamWinning: {
    backgroundColor: '#ECFDF5',
  },
  scoreAvatar: {
    fontSize: 40,
    marginBottom: 8,
  },
  scoreName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  scoreValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  winningBadge: {
    marginTop: 8,
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  scoreVs: {
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  scoreVsText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#94A3B8',
  },
  // Side-by-side Lineups
  lineupsContainer: {
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  lineupHeaders: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  lineupHeaderBox: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  lineupHeaderWinning: {
    backgroundColor: '#ECFDF5',
  },
  lineupHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  lineupHeaderDivider: {
    width: 40,
    backgroundColor: '#F8FAFC',
  },
  comparisonRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  stockCell: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  stockSymbol: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  stockGain: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  emptySlot: {
    fontSize: 16,
    color: '#94A3B8',
  },
  slotDivider: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  slotNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
  },
  totalsRow: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
  },
  totalCell: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 1,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
  },
  totalDivider: {
    width: 40,
    backgroundColor: '#F8FAFC',
  },
  positive: {
    color: '#059669',
  },
  negative: {
    color: '#DC2626',
  },
});
