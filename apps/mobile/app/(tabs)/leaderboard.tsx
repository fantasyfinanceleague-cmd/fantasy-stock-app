import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { router } from 'expo-router';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';

interface Standing {
  user_id: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
}

interface Matchup {
  id: string;
  league_id: string;
  week_number: number;
  team1_user_id: string;
  team2_user_id: string;
  team1_gain: number | null;
  team2_gain: number | null;
  winner_user_id: string | null;
  is_playoff?: boolean;
}

interface UserProfile {
  id: string;
  username?: string;
  avatar?: string;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LeaderboardScreen() {
  const { user, loading: authLoading } = useAuth();
  const { leagues, activeLeagueId, activeLeague, refresh: refreshLeagues } = useLeagueContext();
  const [refreshing, setRefreshing] = useState(false);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [matchups, setMatchups] = useState<Matchup[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);

  const isMatchupLeague = activeLeague?.league_type === 'matchup';
  const currentWeek = activeLeague?.current_week || 1;
  const numWeeks = activeLeague?.num_weeks || 0;

  useEffect(() => {
    if (activeLeagueId && user) {
      fetchData();
    } else {
      setStandings([]);
      setMatchups([]);
      setLoading(false);
    }
  }, [activeLeagueId, user]);

  async function fetchData() {
    if (!activeLeagueId) return;

    setLoading(true);
    try {
      // Fetch standings
      const { data: standingsData, error: standingsError } = await supabase
        .from('league_standings')
        .select('*')
        .eq('league_id', activeLeagueId)
        .order('wins', { ascending: false });

      if (standingsError) {
        console.error('Error fetching standings:', standingsError);
      }

      const fetchedStandings = standingsData || [];
      setStandings(fetchedStandings);

      // Fetch matchups for matchup leagues
      if (isMatchupLeague) {
        const { data: matchupsData, error: matchupsError } = await supabase
          .from('matchups')
          .select('*')
          .eq('league_id', activeLeagueId)
          .order('week_number', { ascending: true });

        if (matchupsError) {
          console.error('Error fetching matchups:', matchupsError);
        }

        setMatchups(matchupsData || []);
      }

      // Collect all user IDs from standings and matchups
      const standingUserIds = fetchedStandings.map(s => s.user_id);
      const matchupUserIds = isMatchupLeague ?
        (matchups || []).flatMap(m => [m.team1_user_id, m.team2_user_id]) : [];

      const allUserIds = [...new Set([...standingUserIds, ...matchupUserIds])]
        .filter(id => id && !id.startsWith('bot-'));

      if (allUserIds.length > 0) {
        const { data: profileData, error: profileError } = await supabase
          .from('user_profiles')
          .select('id, username, avatar')
          .in('id', allUserIds);

        if (profileError) {
          console.error('Error fetching profiles:', profileError);
        }

        if (profileData && profileData.length > 0) {
          const profileMap: Record<string, UserProfile> = {};
          profileData.forEach(p => {
            profileMap[p.id] = p;
          });
          setProfiles(profileMap);
        }
      }
    } catch (err) {
      console.error('Error in fetchData:', err);
    } finally {
      setLoading(false);
    }
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshLeagues(), fetchData()]);
    setRefreshing(false);
  };

  const getDisplayName = (userId: string): string => {
    if (!userId) return 'TBD';

    // Handle bot users
    if (userId.startsWith('bot-')) {
      const num = userId.replace('bot-', '');
      return `Bot ${num}`;
    }

    const profile = profiles[userId];
    if (profile?.username) return profile.username;
    return userId.substring(0, 8) + '...';
  };

  const getAvatar = (userId: string): string => {
    if (!userId) return '❓';

    // Handle bot users
    if (userId.startsWith('bot-')) {
      return '🤖';
    }

    const profile = profiles[userId];
    if (profile?.avatar) {
      return profile.avatar;
    }
    return '📊';
  };

  // Sort standings for matchup leagues (by win %, then wins, then points)
  const sortedStandings = useMemo(() => {
    return [...standings].sort((a, b) => {
      const aTotal = a.wins + a.losses + a.ties;
      const bTotal = b.wins + b.losses + b.ties;
      const aPct = aTotal > 0 ? (a.wins + a.ties * 0.5) / aTotal : 0;
      const bPct = bTotal > 0 ? (b.wins + b.ties * 0.5) / bTotal : 0;

      if (bPct !== aPct) return bPct - aPct;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return Number(b.points_for) - Number(a.points_for);
    });
  }, [standings]);

  // Current week matchups
  const currentWeekMatchups = useMemo(() => {
    return matchups.filter(m => m.week_number === currentWeek && !m.is_playoff);
  }, [matchups, currentWeek]);

  const leader = sortedStandings[0];

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
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Sign in to view leaderboard</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.push('/login')}>
            <Text style={styles.buttonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Leaderboard</Text>
          {activeLeague && (
            <TouchableOpacity onPress={() => router.push('/leagues')}>
              <Text style={styles.leagueName}>{activeLeague.name} ▾</Text>
            </TouchableOpacity>
          )}
        </View>

        {leagues.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>No leagues yet</Text>
            <Text style={styles.emptySubtitle}>Join a league to see standings</Text>
            <TouchableOpacity style={styles.button} onPress={() => router.push('/(tabs)/leagues')}>
              <Text style={styles.buttonText}>View Leagues</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* KPI Cards */}
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiIcon}>🏆</Text>
                <Text style={styles.kpiLabel}>League Leader</Text>
                {leader ? (
                  <>
                    <Text style={styles.kpiValue}>{getDisplayName(leader.user_id)}</Text>
                    {isMatchupLeague ? (
                      <Text style={styles.kpiSub}>
                        {leader.wins}-{leader.losses}{leader.ties > 0 ? `-${leader.ties}` : ''}
                      </Text>
                    ) : (
                      <Text style={[styles.kpiSub, Number(leader.points_for) >= 0 ? styles.positive : styles.negative]}>
                        ${formatCurrency(Number(leader.points_for) || 0)}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={styles.kpiValue}>—</Text>
                )}
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiIcon}>📅</Text>
                <Text style={styles.kpiLabel}>{isMatchupLeague ? 'Current Week' : 'League Type'}</Text>
                {isMatchupLeague ? (
                  <>
                    <Text style={styles.kpiValueLarge}>{currentWeek}</Text>
                    <Text style={styles.kpiSub}>of {numWeeks} weeks</Text>
                  </>
                ) : (
                  <Text style={styles.kpiValue}>Duration</Text>
                )}
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiIcon}>👥</Text>
                <Text style={styles.kpiLabel}>Total Players</Text>
                <Text style={styles.kpiValueLarge}>{sortedStandings.length}</Text>
              </View>
            </View>

            {/* Standings List */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Current Standings</Text>
                {isMatchupLeague && (
                  <Text style={styles.sectionSubtitle}>Week {currentWeek} of {numWeeks}</Text>
                )}
              </View>

              {loading ? (
                <Text style={styles.loadingText}>Loading standings...</Text>
              ) : sortedStandings.length === 0 ? (
                <View style={styles.emptyStandings}>
                  <Text style={styles.emptyText}>No standings yet</Text>
                  <Text style={styles.emptySubtext}>
                    {isMatchupLeague ? 'Complete a week to see records' : 'Draft stocks to begin'}
                  </Text>
                </View>
              ) : (
                sortedStandings.map((standing, idx) => {
                  const isMe = standing.user_id === user?.id;
                  const winPct = (standing.wins + standing.losses + standing.ties) > 0
                    ? ((standing.wins + standing.ties * 0.5) / (standing.wins + standing.losses + standing.ties) * 100).toFixed(0)
                    : '0';

                  return (
                    <View
                      key={standing.user_id}
                      style={[styles.standingRow, isMe && styles.standingRowHighlight]}
                    >
                      <View style={styles.rankBadge}>
                        <Text style={styles.rankText}>{idx + 1}</Text>
                      </View>

                      <View style={styles.avatarCircle}>
                        <Text style={styles.avatarText}>{getAvatar(standing.user_id)}</Text>
                      </View>

                      <View style={styles.standingInfo}>
                        <Text style={[styles.standingName, isMe && styles.standingNameHighlight]}>
                          {getDisplayName(standing.user_id)}
                          {isMe && ' (You)'}
                        </Text>
                        <Text style={styles.standingLeague}>{activeLeague?.name}</Text>
                      </View>

                      {isMatchupLeague ? (
                        <>
                          <View style={styles.standingStats}>
                            <Text style={styles.recordText}>
                              {standing.wins}-{standing.losses}{standing.ties > 0 ? `-${standing.ties}` : ''}
                            </Text>
                            <Text style={styles.winPctText}>{winPct}% win rate</Text>
                          </View>

                          <View style={styles.standingPoints}>
                            <Text style={[
                              styles.pointsValue,
                              Number(standing.points_for) >= 0 ? styles.positive : styles.negative
                            ]}>
                              ${formatCurrency(Number(standing.points_for) || 0)}
                            </Text>
                            <Text style={styles.pointsLabel}>total gain</Text>
                          </View>
                        </>
                      ) : (
                        <View style={styles.standingPoints}>
                          <Text style={[
                            styles.pointsValueLarge,
                            Number(standing.points_for) >= 0 ? styles.positive : styles.negative
                          ]}>
                            {Number(standing.points_for) >= 0 ? '+' : ''}${formatCurrency(Number(standing.points_for) || 0)}
                          </Text>
                          <Text style={styles.pointsLabel}>total gain</Text>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
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
  loadingText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 40,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
    paddingHorizontal: 24,
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
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 20,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  kpiIcon: {
    fontSize: 20,
    marginBottom: 6,
  },
  kpiLabel: {
    fontSize: 10,
    color: '#888',
    marginBottom: 4,
    textAlign: 'center',
  },
  kpiValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  kpiValueLarge: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
  },
  kpiSub: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  section: {
    paddingHorizontal: 24,
    paddingBottom: 24,
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
    color: '#fff',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#888',
  },
  // Matchup card styles
  matchupCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  matchupTeam: {
    flex: 1,
    alignItems: 'center',
  },
  matchupAvatar: {
    fontSize: 28,
    marginBottom: 4,
  },
  matchupName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  matchupWinner: {
    color: '#22c55e',
  },
  matchupTie: {
    color: '#eab308',
  },
  matchupGain: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  matchupVs: {
    paddingHorizontal: 12,
  },
  matchupVsText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#6b7280',
  },
  // Standing row styles
  standingRow: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  standingRowHighlight: {
    backgroundColor: '#18202c',
    borderColor: '#22c55e',
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0ea5e9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rankText: {
    color: '#0b1220',
    fontSize: 14,
    fontWeight: '800',
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  standingInfo: {
    flex: 1,
    marginRight: 8,
  },
  standingName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  standingNameHighlight: {
    color: '#93c5fd',
  },
  standingLeague: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  standingStats: {
    alignItems: 'center',
    marginRight: 12,
  },
  recordText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  winPctText: {
    fontSize: 10,
    color: '#888',
    marginTop: 2,
  },
  standingPoints: {
    alignItems: 'flex-end',
  },
  pointsValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  pointsValueLarge: {
    fontSize: 16,
    fontWeight: '700',
  },
  pointsLabel: {
    fontSize: 10,
    color: '#888',
    marginTop: 2,
  },
  positive: {
    color: '#22c55e',
  },
  negative: {
    color: '#ef4444',
  },
  emptyStandings: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#888',
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
    marginBottom: 24,
    textAlign: 'center',
  },
  button: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
