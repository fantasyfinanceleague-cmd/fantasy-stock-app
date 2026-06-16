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
  Platform,
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

  useEffect(() => {
    if (!user?.id || leagues.length === 0) return;

    const fetchRecordsAndSeasons = async () => {
      const newRecords: Record<string, LeagueRecord> = {};
      const newSeasonInfo: Record<string, SeasonInfo> = {};

      for (const league of leagues) {
        if (league.current_season_id) {
          const { data: season } = await supabase
            .from('league_seasons')
            .select('season_number, champion_user_id, runner_up_user_id, completed_at')
            .eq('id', league.current_season_id)
            .single();

          if (season) {
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
          newSeasonInfo[league.id] = {
            seasonNumber: 1,
            seasonStatus: league.season_status || 'active',
            championUserId: null,
            runnerUpUserId: null,
            championName: null,
            runnerUpName: null,
          };
        }

        if (league.league_type === 'matchup') {
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

  const getCardBorderStyle = (league: League, isActive: boolean) => {
    const status = getChampionshipStatus(league);
    if (status === 'champion') return { borderColor: '#D97706', borderWidth: 2 };
    if (status === 'runner-up') return { borderColor: '#94A3B8', borderWidth: 2 };
    if (isActive) return { borderColor: '#0891B2' };
    return {};
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
        {leagues.map((league, index) => {
          const record = records[league.id];
          const info = seasonInfo[league.id];
          const isActive = league.id === activeLeagueId;
          const championshipStatus = getChampionshipStatus(league);
          const borderOverride = getCardBorderStyle(league, isActive);

          return (
            <TouchableOpacity
              key={league.id}
              style={[
                styles.card,
                cardShadow,
                borderOverride,
                championshipStatus === 'participant' && styles.cardCompleted,
              ]}
              onPress={() => handleCardPress(league)}
              activeOpacity={0.9}
            >
              {championshipStatus === 'champion' && (
                <View style={styles.championBanner}>
                  <Text style={styles.bannerIcon}>🏆</Text>
                  <Text style={styles.championBannerText}>Season {info?.seasonNumber} Champion</Text>
                </View>
              )}
              {championshipStatus === 'runner-up' && (
                <View style={styles.runnerUpBanner}>
                  <Text style={styles.bannerIcon}>🥈</Text>
                  <Text style={styles.runnerUpBannerText}>Season {info?.seasonNumber} Runner-Up</Text>
                </View>
              )}
              {championshipStatus === 'participant' && (
                <View style={styles.completedBanner}>
                  <Text style={styles.completedBannerText}>Season {info?.seasonNumber} Complete</Text>
                </View>
              )}

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
                  style={styles.iconButton}
                  onPress={() => handleShowInviteCode(league)}
                >
                  <Ionicons name="share-outline" size={18} color="#0891B2" />
                </TouchableOpacity>
                {league.commissioner_id === user?.id && (
                  <TouchableOpacity
                    style={styles.iconButtonMuted}
                    onPress={() => router.push({ pathname: '/league-settings', params: { leagueId: league.id } })}
                  >
                    <Ionicons name="settings-outline" size={18} color="#94A3B8" />
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Create New League Card */}
        <TouchableOpacity
          style={[styles.card, cardShadow, styles.createCard]}
          onPress={() => router.push('/create-league')}
          activeOpacity={0.9}
        >
          <View style={styles.createContent}>
            <View style={styles.createIconCircle}>
              <Ionicons name="add" size={36} color="#0891B2" />
            </View>
            <Text style={styles.createTitle}>Create or Join</Text>
            <Text style={styles.createSubtitle}>Start a new league or join an existing one</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>

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

const cardShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  android: {
    elevation: 2,
  },
  default: {},
}) as object;

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
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    overflow: 'hidden',
  },
  cardCompleted: {
    opacity: 0.85,
  },
  championBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFBEB',
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 12,
    paddingVertical: 8,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#D97706',
  },
  runnerUpBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 12,
    paddingVertical: 8,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#94A3B8',
  },
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 12,
    paddingVertical: 8,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  bannerIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  championBannerText: {
    color: '#92400E',
    fontWeight: '700',
    fontSize: 13,
  },
  runnerUpBannerText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 13,
  },
  completedBannerText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 13,
  },
  championRankBadge: {
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D97706',
  },
  runnerUpRankBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#94A3B8',
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
    color: '#0F172A',
    marginBottom: 2,
  },
  leagueType: {
    fontSize: 13,
    color: '#94A3B8',
  },
  rankBadge: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  rankNumber: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
  },
  rankSuffix: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 4,
    marginLeft: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
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
    color: '#0F172A',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#E2E8F0',
  },
  positive: {
    color: '#059669',
  },
  negative: {
    color: '#DC2626',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0891B2',
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0891B2',
  },
  iconButton: {
    width: 42,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0891B2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonMuted: {
    width: 42,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(8,145,178,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#0891B2',
  },
  createTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  createSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
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
    backgroundColor: '#E2E8F0',
  },
  indicatorActive: {
    backgroundColor: '#0891B2',
    width: 24,
  },
});
