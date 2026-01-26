import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  TouchableOpacity,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Share,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors } from '@/constants/Colors';
import { useLeagueContext, League, LeagueSeason } from '@/lib/LeagueContext';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/useAuth';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 48;
const CARD_MARGIN = 8;

interface LeagueRecord {
  wins: number;
  losses: number;
  ties: number;
  rank: number;
  totalPlayers: number;
  totalGain?: number;
}

interface SeasonInfo {
  seasonNumber: number;
  seasonStatus: 'active' | 'completed';
  championUserId: string | null;
  runnerUpUserId: string | null;
  championName: string | null;
  runnerUpName: string | null;
}

export default function LeagueCarousel() {
  const { user } = useAuth();
  const { leagues, activeLeagueId, setActiveLeagueId } = useLeagueContext();
  const [records, setRecords] = useState<Record<string, LeagueRecord>>({});
  const [seasonInfo, setSeasonInfo] = useState<Record<string, SeasonInfo>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);

  // Fetch records and season info for all leagues
  useEffect(() => {
    if (!user?.id || leagues.length === 0) return;

    const fetchRecordsAndSeasons = async () => {
      const newRecords: Record<string, LeagueRecord> = {};
      const newSeasonInfo: Record<string, SeasonInfo> = {};

      for (const league of leagues) {
        // Fetch current season info
        if (league.current_season_id) {
          const { data: season } = await supabase
            .from('league_seasons')
            .select('season_number, champion_user_id, runner_up_user_id, completed_at')
            .eq('id', league.current_season_id)
            .single();

          if (season) {
            // Get champion and runner-up names if season is completed
            let championName: string | null = null;
            let runnerUpName: string | null = null;

            if (season.champion_user_id || season.runner_up_user_id) {
              const userIds = [season.champion_user_id, season.runner_up_user_id].filter(Boolean);
              const { data: profiles } = await supabase
                .from('user_profiles')
                .select('id, username')
                .in('id', userIds);

              if (profiles) {
                const champProfile = profiles.find(p => p.id === season.champion_user_id);
                const runnerProfile = profiles.find(p => p.id === season.runner_up_user_id);
                championName = champProfile?.username || null;
                runnerUpName = runnerProfile?.username || null;
              }
            }

            newSeasonInfo[league.id] = {
              seasonNumber: season.season_number,
              seasonStatus: season.completed_at ? 'completed' : 'active',
              championUserId: season.champion_user_id,
              runnerUpUserId: season.runner_up_user_id,
              championName,
              runnerUpName,
            };
          }
        } else {
          // Default season info for leagues without a season record yet
          newSeasonInfo[league.id] = {
            seasonNumber: 1,
            seasonStatus: league.season_status || 'active',
            championUserId: null,
            runnerUpUserId: null,
            championName: null,
            runnerUpName: null,
          };
        }

        // Fetch standings
        if (league.league_type === 'matchup') {
          // Fetch standings for matchup league
          const { data: standings } = await supabase
            .from('league_standings')
            .select('user_id, wins, losses, ties')
            .eq('league_id', league.id)
            .order('wins', { ascending: false });

          if (standings) {
            const userStanding = standings.find(s => s.user_id === user.id);
            const userRank = standings.findIndex(s => s.user_id === user.id) + 1;

            newRecords[league.id] = {
              wins: userStanding?.wins || 0,
              losses: userStanding?.losses || 0,
              ties: userStanding?.ties || 0,
              rank: userRank || standings.length,
              totalPlayers: standings.length,
            };
          }
        } else {
          // Duration league - fetch portfolio gain and rank
          const { data: standings } = await supabase
            .from('league_standings')
            .select('user_id, points_for')
            .eq('league_id', league.id)
            .order('points_for', { ascending: false });

          if (standings) {
            const userStanding = standings.find(s => s.user_id === user.id);
            const userRank = standings.findIndex(s => s.user_id === user.id) + 1;

            newRecords[league.id] = {
              wins: 0,
              losses: 0,
              ties: 0,
              rank: userRank || standings.length,
              totalPlayers: standings.length,
              totalGain: Number(userStanding?.points_for) || 0,
            };
          }
        }
      }

      setRecords(newRecords);
      setSeasonInfo(newSeasonInfo);
    };

    fetchRecordsAndSeasons();
  }, [user?.id, leagues]);

  // Find initial index based on active league
  useEffect(() => {
    const index = leagues.findIndex(l => l.id === activeLeagueId);
    if (index >= 0 && index !== activeIndex) {
      setActiveIndex(index);
      scrollViewRef.current?.scrollTo({ x: index * (CARD_WIDTH + CARD_MARGIN * 2), animated: false });
    }
  }, [activeLeagueId, leagues]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffsetX / (CARD_WIDTH + CARD_MARGIN * 2));
    if (index !== activeIndex && index >= 0 && index <= leagues.length) {
      setActiveIndex(index);
      // Update active league when swiping, or null for "Create or Join" card
      if (index < leagues.length) {
        setActiveLeagueId(leagues[index].id);
      } else {
        setActiveLeagueId(null);
      }
    }
  };

  const handleCardPress = (league: League) => {
    setActiveLeagueId(league.id);
  };

  const getLeagueIcon = (league: League) => {
    if (league.league_type === 'matchup') return '🤑';
    return '📈';
  };

  const getRankSuffix = (rank: number) => {
    if (rank === 1) return 'st';
    if (rank === 2) return 'nd';
    if (rank === 3) return 'rd';
    return 'th';
  };

  const formatCurrency = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getChampionshipStatus = (league: League): 'champion' | 'runner-up' | 'participant' | null => {
    const info = seasonInfo[league.id];
    if (!info || info.seasonStatus !== 'completed') return null;

    if (info.championUserId === user?.id) return 'champion';
    if (info.runnerUpUserId === user?.id) return 'runner-up';
    return 'participant';
  };

  const getCardStyle = (league: League, isActive: boolean) => {
    const status = getChampionshipStatus(league);
    const baseStyles = [styles.card];

    if (status === 'champion') {
      baseStyles.push(styles.cardChampion);
    } else if (status === 'runner-up') {
      baseStyles.push(styles.cardRunnerUp);
    } else if (status === 'participant') {
      baseStyles.push(styles.cardCompleted);
    }

    if (isActive && status !== 'champion' && status !== 'runner-up') {
      baseStyles.push(styles.cardActive);
    }

    return baseStyles;
  };

  const handleShareInvite = async (league: League) => {
    if (!league.invite_code) {
      Alert.alert('Error', 'No invite code available for this league');
      return;
    }
    try {
      await Share.share({
        message: `Join my Fantasy Stock league "${league.name}"! Use code: ${league.invite_code}`,
      });
    } catch (error) {
      console.error('Failed to share:', error);
    }
  };

  const handleShowInviteCode = (league: League) => {
    if (!league.invite_code) {
      Alert.alert('Error', 'No invite code available');
      return;
    }
    Alert.alert(
      'Invite Code',
      `Share this code with friends to invite them to "${league.name}":\n\n${league.invite_code}`,
      [
        { text: 'Copy', onPress: () => handleShareInvite(league) },
        { text: 'OK', style: 'cancel' },
      ]
    );
  };

  // Total items = leagues + 1 (for create new)
  const totalItems = leagues.length + 1;

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        snapToInterval={CARD_WIDTH + CARD_MARGIN * 2}
        decelerationRate="fast"
        contentContainerStyle={styles.scrollContent}
      >
        {/* League Cards */}
        {leagues.map((league, index) => {
          const record = records[league.id];
          const info = seasonInfo[league.id];
          const isActive = league.id === activeLeagueId;
          const championshipStatus = getChampionshipStatus(league);

          return (
            <TouchableOpacity
              key={league.id}
              style={getCardStyle(league, isActive)}
              onPress={() => handleCardPress(league)}
              activeOpacity={0.9}
            >
              {/* Championship Banner for completed seasons */}
              {championshipStatus === 'champion' && (
                <View style={styles.championBanner}>
                  <Text style={styles.championBannerIcon}>🏆</Text>
                  <Text style={styles.championBannerText}>Season {info?.seasonNumber} Champion</Text>
                </View>
              )}
              {championshipStatus === 'runner-up' && (
                <View style={styles.runnerUpBanner}>
                  <Text style={styles.runnerUpBannerIcon}>🥈</Text>
                  <Text style={styles.runnerUpBannerText}>Season {info?.seasonNumber} Runner-Up</Text>
                </View>
              )}
              {championshipStatus === 'participant' && (
                <View style={styles.completedBanner}>
                  <Text style={styles.completedBannerText}>Season {info?.seasonNumber} Complete</Text>
                </View>
              )}

              {/* Header */}
              <View style={styles.cardHeader}>
                <Text style={styles.leagueIcon}>{getLeagueIcon(league)}</Text>
                <View style={styles.headerText}>
                  <Text style={styles.leagueName} numberOfLines={1}>{league.name}</Text>
                  <Text style={styles.leagueType}>
                    {league.league_type === 'matchup' ? 'Matchup League' : 'Duration League'}
                    {info && info.seasonStatus === 'active' && ` • Season ${info.seasonNumber}`}
                  </Text>
                </View>
                {championshipStatus === 'champion' ? (
                  <View style={styles.championRankBadge}>
                    <Text style={styles.trophyIcon}>🏆</Text>
                  </View>
                ) : championshipStatus === 'runner-up' ? (
                  <View style={styles.runnerUpRankBadge}>
                    <Text style={styles.medalIcon}>🥈</Text>
                  </View>
                ) : record && (
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankNumber}>{record.rank}</Text>
                    <Text style={styles.rankSuffix}>{getRankSuffix(record.rank)}</Text>
                  </View>
                )}
              </View>

              {/* Stats */}
              {record && (
                <View style={styles.statsRow}>
                  {league.league_type === 'matchup' ? (
                    <>
                      <View style={styles.statItem}>
                        <Text style={styles.statValue}>{record.wins}</Text>
                        <Text style={styles.statLabel}>Wins</Text>
                      </View>
                      <View style={styles.statDivider} />
                      <View style={styles.statItem}>
                        <Text style={styles.statValue}>{record.losses}</Text>
                        <Text style={styles.statLabel}>Losses</Text>
                      </View>
                      <View style={styles.statDivider} />
                      <View style={styles.statItem}>
                        <Text style={styles.statValue}>{record.ties}</Text>
                        <Text style={styles.statLabel}>Ties</Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={styles.statItem}>
                        <Text style={[
                          styles.statValue,
                          (record.totalGain || 0) >= 0 ? styles.positive : styles.negative
                        ]}>
                          {formatCurrency(record.totalGain || 0)}
                        </Text>
                        <Text style={styles.statLabel}>Total Gain</Text>
                      </View>
                      <View style={styles.statDivider} />
                      <View style={styles.statItem}>
                        <Text style={styles.statValue}>{record.rank}/{record.totalPlayers}</Text>
                        <Text style={styles.statLabel}>Rank</Text>
                      </View>
                    </>
                  )}
                </View>
              )}

              {/* Action Buttons */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => {
                    setActiveLeagueId(league.id);
                    router.push('/(tabs)/portfolio');
                  }}
                >
                  <Text style={styles.actionButtonText}>Portfolio</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => {
                    setActiveLeagueId(league.id);
                    router.push('/(tabs)/league');
                  }}
                >
                  <Text style={styles.actionButtonText}>League</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.shareButton}
                  onPress={() => handleShowInviteCode(league)}
                >
                  <Ionicons name="share-outline" size={20} color={Colors.primary} />
                </TouchableOpacity>
                {league.commissioner_id === user?.id && (
                  <TouchableOpacity
                    style={styles.settingsButton}
                    onPress={() => router.push({ pathname: '/league-settings', params: { leagueId: league.id } })}
                  >
                    <Ionicons name="settings-outline" size={20} color={Colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Create New League Card */}
        <TouchableOpacity
          style={[styles.card, styles.createCard]}
          onPress={() => router.push('/create-league')}
          activeOpacity={0.9}
        >
          <View style={styles.createContent}>
            <View style={styles.createIconCircle}>
              <Ionicons name="add" size={40} color={Colors.primary} />
            </View>
            <Text style={styles.createTitle}>Create or Join</Text>
            <Text style={styles.createSubtitle}>Start a new league or join an existing one</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>

      {/* Page Indicators */}
      <View style={styles.indicators}>
        {Array.from({ length: totalItems }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.indicator,
              index === activeIndex && styles.indicatorActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  scrollContent: {
    paddingHorizontal: 24 - CARD_MARGIN,
  },
  card: {
    width: CARD_WIDTH,
    marginHorizontal: CARD_MARGIN,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  cardActive: {
    borderColor: Colors.primary,
  },
  cardChampion: {
    borderColor: Colors.gold,
    borderWidth: 2,
    backgroundColor: Colors.goldBg,
  },
  cardRunnerUp: {
    borderColor: Colors.silver,
    borderWidth: 2,
    backgroundColor: Colors.silverBg,
  },
  cardCompleted: {
    opacity: 0.85,
    borderColor: Colors.textMuted,
  },
  championBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gold,
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 12,
    paddingVertical: 8,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  championBannerIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  championBannerText: {
    color: '#1f2937',
    fontWeight: '700',
    fontSize: 13,
  },
  runnerUpBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.silver,
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 12,
    paddingVertical: 8,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  runnerUpBannerIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  runnerUpBannerText: {
    color: '#1f2937',
    fontWeight: '700',
    fontSize: 13,
  },
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(107, 114, 128, 0.3)',
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 12,
    paddingVertical: 8,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  completedBannerText: {
    color: Colors.textMuted,
    fontWeight: '600',
    fontSize: 13,
  },
  championRankBadge: {
    backgroundColor: Colors.goldBg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.gold,
  },
  runnerUpRankBadge: {
    backgroundColor: Colors.silverBg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.silver,
  },
  trophyIcon: {
    fontSize: 24,
  },
  medalIcon: {
    fontSize: 24,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  leagueIcon: {
    fontSize: 36,
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  leagueName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  leagueType: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  rankBadge: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  rankNumber: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  rankSuffix: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 4,
    marginLeft: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 12,
    paddingVertical: 16,
    marginBottom: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.border,
  },
  positive: {
    color: Colors.success,
  },
  negative: {
    color: Colors.error,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  shareButton: {
    width: 44,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsButton: {
    width: 44,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createCard: {
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 200,
  },
  createContent: {
    alignItems: 'center',
  },
  createIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primaryBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  createTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  createSubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  indicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.border,
  },
  indicatorActive: {
    backgroundColor: Colors.textPrimary,
    width: 24,
  },
});
