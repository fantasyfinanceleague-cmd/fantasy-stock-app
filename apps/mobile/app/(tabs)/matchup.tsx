import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [matchup, setMatchup] = useState<Matchup | null>(null);
  const [team1Holdings, setTeam1Holdings] = useState<HoldingBase[]>([]);
  const [team2Holdings, setTeam2Holdings] = useState<HoldingBase[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [weekSnapshots, setWeekSnapshots] = useState<Record<string, { quantity: number; weekStartPrice: number }>>({});
  const [hasSnapshots, setHasSnapshots] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [error, setError] = useState('');

  const isMatchupLeague = activeLeague?.league_type === 'matchup';
  const currentWeek = activeLeague?.current_week || 1;

  useEffect(() => {
    if (activeLeagueId && user && isMatchupLeague) {
      fetchMatchupData();
    } else {
      setLoading(false);
    }
  }, [activeLeagueId, user, isMatchupLeague, currentWeek]);

  // Refresh prices every 30 seconds when matchup is active
  useEffect(() => {
    if (!matchup || team1Holdings.length === 0 && team2Holdings.length === 0) return;

    const interval = setInterval(() => {
      fetchCurrentPrices();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [matchup, team1Holdings, team2Holdings]);

  async function fetchMatchupData() {
    if (!activeLeagueId || !user) return;

    setLoading(true);
    setError('');

    try {
      // Find user's matchup for current week
      const { data: matchupData, error: matchupError } = await supabase
        .from('matchups')
        .select('*')
        .eq('league_id', activeLeagueId)
        .eq('week_number', currentWeek)
        .or(`team1_user_id.eq.${user.id},team2_user_id.eq.${user.id}`)
        .single();

      if (matchupError) {
        if (matchupError.code === 'PGRST116') {
          // No matchup found
          setMatchup(null);
          setLoading(false);
          return;
        }
        throw matchupError;
      }

      setMatchup(matchupData);

      // Fetch profiles for both users
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

      // Fetch week snapshots for both users
      const allUserIds = [matchupData.team1_user_id, matchupData.team2_user_id].filter(Boolean);
      const { data: snapshots } = await supabase
        .from('week_snapshots')
        .select('user_id, symbol, quantity, week_start_price')
        .eq('league_id', activeLeagueId)
        .eq('week_number', currentWeek)
        .in('user_id', allUserIds);

      // Build snapshot map: { `${userId}-${symbol}`: { quantity, weekStartPrice } }
      if (snapshots && snapshots.length > 0) {
        const snapshotMap: Record<string, { quantity: number; weekStartPrice: number }> = {};
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

      // Fetch holdings for both teams
      const [team1, team2] = await Promise.all([
        fetchTeamHoldings(matchupData.team1_user_id),
        fetchTeamHoldings(matchupData.team2_user_id),
      ]);

      setTeam1Holdings(team1);
      setTeam2Holdings(team2);

      // Fetch initial prices
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

    } catch (err: any) {
      console.error('Error fetching matchup:', err);
      setError(err.message || 'Failed to load matchup');
    } finally {
      setLoading(false);
    }
  }

  async function fetchTeamHoldings(userId: string): Promise<HoldingBase[]> {
    if (!activeLeagueId) return [];

    // Fetch draft picks
    const { data: picks } = await supabase
      .from('drafts')
      .select('id, symbol, entry_price, quantity, user_id')
      .eq('league_id', activeLeagueId)
      .eq('user_id', userId);

    // Fetch trades
    const { data: trades } = await supabase
      .from('trades')
      .select('id, symbol, price, quantity, action, user_id')
      .eq('league_id', activeLeagueId)
      .eq('user_id', userId);

    // Calculate holdings from picks + trades
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

    // Filter out zero holdings
    return Object.values(holdingsMap).filter(h => h.quantity > 0);
  }

  // Fetch prices for all symbols in both teams
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

  // Calculate holdings with current prices and gains using week start prices
  const team1WithGains = useMemo(() => {
    const userId = matchup?.team1_user_id;
    return team1Holdings.map(h => {
      const currentPrice = prices[h.symbol] || h.totalCost / h.quantity;
      const snapshotKey = `${userId}-${h.symbol}`;
      const snapshot = weekSnapshots[snapshotKey];

      let gain: number;
      let gainPercent: number;

      if (hasSnapshots && snapshot) {
        // Use week start price for gain calculation
        gain = (currentPrice - snapshot.weekStartPrice) * snapshot.quantity;
        gainPercent = snapshot.weekStartPrice > 0
          ? ((currentPrice - snapshot.weekStartPrice) / snapshot.weekStartPrice) * 100
          : 0;
      } else {
        // Fallback: show 0 if snapshots exist but stock not found, otherwise cumulative
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
        // Use week start price for gain calculation
        gain = (currentPrice - snapshot.weekStartPrice) * snapshot.quantity;
        gainPercent = snapshot.weekStartPrice > 0
          ? ((currentPrice - snapshot.weekStartPrice) / snapshot.weekStartPrice) * 100
          : 0;
      } else {
        // Fallback: show 0 if snapshots exist but stock not found, otherwise cumulative
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
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
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
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading matchup...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!matchup) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>🏈</Text>
          <Text style={styles.emptyTitle}>No Matchup This Week</Text>
          <Text style={styles.emptySubtitle}>
            You don't have a matchup scheduled for Week {currentWeek}.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isUserTeam1 = matchup.team1_user_id === user?.id;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Week {currentWeek} Matchup</Text>
          <Text style={styles.leagueName}>{activeLeague?.name}</Text>
        </View>

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
            {isTeam1Winning && <Text style={styles.winningBadge}>LEADING</Text>}
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
            {isTeam2Winning && <Text style={styles.winningBadge}>LEADING</Text>}
          </View>
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

          {/* Stock rows - side by side comparison */}
          {Array.from({ length: Math.max(team1WithGains.length, team2WithGains.length, 1) }).map((_, idx) => {
            const h1 = team1WithGains[idx];
            const h2 = team2WithGains[idx];

            return (
              <View key={idx} style={styles.comparisonRow}>
                {/* Team 1 Stock */}
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

                {/* Slot number */}
                <View style={styles.slotDivider}>
                  <Text style={styles.slotNumber}>{idx + 1}</Text>
                </View>

                {/* Team 2 Stock */}
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
              <Text style={styles.totalLabel}>TOTAL</Text>
              <Text style={[
                styles.totalValue,
                team1Total >= 0 ? styles.positive : styles.negative
              ]}>
                {team1Total >= 0 ? '+' : ''}${formatCurrency(team1Total)}
              </Text>
            </View>
            <View style={styles.totalDivider} />
            <View style={styles.totalCell}>
              <Text style={styles.totalLabel}>TOTAL</Text>
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
    backgroundColor: Colors.background,
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
    color: '#888',
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
    color: '#fff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  leagueName: {
    fontSize: 14,
    color: '#22c55e',
    marginTop: 4,
  },
  // Scoreboard
  scoreboard: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginBottom: 24,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  scoreTeam: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 12,
  },
  scoreTeamWinning: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  scoreAvatar: {
    fontSize: 40,
    marginBottom: 8,
  },
  scoreName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
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
    fontWeight: '800',
    color: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  scoreVs: {
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  scoreVsText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#6b7280',
  },
  // Side-by-side Lineups
  lineupsContainer: {
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  lineupHeaders: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  lineupHeaderBox: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  lineupHeaderWinning: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  lineupHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  lineupHeaderDivider: {
    width: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  comparisonRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
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
    color: '#fff',
  },
  stockQty: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  stockGain: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  emptySlot: {
    fontSize: 16,
    color: '#4b5563',
  },
  slotDivider: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  slotNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4b5563',
  },
  totalsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  totalCell: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6b7280',
    letterSpacing: 1,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
  },
  totalDivider: {
    width: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  positive: {
    color: '#22c55e',
  },
  negative: {
    color: '#ef4444',
  },
});
