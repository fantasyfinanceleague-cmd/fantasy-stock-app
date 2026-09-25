/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
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
import { Button, Card } from '@/components/ui';
import { SkeletonCard, SkeletonRows } from '@/components/Skeleton';

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
  if (rank === 1) return Colors.warningBg; // gold tint
  if (rank === 2) return Colors.bgElevated; // silver tint
  if (rank === 3) return Colors.bronzeBg; // bronze tint
  return Colors.bgElevated;
}

function getRankColor(rank: number): string {
  if (rank === 1) return Colors.warning;
  if (rank === 2) return Colors.textSecondary;
  if (rank === 3) return Colors.bronze;
  return Colors.textSecondary;
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
      <View style={[styles.container, { paddingTop: 60 }]}>
        <SkeletonCard />
      </View>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Sign in to view league</Text>
          <Button title="Sign In" onPress={() => router.push('/login')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LeagueSwitcher />

      <View style={styles.leagueActions}>
        <Button
          title="Join"
          variant="secondary"
          size="sm"
          onPress={() => router.push('/join-league')}
          style={{ borderColor: Colors.primary }}
          textStyle={{ color: Colors.primary }}
        />
        <Button
          title="+ Create"
          variant="primary"
          size="sm"
          onPress={() => router.push('/create-league')}
        />
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {leagues.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>No leagues yet</Text>
            <Text style={styles.emptySubtitle}>Join a league to see standings</Text>
            <Button title="View Leagues" onPress={() => router.push('/(tabs)/leagues')} />
          </View>
        ) : (
          <>
            {/* Draft Banner — primary entry to the draft room now that Draft left the tab bar */}
            {activeLeague && activeLeague.draft_status !== 'completed' && (
              <TouchableOpacity
                style={[
                  styles.draftBanner,
                  activeLeague.draft_status === 'in_progress' && styles.draftBannerLive,
                ]}
                activeOpacity={0.8}
                onPress={() => router.push('/(tabs)/draft')}
                accessibilityRole="button"
                accessibilityLabel="Open draft room"
              >
                <View style={styles.draftBannerIconCircle}>
                  <Ionicons name="hammer" size={18} color={Colors.primary} />
                </View>
                <View style={styles.bannerTextContainer}>
                  <Text style={styles.draftBannerTitle}>
                    {activeLeague.draft_status === 'in_progress'
                      ? 'Draft in progress'
                      : 'Draft room'}
                  </Text>
                  <Text style={styles.draftBannerSubtitle}>
                    {activeLeague.draft_status === 'in_progress'
                      ? 'Your league is drafting now — jump in'
                      : 'Make your picks when the draft begins'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.primary} />
              </TouchableOpacity>
            )}

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
              <Card style={styles.kpiCardInner}>
                <View style={[styles.kpiIconCircle, { backgroundColor: Colors.warningBg }]}>
                  <Ionicons name="trophy" size={18} color={Colors.warning} />
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
              </Card>

              <Card style={styles.kpiCardInner}>
                <View style={[styles.kpiIconCircle, { backgroundColor: Colors.cyanLight }]}>
                  <Ionicons name="calendar" size={18} color={Colors.primary} />
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
              </Card>

              <Card style={styles.kpiCardInner}>
                <View style={[styles.kpiIconCircle, { backgroundColor: Colors.secondaryBg }]}>
                  <Ionicons name="people" size={18} color={Colors.secondary} />
                </View>
                <Text style={styles.kpiLabel}>Players</Text>
                <Text style={styles.kpiValueLarge}>{sortedStandings.length}</Text>
              </Card>
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
                  color={Colors.textMuted}
                />
              </TouchableOpacity>

              {standingsExpanded && (
                <View style={styles.sectionContent}>
                  {loading ? (
                    <SkeletonRows count={4} />
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
                    color={Colors.textMuted}
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
                                      iWon ? styles.positive : isTie ? { color: Colors.warning } : styles.negative
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
                  color={Colors.textMuted}
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
                      <Card key={season.id} padded={false} style={styles.historyCardOuter}>
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
                      </Card>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  scrollView: {
    flex: 1,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
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
    backgroundColor: Colors.warningBg,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  runnerUpBanner: {
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.textMuted,
  },
  completedBanner: {
    backgroundColor: Colors.bgSurface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bannerIcon: {
    fontSize: 32,
    fontFamily: 'Inter_400Regular',
    marginRight: 12,
  },
  bannerTextContainer: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
  },
  bannerSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginTop: 12,
    marginBottom: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: Colors.cyanLight,
    borderWidth: 1,
    borderColor: Colors.primary,
    gap: 12,
  },
  draftBannerLive: {
    borderWidth: 2,
  },
  draftBannerIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
  draftBannerTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
  },
  draftBannerSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 1,
  },
  activeSeasonBanner: {
    marginHorizontal: 24,
    marginTop: 12,
    marginBottom: 8,
    padding: 12,
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  seasonInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seasonLabel: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
  weekBadge: {
    backgroundColor: Colors.primaryBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  weekBadgeText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  // KPI Cards
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 8,
    marginBottom: 20,
  },
  kpiCardInner: {
    flex: 1,
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
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
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginBottom: 4,
    textAlign: 'center',
  },
  kpiValue: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  kpiValueLarge: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
  },
  kpiSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
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
    borderBottomColor: Colors.border,
    marginBottom: 12,
  },
  sectionHeaderLeft: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
  sectionSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  sectionContent: {},
  // Standing row styles
  standingRow: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  standingRowHighlight: {
    backgroundColor: Colors.cyanLight,
    borderColor: Colors.primary,
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
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
  },
  standingInfo: {
    flex: 1,
    marginRight: 8,
  },
  standingName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
  standingNameHighlight: {
    color: Colors.primary,
  },
  standingStats: {
    alignItems: 'center',
    marginRight: 12,
  },
  recordText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
  },
  winPctText: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textSecondary,
    marginTop: 2,
  },
  standingPoints: {
    alignItems: 'flex-end',
  },
  pointsValue: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
  },
  pointsValueLarge: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
  },
  pointsLabel: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  positive: {
    color: Colors.success,
  },
  negative: {
    color: Colors.error,
  },
  emptyStandings: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textPrimary,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginBottom: 24,
    textAlign: 'center',
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
  // Schedule styles
  playerSelector: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  playerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  playerChipActive: {
    backgroundColor: Colors.primaryBg,
    borderColor: Colors.primary,
  },
  playerChipAvatar: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    marginRight: 6,
  },
  playerChipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
  },
  playerChipTextActive: {
    color: Colors.primary,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  scheduleRowCurrent: {
    borderColor: Colors.primary,
    backgroundColor: Colors.cyanLight,
  },
  scheduleWeek: {
    width: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scheduleWeekNumber: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textMuted,
  },
  scheduleWeekCurrent: {
    color: Colors.primary,
  },
  scheduleOpponent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  scheduleVs: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginRight: 8,
  },
  scheduleOpponentAvatar: {
    fontSize: 20,
    fontFamily: 'Inter_400Regular',
    marginRight: 8,
  },
  scheduleOpponentName: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textPrimary,
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
    backgroundColor: Colors.successBg,
  },
  resultLoss: {
    backgroundColor: Colors.errorBg,
  },
  resultTie: {
    backgroundColor: Colors.warningBg,
  },
  resultBadgeText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  scheduleScore: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
  },
  scheduleUpcoming: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  scheduleCurrent: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  // History styles
  historyCardOuter: {
    marginBottom: 12,
    borderRadius: 12,
  },
  historyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  historySeasonLabel: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
  },
  historyDateRange: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
  },
  historyYourStats: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
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
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
  },
  historyStatChampion: {
    color: Colors.warning,
  },
  historyStatRunnerUp: {
    color: Colors.textMuted,
  },
  historyStatLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  historyStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.border,
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
    fontFamily: 'Inter_400Regular',
  },
  historyParticipantBadge: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyParticipantText: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.textMuted,
  },
  historyWinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  historyWinnerRank: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
    marginRight: 10,
    width: 28,
  },
  historyWinnerAvatar: {
    fontSize: 20,
    fontFamily: 'Inter_400Regular',
    marginRight: 10,
  },
  historyWinnerName: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textPrimary,
  },
  historyWinnerRecord: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
  },
});