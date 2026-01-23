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
import { useLeagueContext, League } from '@/lib/LeagueContext';
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

export default function LeagueCarousel() {
  const { user } = useAuth();
  const { leagues, activeLeagueId, setActiveLeagueId } = useLeagueContext();
  const [records, setRecords] = useState<Record<string, LeagueRecord>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);

  // Fetch records for all leagues
  useEffect(() => {
    if (!user?.id || leagues.length === 0) return;

    const fetchRecords = async () => {
      const newRecords: Record<string, LeagueRecord> = {};

      for (const league of leagues) {
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
    };

    fetchRecords();
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
          const isActive = league.id === activeLeagueId;

          return (
            <TouchableOpacity
              key={league.id}
              style={[styles.card, isActive && styles.cardActive]}
              onPress={() => handleCardPress(league)}
              activeOpacity={0.9}
            >
              {/* Header */}
              <View style={styles.cardHeader}>
                <Text style={styles.leagueIcon}>{getLeagueIcon(league)}</Text>
                <View style={styles.headerText}>
                  <Text style={styles.leagueName} numberOfLines={1}>{league.name}</Text>
                  <Text style={styles.leagueType}>
                    {league.league_type === 'matchup' ? 'Matchup League' : 'Duration League'}
                  </Text>
                </View>
                {record && (
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
                    router.push('/(tabs)/leaderboard');
                  }}
                >
                  <Text style={styles.actionButtonText}>Standings</Text>
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
