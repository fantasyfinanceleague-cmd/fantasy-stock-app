/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useHomeData } from '@/lib/useHomeData';
import { useHistoricalPL } from '@/lib/useHistoricalPL';
import { PerformanceChart, PeriodPL } from '@/components/PerformanceChart';
import { router } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { SkeletonCard } from '@/components/Skeleton';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { Button, Card, Screen, SectionLabel } from '@/components/ui';

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
  const { data: historicalData, loading: histLoading } = useHistoricalPL(
    homeData.allDrafts,
    homeData.allTrades,
    homeData.allDrafts.length > 0,
  );
  const [username, setUsername] = useState<string | null>(null);
  const [periodPL, setPeriodPL] = useState<PeriodPL | null>(null);
  const handlePeriodPLChange = useCallback((pl: PeriodPL) => setPeriodPL(pl), []);

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
        <View style={styles.authContainer}>
          <Text style={styles.authTitle}>Fantasy Stock</Text>
          <Text style={styles.authSubtitle}>Sign in to get started</Text>
          <Button
            title="Sign In"
            onPress={() => router.push('/login')}
            variant="primary"
          />
        </View>
      </View>
    );
  }

  // Use period-relative P/L when chart is active, otherwise all-time
  const hasChart = historicalData.length >= 2;
  const displayGainLoss = hasChart && periodPL ? periodPL.gainLoss : homeData.totalGainLoss;
  const displayGainLossPercent = hasChart && periodPL ? periodPL.gainLossPercent : homeData.totalGainLossPercent;
  const isPositive = hasChart && periodPL ? periodPL.isPositive : homeData.totalGainLoss >= 0;

  return (
    <Screen refreshing={homeData.refreshing} onRefresh={homeData.refresh}>
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
          <Button
            title="Get Started"
            onPress={() => router.push('/create-league')}
            variant="primary"
          />
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
                  {isPositive ? '+' : ''}${formatCurrency(displayGainLoss)}
                </Text>
                <View style={[
                  styles.changePill,
                  isPositive ? styles.positiveBg : styles.negativeBg
                ]}>
                  <Text style={[
                    styles.changePillText,
                    isPositive ? styles.positive : styles.negative
                  ]}>
                    {formatPercent(displayGainLossPercent)}
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

          {/* Section 2b: Performance Chart */}
          {historicalData.length >= 2 && (
            <View style={styles.chartSection}>
              <PerformanceChart
                data={historicalData}
                loading={histLoading}
                onPeriodPLChange={handlePeriodPLChange}
              />
            </View>
          )}

          {/* Section 3: Your Leagues */}
          <View style={styles.section}>
            <SectionLabel>Your Leagues</SectionLabel>
            <Card padded={false}>
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
            </Card>
          </View>

          {/* Section 4: This Week's Matchups */}
          <View style={styles.section}>
            <SectionLabel>This Week</SectionLabel>

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
                      activeOpacity={0.6}
                      onPress={() => {
                        setActiveLeagueId(matchup.leagueId);
                        router.push('/(tabs)/matchup');
                      }}
                    >
                      <Card style={styles.matchupCard}>
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
                      </Card>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },

  // Loading
  loadingText: {
    color: Colors.textMuted,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
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
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  authSubtitle: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
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
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginBottom: 2,
  },
  headerUsername: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
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
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  portfolioValue: {
    fontSize: 34,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
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
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
  },
  changePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  changePillText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
  },
  portfolioCaption: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginTop: 8,
  },
  chartSection: {
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  positive: {
    color: Colors.success,
  },
  negative: {
    color: Colors.error,
  },
  positiveBg: {
    backgroundColor: Colors.successBg,
  },
  negativeBg: {
    backgroundColor: Colors.errorBg,
  },

  // Sections
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },

  // League rows
  leagueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 10,
  },
  leagueRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
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
    fontFamily: 'Inter_400Regular',
    marginRight: 8,
  },
  leagueName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    flex: 1,
  },
  leagueMeta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginLeft: 28,
  },
  leagueRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  rankPill: {
    backgroundColor: Colors.bgElevated,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  rankPillText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
  },
  recordText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  leagueValue: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    marginLeft: 4,
  },

  // Matchup cards
  matchupCard: {
    marginBottom: 8,
  },
  matchupHeader: {
    marginBottom: 12,
  },
  matchupLeague: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
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
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  matchupValue: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
    marginBottom: 1,
  },
  matchupGain: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
  },
  matchupVs: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textMuted,
    marginHorizontal: 12,
  },
  noMatchups: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
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
    fontFamily: 'Inter_600SemiBold',
    color: Colors.success,
  },
  loseText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.error,
  },
  summaryDot: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
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
    backgroundColor: Colors.bgElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginBottom: 28,
    textAlign: 'center',
    lineHeight: 22,
  },
});
