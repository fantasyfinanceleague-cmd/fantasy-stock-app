import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext, LeagueSeason } from '@/lib/LeagueContext';
import { router } from 'expo-router';
import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';
import StatusBadge from '@/components/StatusBadge';
import LeagueSwitcher from '@/components/LeagueSwitcher';
import { getWeekStatus, getCountdownMessage, getPlayoffRoundLabel } from '@/lib/weekStatus';

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
  playoff_round?: string;
}

interface UserProfile {
  id: string;
  username?: string;
  avatar?: string;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getRankBg(rank: number): string {
  if (rank === 1) return '#FFFBEB'; // gold tint
  if (rank === 2) return '#F1F5F9'; // silver tint
  if (rank === 3) return '#FFF7ED'; // bronze tint
  return '#F1F5F9';
}

function getRankColor(rank: number): string {
  if (rank === 1) return '#D97706';
  if (rank === 2) return '#64748B';
  if (rank === 3) return '#EA580C';
  return '#64748B';
}

export default function LeagueScreen() {
  const { user, loading: authLoading } = useAuth();
  const { leagues, activeLeagueId, activeLeague, refresh: refreshLeagues } = useLeagueContext();
  const [refreshing, setRefreshing] = useState(false);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [matchups, setMatchups] = useState<Matchup[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [seasons, setSeasons] = useState<LeagueSeason[]>([]);
  const [currentSeason, setCurrentSeason] = useState<LeagueSeason | null>(null);
  const [loading, setLoading] = useState(true);

  // Collapsible section states
  const [standingsExpanded, setStandingsExpanded] = useState(true);
  const [scheduleExpanded, setScheduleExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Schedule view state
  const [scheduleUserId, setScheduleUserId] = useState<string | null>(null);

  const isMatchupLeague = activeLeague?.league_type === 'matchup';
  const currentWeek = activeLeague?.current_week || 1;
  const numWeeks = activeLeague?.num_weeks || 0;

  // Animation refs for position changes
  const previousPositionsRef = useRef<Record<string, number>>({});
  const [animatingRows, setAnimatingRows] = useState<Record<string, 'up' | 'down'>>({});

  // Real-time subscription for standings and matchups
  useEffect(() => {
    if (!activeLeagueId || !isMatchupLeague) return;

    const channel = supabase
      .channel(`standings-${activeLeagueId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'league_standings',
          filter: `league_id=eq.${activeLeagueId}`
        },
        () => {
          const positions: Record<string, number> = {};
          sortedStandings.forEach((s, idx) => {
            positions[s.user_id] = idx;
          });
          previousPositionsRef.current = positions;
          fetchData();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matchups',
          filter: `league_id=eq.${activeLeagueId}`
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeLeagueId, isMatchupLeague]);

  // Apply animations when standings change
  useEffect(() => {
    if (!sortedStandings.length || !Object.keys(previousPositionsRef.current).length) return;

    const animations: Record<string, 'up' | 'down'> = {};
    sortedStandings.forEach((s, newIdx) => {
      const oldIdx = previousPositionsRef.current[s.user_id];
      if (oldIdx !== undefined && oldIdx !== newIdx) {
        animations[s.user_id] = oldIdx > newIdx ? 'up' : 'down';
      }
    });

    if (Object.keys(animations).length > 0) {
      setAnimatingRows(animations);
      setTimeout(() => {
        setAnimatingRows({});
        previousPositionsRef.current = {};
      }, 500);
    }
  }, [sortedStandings]);

  // Get week status for UI
  const currentMatchup = useMemo(() => {
    return matchups.find(m => m.week_number === currentWeek && !m.is_playoff);
  }, [matchups, currentWeek]);

  const weekStatus = useMemo(() => {
    return getWeekStatus(activeLeague, currentMatchup);
  }, [activeLeague, currentMatchup]);

  const countdownMessage = useMemo(() => {
    return getCountdownMessage(weekStatus);
  }, [weekStatus]);

  const currentPlayoffRound = useMemo(() => {
    if (weekStatus.phase !== 'playoffs') return null;
    const activePlayoffMatchup = matchups.find(
      m => m.is_playoff && m.week_number === currentWeek && m.team1_gain === null
    );
    if (activePlayoffMatchup) return activePlayoffMatchup.playoff_round || null;
    const nextPlayoffMatchup = matchups.find(
      m => m.is_playoff && m.team1_gain === null
    );
    return nextPlayoffMatchup?.playoff_round || null;
  }, [matchups, currentWeek, weekStatus.phase]);

  const currentPlayoffRoundLabel = useMemo(() => {
    return getPlayoffRoundLabel(currentPlayoffRound);
  }, [currentPlayoffRound]);

  // Set schedule user to current user by default
  useEffect(() => {
    if (user?.id && !scheduleUserId) {
      setScheduleUserId(user.id);
    }
  }, [user?.id]);

  useEffect(() => {
    if (activeLeagueId && user) {
      fetchData();
    } else {
      setStandings([]);
      setMatchups([]);
      setSeasons([]);
      setCurrentSeason(null);
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
      let matchupsData: Matchup[] = [];
      if (isMatchupLeague) {
        const { data, error: matchupsError } = await supabase
          .from('matchups')
          .select('*')
          .eq('league_id', activeLeagueId)
          .order('week_number', { ascending: true });

        if (matchupsError) {
          console.error('Error fetching matchups:', matchupsError);
        }

        matchupsData = data || [];
        setMatchups(matchupsData);
      }

      // Fetch seasons
      const { data: seasonsData } = await supabase
        .from('league_seasons')
        .select('*')
        .eq('league_id', activeLeagueId)
        .order('season_number', { ascending: false });

      if (seasonsData) {
        setSeasons(seasonsData);
        if (activeLeague?.current_season_id) {
          const current = seasonsData.find(s => s.id === activeLeague.current_season_id);
          setCurrentSeason(current || null);
        }
      }

      // Collect all user IDs
      const standingUserIds = fetchedStandings.map(s => s.user_id);
      const matchupUserIds = isMatchupLeague ?
        matchupsData.flatMap(m => [m.team1_user_id, m.team2_user_id]) : [];
      const seasonUserIds = (seasonsData || []).flatMap(s =>
        [s.champion_user_id, s.runner_up_user_id].filter(Boolean)
      ) as string[];

      const allUserIds = [...new Set([...standingUserIds, ...matchupUserIds, ...seasonUserIds])]
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
    if (userId.startsWith('bot-')) return '🤖';
    const profile = profiles[userId];
    if (profile?.avatar) return profile.avatar;
    return '📊';
  };

  // Sort standings
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

  // Get user's schedule (matchups where they participate)
  const userSchedule = useMemo(() => {
    if (!scheduleUserId) return [];
    return matchups
      .filter(m => m.team1_user_id === scheduleUserId || m.team2_user_id === scheduleUserId)
      .sort((a, b) => a.week_number - b.week_number);
  }, [matchups, scheduleUserId]);

  // Past seasons (completed)
  const pastSeasons = useMemo(() => {
    return seasons.filter(s => s.completed_at !== null);
  }, [seasons]);

  const leader = sortedStandings[0];
  const isSeasonCompleted = activeLeague?.season_status === 'completed';
  const isChampion = currentSeason?.champion_user_id === user?.id;
  const isRunnerUp = currentSeason?.runner_up_user_id === user?.id;

  if (authLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Sign in to view league</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.push('/login')}>
            <Text style={styles.buttonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LeagueSwitcher />

      <View style={styles.leagueActions}>
        <TouchableOpacity
          style={styles.leagueJoinButton}
          onPress={() => router.push('/join-league')}
        >
          <Text style={styles.leagueJoinText}>Join</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.leagueCreateButton}
          onPress={() => router.push('/create-league')}
        >
          <Text style={styles.leagueCreateText}>+ Create</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0891B2" />
        }
      >
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
            {/* Season Banner */}
            {isSeasonCompleted && currentSeason && (
              <View style={[
                styles.seasonBanner,
                isChampion ? styles.championBanner : isRunnerUp ? styles.runnerUpBanner : styles.completedBanner
              ]}>
                {isChampion ? (
                  <>
                    <Text style={styles.bannerIcon}>🏆</Text>
                    <View style={styles.bannerTextContainer}>
                      <Text style={styles.bannerTitle}>Season {currentSeason.season_number} Champion!</Text>
                      <Text style={styles.bannerSubtitle}>Congratulations on your victory</Text>
                    </View>
                  </>
                ) : isRunnerUp ? (
                  <>
                    <Text style={styles.bannerIcon}>🥈</Text>
                    <View style={styles.bannerTextContainer}>
                      <Text style={styles.bannerTitle}>Season {currentSeason.season_number} Runner-Up</Text>
                      <Text style={styles.bannerSubtitle}>So close! Better luck next season</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.bannerIcon}>🏁</Text>
                    <View style={styles.bannerTextContainer}>
                      <Text style={styles.bannerTitle}>Season {currentSeason.season_number} Complete</Text>
                      <Text style={styles.bannerSubtitle}>
                        Champion: {getDisplayName(currentSeason.champion_user_id || '')}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            )}

            {/* Active Season Banner */}
            {!isSeasonCompleted && currentSeason && (
              <View style={styles.activeSeasonBanner}>
                <View style={styles.seasonInfoRow}>
                  <Text style={styles.seasonLabel}>Season {currentSeason.season_number}</Text>
                  {isMatchupLeague && (
                    <View style={styles.weekBadge}>
                      <Text style={styles.weekBadgeText}>
                        {weekStatus.phase === 'playoffs'
                          ? `Playoffs${currentPlayoffRoundLabel ? `: ${currentPlayoffRoundLabel}` : ''}`
                          : `Week ${currentWeek} of ${numWeeks}`
                        }
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* KPI Cards */}
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, cardShadow]}>
                <View style={[styles.kpiIconCircle, { backgroundColor: '#FFFBEB' }]}>
                  <Ionicons name="trophy" size={18} color="#D97706" />
                </View>
                <Text style={styles.kpiLabel}>Leader</Text>
                {leader ? (
                  <>
                    <Text style={styles.kpiValue} numberOfLines={1}>{getDisplayName(leader.user_id)}</Text>
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

              <View style={[styles.kpiCard, cardShadow]}>
                <View style={[styles.kpiIconCircle, { backgroundColor: '#ECFEFF' }]}>
                  <Ionicons name="calendar" size={18} color="#0891B2" />
                </View>
                <Text style={styles.kpiLabel}>{isMatchupLeague ? 'Week' : 'Type'}</Text>
                {isMatchupLeague ? (
                  weekStatus.phase === 'playoffs' ? (
                    <>
                      <Text style={styles.kpiValue}>Playoffs</Text>
                      {currentPlayoffRoundLabel && (
                        <Text style={styles.kpiSub}>{currentPlayoffRoundLabel}</Text>
                      )}
                    </>
                  ) : weekStatus.phase === 'completed' ? (
                    <>
                      <Text style={styles.kpiValue}>Complete</Text>
                      <StatusBadge type="final" />
                    </>
                  ) : (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.kpiValueLarge}>{currentWeek}</Text>
                        {weekStatus.status === 'final' && <StatusBadge type="final" />}
                        {weekStatus.status === 'active' && <StatusBadge type="live" />}
                      </View>
                      <Text style={styles.kpiSub}>of {numWeeks} weeks</Text>
                    </>
                  )
                ) : (
                  <Text style={styles.kpiValue}>Duration</Text>
                )}
              </View>

              <View style={[styles.kpiCard, cardShadow]}>
                <View style={[styles.kpiIconCircle, { backgroundColor: '#EEF2FF' }]}>
                  <Ionicons name="people" size={18} color="#6366F1" />
                </View>
                <Text style={styles.kpiLabel}>Players</Text>
                <Text style={styles.kpiValueLarge}>{sortedStandings.length}</Text>
              </View>
            </View>

            {/* Standings Section */}
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => setStandingsExpanded(!standingsExpanded)}
                activeOpacity={0.7}
              >
                <View style={styles.sectionHeaderLeft}>
                  <Text style={styles.sectionTitle}>Standings</Text>
                  {isMatchupLeague && !isSeasonCompleted && (
                    <Text style={styles.sectionSubtitle}>
                      {weekStatus.phase === 'playoffs'
                        ? 'Regular Season Final'
                        : `Week ${currentWeek} of ${numWeeks}`
                      }
                    </Text>
                  )}
                </View>
                <Ionicons
                  name={standingsExpanded ? 'chevron-up' : 'chevron-down'}
                  size={24}
                  color="#94A3B8"
                />
              </TouchableOpacity>

              {standingsExpanded && (
                <View style={styles.sectionContent}>
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
                      const rank = idx + 1;
                      const winPct = (standing.wins + standing.losses + standing.ties) > 0
                        ? ((standing.wins + standing.ties * 0.5) / (standing.wins + standing.losses + standing.ties) * 100).toFixed(0)
                        : '0';

                      return (
                        <TouchableOpacity
                          key={standing.user_id}
                          style={[
                            styles.standingRow,
                            isMe && styles.standingRowHighlight,
                          ]}
                          onPress={() => router.push({
                            pathname: '/player-portfolio',
                            params: { userId: standing.user_id, username: getDisplayName(standing.user_id) },
                          })}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.rankBadge, { backgroundColor: getRankBg(rank) }]}>
                            <Text style={[styles.rankText, { color: getRankColor(rank) }]}>{rank}</Text>
                          </View>

                          <View style={styles.avatarCircle}>
                            <Text style={styles.avatarText}>{getAvatar(standing.user_id)}</Text>
                          </View>

                          <View style={styles.standingInfo}>
                            <Text style={[styles.standingName, isMe && styles.standingNameHighlight]}>
                              {getDisplayName(standing.user_id)}
                              {isMe && ' (You)'}
                            </Text>
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
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              )}
            </View>

            {/* Schedule Section — Only for matchup leagues */}
            {isMatchupLeague && (
              <View style={styles.section}>
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => setScheduleExpanded(!scheduleExpanded)}
                  activeOpacity={0.7}
                >
                  <View style={styles.sectionHeaderLeft}>
                    <Text style={styles.sectionTitle}>Schedule</Text>
                    <Text style={styles.sectionSubtitle}>
                      {scheduleUserId === user?.id ? 'Your matchups' : getDisplayName(scheduleUserId || '')}
                    </Text>
                  </View>
                  <Ionicons
                    name={scheduleExpanded ? 'chevron-up' : 'chevron-down'}
                    size={24}
                    color="#94A3B8"
                  />
                </TouchableOpacity>

                {scheduleExpanded && (
                  <View style={styles.sectionContent}>
                    {/* Player selector */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.playerSelector}>
                      {sortedStandings.map((s) => (
                        <TouchableOpacity
                          key={s.user_id}
                          style={[
                            styles.playerChip,
                            scheduleUserId === s.user_id && styles.playerChipActive
                          ]}
                          onPress={() => setScheduleUserId(s.user_id)}
                        >
                          <Text style={styles.playerChipAvatar}>{getAvatar(s.user_id)}</Text>
                          <Text style={[
                            styles.playerChipText,
                            scheduleUserId === s.user_id && styles.playerChipTextActive
                          ]}>
                            {s.user_id === user?.id ? 'You' : getDisplayName(s.user_id)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>

                    {/* Schedule list */}
                    {userSchedule.length === 0 ? (
                      <View style={styles.emptyStandings}>
                        <Text style={styles.emptyText}>No matchups scheduled</Text>
                      </View>
                    ) : (
                      userSchedule.map((matchup) => {
                        const isTeam1 = matchup.team1_user_id === scheduleUserId;
                        const opponentId = isTeam1 ? matchup.team2_user_id : matchup.team1_user_id;
                        const myGain = isTeam1 ? matchup.team1_gain : matchup.team2_gain;
                        const isComplete = myGain !== null;
                        const iWon = matchup.winner_user_id === scheduleUserId;
                        const isTie = isComplete && matchup.winner_user_id === null;
                        const isCurrent = matchup.week_number === currentWeek && !isComplete;

                        return (
                          <TouchableOpacity
                            key={matchup.id}
                            style={[styles.scheduleRow, isCurrent && styles.scheduleRowCurrent]}
                            onPress={() => router.push({
                              pathname: '/(tabs)/matchup',
                              params: {
                                week: matchup.week_number,
                                matchupId: matchup.id,
                                team1: matchup.team1_user_id,
                                team2: matchup.team2_user_id,
                              }
                            })}
                            activeOpacity={0.7}
                          >
                            <View style={styles.scheduleWeek}>
                              <Text style={[
                                styles.scheduleWeekNumber,
                                isCurrent && styles.scheduleWeekCurrent
                              ]}>
                                {matchup.is_playoff ? (getPlayoffRoundLabel(matchup.playoff_round) || matchup.playoff_round) : `Wk ${matchup.week_number}`}
                              </Text>
                            </View>

                            <View style={styles.scheduleOpponent}>
                              <Text style={styles.scheduleVs}>vs</Text>
                              <Text style={styles.scheduleOpponentAvatar}>{getAvatar(opponentId)}</Text>
                              <Text style={styles.scheduleOpponentName} numberOfLines={1}>
                                {getDisplayName(opponentId)}
                              </Text>
                            </View>

                            <View style={styles.scheduleResult}>
                              {isComplete ? (
                                <>
                                  <View style={[
                                    styles.resultBadge,
                                    iWon ? styles.resultWin : isTie ? styles.resultTie : styles.resultLoss
                                  ]}>
                                    <Text style={[
                                      styles.resultBadgeText,
                                      iWon ? styles.positive : isTie ? { color: '#D97706' } : styles.negative
                                    ]}>
                                      {iWon ? 'W' : isTie ? 'T' : 'L'}
                                    </Text>
                                  </View>
                                  <Text style={[
                                    styles.scheduleScore,
                                    (myGain || 0) >= 0 ? styles.positive : styles.negative
                                  ]}>
                                    {(myGain || 0) >= 0 ? '+' : ''}${formatCurrency(myGain || 0)}
                                  </Text>
                                </>
                              ) : isCurrent ? (
                                <Text style={styles.scheduleCurrent}>Current</Text>
                              ) : (
                                <Text style={styles.scheduleUpcoming}>Upcoming</Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>
                )}
              </View>
            )}

            {/* History Section */}
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => setHistoryExpanded(!historyExpanded)}
                activeOpacity={0.7}
              >
                <View style={styles.sectionHeaderLeft}>
                  <Text style={styles.sectionTitle}>History</Text>
                  <Text style={styles.sectionSubtitle}>
                    {pastSeasons.length} completed season{pastSeasons.length !== 1 ? 's' : ''}
                  </Text>
                </View>
                <Ionicons
                  name={historyExpanded ? 'chevron-up' : 'chevron-down'}
                  size={24}
                  color="#94A3B8"
                />
              </TouchableOpacity>

              {historyExpanded && (
              <View style={styles.sectionContent}>
                {pastSeasons.length === 0 ? (
                  <View style={styles.emptyStandings}>
                    <Text style={styles.emptyText}>No completed seasons yet</Text>
                    <Text style={styles.emptySubtext}>
                      Season history will appear here after completion
                    </Text>
                  </View>
                ) : (
                  (historyExpanded ? pastSeasons : pastSeasons.slice(0, 1)).map((season) => {
                    const myStats = season.final_standings?.find(s => s.user_id === user?.id);
                    const wasChampion = season.champion_user_id === user?.id;
                    const wasRunnerUp = season.runner_up_user_id === user?.id;
                    const myRank = myStats?.rank || 0;
                    const myWins = myStats?.wins || 0;
                    const myLosses = myStats?.losses || 0;
                    const myTies = myStats?.ties || 0;
                    const totalGames = myWins + myLosses + myTies;
                    const winPct = totalGames > 0 ? ((myWins + myTies * 0.5) / totalGames).toFixed(2) : '0.00';

                    const showUserId = wasChampion ? season.runner_up_user_id : season.champion_user_id;
                    const showUserStats = season.final_standings?.find(s => s.user_id === showUserId);
                    const showUserRank = wasChampion ? 2 : 1;

                    const getRankSuffix = (rank: number) => {
                      if (rank === 1) return 'st';
                      if (rank === 2) return 'nd';
                      if (rank === 3) return 'rd';
                      return 'th';
                    };

                    const formatDateRange = () => {
                      const startDate = season.started_at ? new Date(season.started_at) : null;
                      const endDate = season.completed_at ? new Date(season.completed_at) : null;
                      if (!startDate || !endDate) return '';

                      const formatMonth = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                      const startStr = formatMonth(startDate);
                      const endStr = formatMonth(endDate);

                      if (startStr === endStr) return startStr;
                      return `${startStr} - ${endStr}`;
                    };

                    return (
                      <View key={season.id} style={[styles.historyCard, cardShadow]}>
                        <View style={styles.historyCardHeader}>
                          <Text style={styles.historySeasonLabel}>
                            Season {season.season_number}
                          </Text>
                          <Text style={styles.historyDateRange}>
                            {formatDateRange()}
                          </Text>
                        </View>

                        <View style={styles.historyYourStats}>
                          <View style={styles.historyStatsLeft}>
                            <View style={styles.historyStatBox}>
                              <Text style={[
                                styles.historyStatValue,
                                wasChampion && styles.historyStatChampion,
                                wasRunnerUp && styles.historyStatRunnerUp,
                              ]}>
                                {myRank}{getRankSuffix(myRank)}
                              </Text>
                              <Text style={styles.historyStatLabel}>Place</Text>
                            </View>
                            <View style={styles.historyStatDivider} />
                            <View style={styles.historyStatBox}>
                              <Text style={styles.historyStatValue}>
                                {myWins}-{myLosses}-{myTies}
                              </Text>
                              <Text style={styles.historyStatLabel}>Record</Text>
                            </View>
                            <View style={styles.historyStatDivider} />
                            <View style={styles.historyStatBox}>
                              <Text style={styles.historyStatValue}>{winPct}</Text>
                              <Text style={styles.historyStatLabel}>Win%</Text>
                            </View>
                          </View>

                          <View style={styles.historyBadge}>
                            {wasChampion ? (
                              <Text style={styles.historyBadgeIcon}>🏆</Text>
                            ) : wasRunnerUp ? (
                              <Text style={styles.historyBadgeIcon}>🥈</Text>
                            ) : (
                              <View style={styles.historyParticipantBadge}>
                                <Text style={styles.historyParticipantText}>#{myRank}</Text>
                              </View>
                            )}
                          </View>
                        </View>

                        {showUserId && (
                          <View style={styles.historyWinnerRow}>
                            <Text style={styles.historyWinnerRank}>
                              {showUserRank}{getRankSuffix(showUserRank)}
                            </Text>
                            <Text style={styles.historyWinnerAvatar}>
                              {getAvatar(showUserId)}
                            </Text>
                            <Text style={styles.historyWinnerName} numberOfLines={1}>
                              {getDisplayName(showUserId)}
                            </Text>
                            {showUserStats && (
                              <Text style={styles.historyWinnerRecord}>
                                {showUserStats.wins}-{showUserStats.losses}-{showUserStats.ties}
                              </Text>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
              )}
            </View>

            <View style={{ height: 40 }} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
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
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  loadingText: {
    color: '#94A3B8',
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
  // Season Banners
  seasonBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginTop: 12,
    marginBottom: 8,
    padding: 16,
    borderRadius: 12,
  },
  championBanner: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#D97706',
  },
  runnerUpBanner: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#94A3B8',
  },
  completedBanner: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  bannerIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  bannerTextContainer: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  bannerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  activeSeasonBanner: {
    marginHorizontal: 24,
    marginTop: 12,
    marginBottom: 8,
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  seasonInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seasonLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  weekBadge: {
    backgroundColor: 'rgba(8,145,178,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  weekBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0891B2',
  },
  // KPI Cards
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 8,
    marginBottom: 20,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  kpiIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  kpiLabel: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 4,
    textAlign: 'center',
  },
  kpiValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
    textAlign: 'center',
  },
  kpiValueLarge: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
  },
  kpiSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  // Section styles
  section: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    marginBottom: 12,
  },
  sectionHeaderLeft: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0F172A',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  sectionContent: {},
  // Standing row styles
  standingRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
  },
  standingRowHighlight: {
    backgroundColor: '#ECFEFF',
    borderColor: '#0891B2',
    borderLeftWidth: 3,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rankText: {
    fontSize: 14,
    fontWeight: '800',
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    fontSize: 16,
  },
  standingInfo: {
    flex: 1,
    marginRight: 8,
  },
  standingName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  standingNameHighlight: {
    color: '#0891B2',
  },
  standingStats: {
    alignItems: 'center',
    marginRight: 12,
  },
  recordText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  winPctText: {
    fontSize: 10,
    color: '#64748B',
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
    color: '#64748B',
    marginTop: 2,
  },
  positive: {
    color: '#059669',
  },
  negative: {
    color: '#DC2626',
  },
  emptyStandings: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#0F172A',
    fontWeight: '600',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
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
    marginBottom: 24,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#0891B2',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  leagueActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 6,
  },
  leagueJoinButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  leagueJoinText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  leagueCreateButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  leagueCreateText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  // Schedule styles
  playerSelector: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  playerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  playerChipActive: {
    backgroundColor: 'rgba(8,145,178,0.08)',
    borderColor: '#0891B2',
  },
  playerChipAvatar: {
    fontSize: 16,
    marginRight: 6,
  },
  playerChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#94A3B8',
  },
  playerChipTextActive: {
    color: '#0891B2',
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  scheduleRowCurrent: {
    borderColor: '#0891B2',
    backgroundColor: '#ECFEFF',
  },
  scheduleWeek: {
    width: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scheduleWeekNumber: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
  },
  scheduleWeekCurrent: {
    color: '#0891B2',
  },
  scheduleOpponent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  scheduleVs: {
    fontSize: 12,
    color: '#94A3B8',
    marginRight: 8,
  },
  scheduleOpponentAvatar: {
    fontSize: 20,
    marginRight: 8,
  },
  scheduleOpponentName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0F172A',
    flex: 1,
  },
  scheduleResult: {
    alignItems: 'flex-end',
    minWidth: 70,
  },
  resultBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 2,
  },
  resultWin: {
    backgroundColor: '#ECFDF5',
  },
  resultLoss: {
    backgroundColor: '#FEF2F2',
  },
  resultTie: {
    backgroundColor: '#FFFBEB',
  },
  resultBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  scheduleScore: {
    fontSize: 13,
    fontWeight: '600',
  },
  scheduleUpcoming: {
    fontSize: 13,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  scheduleCurrent: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0891B2',
  },
  // History styles
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  historyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  historySeasonLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  historyDateRange: {
    fontSize: 12,
    color: '#94A3B8',
  },
  historyYourStats: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  historyStatsLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyStatBox: {
    alignItems: 'flex-start',
  },
  historyStatValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
  },
  historyStatChampion: {
    color: '#D97706',
  },
  historyStatRunnerUp: {
    color: '#94A3B8',
  },
  historyStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  historyStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 16,
  },
  historyBadge: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyBadgeIcon: {
    fontSize: 40,
  },
  historyParticipantBadge: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyParticipantText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#94A3B8',
  },
  historyWinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  historyWinnerRank: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
    marginRight: 10,
    width: 28,
  },
  historyWinnerAvatar: {
    fontSize: 20,
    marginRight: 10,
  },
  historyWinnerName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#0F172A',
  },
  historyWinnerRecord: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
});
