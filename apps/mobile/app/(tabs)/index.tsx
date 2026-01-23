import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { usePortfolio } from '@/lib/usePortfolio';
import { router } from 'expo-router';
import { useState, useEffect } from 'react';
import { SkeletonCard } from '@/components/Skeleton';
import { PortfolioChart } from '@/components/PortfolioChart';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import LeagueCarousel from '@/components/LeagueCarousel';

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number | null): string {
  if (value === null) return '--';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

interface PastMatchup {
  id: string;
  week_number: number;
  team1_user_id: string;
  team2_user_id: string | null;
  team1_gain: number;
  team2_gain: number | null;
  winner_user_id: string | null;
}

export default function HomeScreen() {
  const { user, loading: authLoading } = useAuth();
  const { leagues, activeLeagueId, activeLeague, setActiveLeagueId, loading: leaguesLoading, refresh: refreshLeagues } = useLeagueContext();
  const { holdings, portfolioSummary, loading: portfolioLoading, pricesLoading, refresh: refreshPortfolio } = usePortfolio(activeLeagueId);
  const [refreshing, setRefreshing] = useState(false);
  const [pastMatchups, setPastMatchups] = useState<PastMatchup[]>([]);

  const loading = authLoading || leaguesLoading;
  const isMatchupLeague = activeLeague?.league_type === 'matchup';

  // Fetch past matchups for matchup leagues
  useEffect(() => {
    if (!user?.id || !activeLeagueId || !isMatchupLeague) {
      setPastMatchups([]);
      return;
    }

    (async () => {
      try {
        const { data } = await supabase
          .from('matchups')
          .select('*')
          .eq('league_id', activeLeagueId)
          .or(`team1_user_id.eq.${user.id},team2_user_id.eq.${user.id}`)
          .not('team1_gain', 'is', null)
          .order('week_number', { ascending: false })
          .limit(5);

        setPastMatchups(data || []);
      } catch (e) {
        console.error('Failed to fetch past matchups:', e);
        setPastMatchups([]);
      }
    })();
  }, [user?.id, activeLeagueId, isMatchupLeague]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshLeagues(), refreshPortfolio()]);
    setRefreshing(false);
  };

  if (authLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.authContainer}>
          <Text style={styles.title}>Fantasy Stock</Text>
          <Text style={styles.subtitle}>Sign in to get started</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push('/login')}
          >
            <Text style={styles.buttonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isPositive = portfolioSummary.totalGainLossPercent >= 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        {/* App Header */}
        <View style={styles.appHeader}>
          <Text style={styles.appName}>Stockpile</Text>
        </View>

        {/* League Carousel */}
        <View style={styles.carouselSection}>
          <LeagueCarousel />
        </View>

        {leagues.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No leagues yet</Text>
            <Text style={styles.emptySubtitle}>Join or create a league to start trading</Text>
            <TouchableOpacity
              style={styles.button}
              onPress={() => router.push('/create-league')}
            >
              <Text style={styles.buttonText}>Get Started</Text>
            </TouchableOpacity>
          </View>
        ) : !activeLeagueId ? (
          <View style={styles.createJoinPrompt}>
            <Text style={styles.promptEmoji}>🚀</Text>
            <Text style={styles.promptTitle}>Ready to compete?</Text>
            <Text style={styles.promptSubtitle}>
              Create a new league and invite your friends, or join an existing one with an invite code.
            </Text>
            <View style={styles.promptButtons}>
              <TouchableOpacity
                style={styles.promptButtonPrimary}
                onPress={() => router.push('/create-league')}
              >
                <Text style={styles.promptButtonPrimaryText}>Create League</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.promptButtonSecondary}
                onPress={() => router.push('/join-league')}
              >
                <Text style={styles.promptButtonSecondaryText}>Join League</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {/* Portfolio Value Card */}
            {portfolioLoading && !holdings.length ? (
              <SkeletonCard />
            ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Portfolio Value</Text>
                <Text style={styles.cardValue}>
                  ${formatCurrency(portfolioSummary.totalValue)}
                </Text>
                {portfolioSummary.hasLivePrices && portfolioSummary.totalCost > 0 && (
                  <View style={styles.changeRow}>
                    <Text style={[
                      styles.changeAmount,
                      isPositive ? styles.positive : styles.negative
                    ]}>
                      {isPositive ? '+' : ''}${formatCurrency(portfolioSummary.totalGainLoss)}
                    </Text>
                    <Text style={[
                      styles.changePercent,
                      isPositive ? styles.positiveBg : styles.negativeBg
                    ]}>
                      {formatPercent(portfolioSummary.totalGainLossPercent)}
                    </Text>
                  </View>
                )}
                <Text style={styles.cardSubtext}>
                  {portfolioSummary.holdingsCount} holding{portfolioSummary.holdingsCount !== 1 ? 's' : ''}
                  {pricesLoading && ' • Updating prices...'}
                </Text>
              </View>
            )}

            {/* Allocation Chart */}
            {holdings.length > 0 && !portfolioLoading && (
              <View style={styles.section}>
                <PortfolioChart
                  holdings={holdings}
                  totalValue={portfolioSummary.totalValue}
                />
              </View>
            )}

            {/* Past Results Section (for matchup leagues) */}
            {isMatchupLeague && pastMatchups.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Past Results</Text>
                  <TouchableOpacity onPress={() => router.push('/(tabs)/matchup')}>
                    <Text style={styles.viewAllText}>View Matchup</Text>
                  </TouchableOpacity>
                </View>

                {pastMatchups.map((m) => {
                  const isTeam1 = m.team1_user_id === user?.id;
                  const myGain = isTeam1 ? m.team1_gain : (m.team2_gain ?? 0);
                  const oppGain = isTeam1 ? (m.team2_gain ?? 0) : m.team1_gain;
                  const iWon = m.winner_user_id === user?.id;
                  const isTie = m.winner_user_id === null && myGain === oppGain;
                  const isByeWeek = isTeam1 ? !m.team2_user_id : !m.team1_user_id;

                  return (
                    <View
                      key={m.id}
                      style={[
                        styles.resultRow,
                        iWon ? styles.resultWin : isTie ? styles.resultTie : styles.resultLoss
                      ]}
                    >
                      <View style={styles.resultLeft}>
                        <Text style={styles.resultWeek}>Week {m.week_number}</Text>
                        <View style={[
                          styles.resultBadge,
                          iWon ? styles.badgeWin : isTie ? styles.badgeTie : styles.badgeLoss
                        ]}>
                          <Text style={[
                            styles.resultBadgeText,
                            iWon ? styles.badgeWinText : isTie ? styles.badgeTieText : styles.badgeLossText
                          ]}>
                            {isByeWeek ? 'BYE' : iWon ? 'WIN' : isTie ? 'TIE' : 'LOSS'}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.resultRight}>
                        <Text style={[styles.resultGain, myGain >= 0 ? styles.positive : styles.negative]}>
                          {myGain >= 0 ? '+' : ''}${formatCurrency(myGain)}
                        </Text>
                        {!isByeWeek && (
                          <Text style={styles.resultVs}>
                            vs {oppGain >= 0 ? '+' : ''}${formatCurrency(oppGain)}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {holdings.length === 0 && activeLeague?.draft_status === 'completed' && !portfolioLoading && (
              <View style={styles.section}>
                <Text style={styles.emptyHoldings}>No holdings yet. Start trading!</Text>
              </View>
            )}

            {activeLeague?.draft_status === 'not_started' && (
              <View style={styles.section}>
                <View style={styles.statusCard}>
                  <Text style={styles.statusTitle}>Draft Pending</Text>
                  <Text style={styles.statusText}>
                    Draft scheduled for {new Date(activeLeague.draft_date).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            )}

            {activeLeague?.draft_status === 'in_progress' && (
              <View style={styles.section}>
                <View style={[styles.statusCard, styles.statusCardActive]}>
                  <Text style={styles.statusTitle}>Draft In Progress</Text>
                  <Text style={styles.statusText}>Head to the web app to draft</Text>
                </View>
              </View>
            )}
          </>
        )}
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
  appHeader: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
    alignItems: 'center',
  },
  appName: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: -0.5,
  },
  carouselSection: {
    marginTop: 24,
    marginBottom: 8,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 100,
  },
  authContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textMuted,
    marginBottom: 32,
  },
  button: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 8,
  },
  buttonText: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.textPrimary,
  },
  leagueName: {
    fontSize: 14,
    color: Colors.primaryLight,
    marginTop: 4,
  },
  card: {
    backgroundColor: Colors.cardBg,
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: {
    fontSize: 14,
    color: Colors.textMuted,
    marginBottom: 8,
  },
  cardValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: Colors.textPrimary,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  changeAmount: {
    fontSize: 16,
    fontWeight: '600',
  },
  changePercent: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  positive: {
    color: Colors.success,
  },
  negative: {
    color: Colors.error,
  },
  positiveBg: {
    backgroundColor: Colors.successBg,
    color: Colors.success,
  },
  negativeBg: {
    backgroundColor: Colors.errorBg,
    color: Colors.error,
  },
  cardSubtext: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 8,
  },
  section: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  viewAllText: {
    fontSize: 14,
    color: Colors.primary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    marginBottom: 24,
    textAlign: 'center',
  },
  emptyHoldings: {
    color: Colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  statusCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusCardActive: {
    borderColor: Colors.primary,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  statusText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  // Past Results styles
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
  },
  resultWin: {
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  resultLoss: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  resultTie: {
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderColor: 'rgba(251, 191, 36, 0.2)',
  },
  resultLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resultWeek: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    minWidth: 50,
  },
  resultBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeWin: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  badgeLoss: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  badgeTie: {
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
  },
  resultBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badgeWinText: {
    color: Colors.success,
  },
  badgeLossText: {
    color: Colors.error,
  },
  badgeTieText: {
    color: '#fbbf24',
  },
  resultRight: {
    alignItems: 'flex-end',
  },
  resultGain: {
    fontSize: 14,
    fontWeight: '600',
  },
  resultVs: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  // Create/Join Prompt styles
  createJoinPrompt: {
    marginHorizontal: 24,
    marginTop: 16,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  promptEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  promptTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  promptSubtitle: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  promptButtons: {
    width: '100%',
    gap: 12,
  },
  promptButtonPrimary: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  promptButtonPrimaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.background,
  },
  promptButtonSecondary: {
    backgroundColor: 'transparent',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  promptButtonSecondaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primary,
  },
});
