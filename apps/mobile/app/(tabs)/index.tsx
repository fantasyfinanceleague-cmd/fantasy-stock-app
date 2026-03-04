import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useHomeData } from '@/lib/useHomeData';
import { router } from 'expo-router';
import { useState, useEffect } from 'react';
import { SkeletonCard } from '@/components/Skeleton';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number | null): string {
  if (value === null) return '--';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getRankSuffix(rank: number): string {
  if (rank === 1) return 'st';
  if (rank === 2) return 'nd';
  if (rank === 3) return 'rd';
  return 'th';
}

export default function HomeScreen() {
  const { user, loading: authLoading } = useAuth();
  const { leagues, setActiveLeagueId, loading: leaguesLoading } = useLeagueContext();
  const homeData = useHomeData();
  const [username, setUsername] = useState<string | null>(null);

  // Fetch username
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('username')
        .eq('id', user.id)
        .single();
      if (data?.username) setUsername(data.username);
    })();
  }, [user?.id]);

  if (authLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={styles.authContainer}>
          <Text style={styles.authTitle}>Fantasy Stock</Text>
          <Text style={styles.authSubtitle}>Sign in to get started</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.push('/login')}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Sign In</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  const isPositive = homeData.totalGainLoss >= 0;

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={homeData.refreshing}
              onRefresh={homeData.refresh}
              tintColor={Colors.primary}
            />
          }
        >
          {/* Header - Greeting + Logo */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.greeting}>{getGreeting()}</Text>
              <Text style={styles.headerUsername}>{username || 'Trader'}</Text>
            </View>
            <Image
              source={require('../../assets/images/stockpile-icon-only.png')}
              style={styles.headerLogo}
              resizeMode="contain"
            />
          </View>

          {leagues.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="trophy-outline" size={32} color={Colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>No leagues yet</Text>
              <Text style={styles.emptySubtitle}>Join or create a league to start competing with friends</Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => router.push('/create-league')}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>Get Started</Text>
              </TouchableOpacity>
            </View>
          ) : homeData.loading && homeData.leagueRows.length === 0 ? (
            <View style={styles.section}>
              <SkeletonCard />
            </View>
          ) : (
            <>
              {/* Section 2: Total Portfolio Value (Hero) */}
              <View style={styles.portfolioSection}>
                <Text style={styles.portfolioLabel}>Total Portfolio Value</Text>
                <Text style={styles.portfolioValue}>
                  ${formatCurrency(homeData.totalValue)}
                </Text>
                {homeData.hasLivePrices && homeData.totalCost > 0 && (
                  <View style={styles.changeRow}>
                    <Text style={[
                      styles.changeAmount,
                      isPositive ? styles.positive : styles.negative
                    ]}>
                      {isPositive ? '+' : ''}${formatCurrency(homeData.totalGainLoss)}
                    </Text>
                    <View style={[
                      styles.changePill,
                      isPositive ? styles.positiveBg : styles.negativeBg
                    ]}>
                      <Text style={[
                        styles.changePillText,
                        isPositive ? styles.positive : styles.negative
                      ]}>
                        {formatPercent(homeData.totalGainLossPercent)}
                      </Text>
                    </View>
                  </View>
                )}
                {homeData.leagueCount > 1 && (
                  <Text style={styles.portfolioCaption}>
                    across {homeData.leagueCount} leagues
                  </Text>
                )}
              </View>

              {/* Section 3: Your Leagues */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Your Leagues</Text>
                <View style={styles.leagueCard}>
                  {homeData.leagueRows.map((row, index) => (
                    <TouchableOpacity
                      key={row.league.id}
                      style={[
                        styles.leagueRow,
                        index < homeData.leagueRows.length - 1 && styles.leagueRowBorder,
                      ]}
                      activeOpacity={0.6}
                      onPress={() => {
                        setActiveLeagueId(row.league.id);
                        router.push('/(tabs)/league');
                      }}
                    >
                      <View style={styles.leagueLeft}>
                        <View style={styles.leagueNameRow}>
                          <Text style={styles.leagueEmoji}>
                            {row.league.league_type === 'matchup' ? '🤑' : '📈'}
                          </Text>
                          <Text style={styles.leagueName} numberOfLines={1}>
                            {row.league.name}
                          </Text>
                        </View>
                        <Text style={styles.leagueMeta}>
                          Season {row.seasonNumber} · Week {row.league.current_week}
                        </Text>
                      </View>

                      <View style={styles.leagueRight}>
                        {row.rank > 0 && (
                          <View style={styles.rankPill}>
                            <Text style={styles.rankPillText}>
                              {row.rank}{getRankSuffix(row.rank)}
                            </Text>
                          </View>
                        )}
                        {row.record ? (
                          <Text style={styles.recordText}>
                            {row.record.wins}-{row.record.losses}-{row.record.ties}
                          </Text>
                        ) : row.totalGain !== null ? (
                          <Text style={[
                            styles.recordText,
                            row.totalGain >= 0 ? styles.positive : styles.negative
                          ]}>
                            {row.totalGain >= 0 ? '+' : ''}${formatCurrency(row.totalGain)}
                          </Text>
                        ) : null}
                        <Text style={styles.leagueValue}>
                          ${formatCurrency(row.portfolioValue)}
                        </Text>
                      </View>

                      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} style={styles.chevron} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Section 4: This Week's Matchups */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>This Week</Text>

                {homeData.matchups.length > 0 ? (
                  <>
                    {homeData.matchups.length >= 2 && (
                      <View style={styles.summaryLine}>
                        {homeData.winCount > 0 && (
                          <Text style={styles.winText}>Winning {homeData.winCount}</Text>
                        )}
                        {homeData.winCount > 0 && homeData.loseCount > 0 && (
                          <Text style={styles.summaryDot}> · </Text>
                        )}
                        {homeData.loseCount > 0 && (
                          <Text style={styles.loseText}>Losing {homeData.loseCount}</Text>
                        )}
                      </View>
                    )}

                    {homeData.matchups.map((matchup) => {
                      const iAmWinning = matchup.myGain > matchup.opponentGain;

                      return (
                        <TouchableOpacity
                          key={matchup.id}
                          style={styles.matchupCard}
                          activeOpacity={0.6}
                          onPress={() => {
                            setActiveLeagueId(matchup.leagueId);
                            router.push('/(tabs)/matchup');
                          }}
                        >
                          <View style={styles.matchupHeader}>
                            <Text style={styles.matchupLeague}>
                              {matchup.leagueEmoji} {matchup.leagueName} · Week {matchup.weekNumber}
                            </Text>
                          </View>

                          <View style={styles.matchupBody}>
                            <View style={styles.matchupColumn}>
                              <Text style={styles.matchupUsername} numberOfLines={1}>
                                {matchup.myUsername}
                              </Text>
                              <Text style={[
                                styles.matchupValue,
                                iAmWinning && styles.positive,
                              ]}>
                                ${formatCurrency(matchup.myValue)}
                              </Text>
                              <Text style={[
                                styles.matchupGain,
                                matchup.myGain >= 0 ? styles.positive : styles.negative,
                              ]}>
                                {matchup.myGain >= 0 ? '+' : ''}${formatCurrency(matchup.myGain)}
                              </Text>
                            </View>

                            <Text style={styles.matchupVs}>VS</Text>

                            <View style={[styles.matchupColumn, styles.matchupColumnRight]}>
                              <Text style={styles.matchupUsername} numberOfLines={1}>
                                {matchup.opponentUsername}
                              </Text>
                              <Text style={[
                                styles.matchupValue,
                                !iAmWinning && matchup.myGain !== matchup.opponentGain && styles.positive,
                              ]}>
                                {matchup.opponentValue > 0
                                  ? `$${formatCurrency(matchup.opponentValue)}`
                                  : '--'}
                              </Text>
                              <Text style={[
                                styles.matchupGain,
                                matchup.opponentGain >= 0 ? styles.positive : styles.negative,
                              ]}>
                                {matchup.opponentGain >= 0 ? '+' : ''}${formatCurrency(matchup.opponentGain)}
                              </Text>
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                ) : (
                  <Text style={styles.noMatchups}>No matchups this week</Text>
                )}
              </View>
            </>
          )}

          {/* Bottom padding */}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },

  // Loading
  loadingText: {
    color: Colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 100,
  },

  // Auth (no user)
  authContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  authTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  authSubtitle: {
    fontSize: 16,
    color: Colors.textMuted,
    marginBottom: 32,
  },

  // Header — greeting + logo
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: 14,
    color: Colors.textMuted,
    marginBottom: 2,
  },
  headerUsername: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  headerLogo: {
    width: 100,
    height: 32,
  },

  // Portfolio Value — hero number
  portfolioSection: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  portfolioLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  portfolioValue: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 10,
  },
  changeAmount: {
    fontSize: 16,
    fontWeight: '600',
  },
  changePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  changePillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  portfolioCaption: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 8,
  },
  positive: {
    color: '#059669',
  },
  negative: {
    color: '#DC2626',
  },
  positiveBg: {
    backgroundColor: '#ECFDF5',
  },
  negativeBg: {
    backgroundColor: '#FEF2F2',
  },

  // Sections
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // League rows
  leagueCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    overflow: 'hidden',
  },
  leagueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 10,
  },
  leagueRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  leagueLeft: {
    flex: 1,
    marginRight: 12,
  },
  leagueNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  leagueEmoji: {
    fontSize: 20,
    marginRight: 8,
  },
  leagueName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    flex: 1,
  },
  leagueMeta: {
    fontSize: 12,
    color: Colors.textMuted,
    marginLeft: 28,
  },
  leagueRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  rankPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  rankPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  recordText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  leagueValue: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    marginLeft: 4,
  },

  // Matchup cards
  matchupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  matchupHeader: {
    marginBottom: 12,
  },
  matchupLeague: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  matchupBody: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  matchupColumn: {
    flex: 1,
  },
  matchupColumnRight: {
    alignItems: 'flex-end',
  },
  matchupUsername: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  matchupValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
    marginBottom: 1,
  },
  matchupGain: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  matchupVs: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    marginHorizontal: 12,
  },
  noMatchups: {
    fontSize: 14,
    color: Colors.textMuted,
  },

  // Summary line
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  winText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#059669',
  },
  loseText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#DC2626',
  },
  summaryDot: {
    fontSize: 13,
    color: Colors.textMuted,
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: Colors.textMuted,
    marginBottom: 28,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Buttons
  primaryButton: {
    backgroundColor: '#0891B2',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
