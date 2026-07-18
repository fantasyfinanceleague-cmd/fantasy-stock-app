import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal, TextInput, Alert, ActivityIndicator, Platform, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext, League } from '@/lib/LeagueContext';
import { router } from 'expo-router';
import { useState, useEffect } from 'react';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { validateLeagueName } from '@/lib/contentModeration';
import DateTimePicker from '@react-native-community/datetimepicker';

interface LeagueMember {
  user_id: string;
  role: string;
  joined_at: string;
  display_name?: string;
}

function getStatusBadge(status: League['draft_status']) {
  switch (status) {
    case 'not_started':
      return { text: 'Pending', color: Colors.warning };
    case 'in_progress':
      return { text: 'Drafting', color: Colors.primary };
    case 'completed':
      return { text: 'Active', color: Colors.success };
    default:
      return { text: 'Unknown', color: Colors.textMuted };
  }
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default function LeaguesScreen() {
  const { user } = useAuth();
  const { leagues, loading, activeLeagueId, setActiveLeagueId, refresh } = useLeagueContext();
  const [refreshing, setRefreshing] = useState(false);

  // Create league modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [leagueName, setLeagueName] = useState('');
  const [leagueType, setLeagueType] = useState<'matchup' | 'duration'>('duration');
  const [numTeams, setNumTeams] = useState(12);
  const [numRounds, setNumRounds] = useState(6);
  const [budgetMode, setBudgetMode] = useState<'budget' | 'no-budget'>('budget');
  const [budgetAmount, setBudgetAmount] = useState('100000');
  const [numWeeks, setNumWeeks] = useState(11);
  const [durationDays, setDurationDays] = useState(30);
  const [playoffTeams, setPlayoffTeams] = useState(4);
  const [draftDate, setDraftDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Derived values
  const minWeeks = numTeams - 1;
  const getPlayoffOptions = () => {
    const allOptions = [2, 4, 8];
    return allOptions.filter(o => o < numTeams);
  };
  const validPlayoffOptions = getPlayoffOptions();

  // League detail modal state
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Fetch members when a league is selected
  useEffect(() => {
    if (!selectedLeague?.id) {
      setMembers([]);
      return;
    }

    (async () => {
      setLoadingMembers(true);
      try {
        // Fetch members with their profiles
        const { data: memberData } = await supabase
          .from('league_members')
          .select('user_id, role, joined_at')
          .eq('league_id', selectedLeague.id)
          .order('joined_at', { ascending: true });

        if (memberData?.length) {
          // Fetch profiles for members from user_profiles table
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, username')
            .in('id', memberData.map(m => m.user_id));

          const profileMap = new Map(profiles?.map(p => [p.id, p.username]) || []);

          setMembers(memberData.map(m => {
            const username = profileMap.get(m.user_id);
            // Handle bots
            if (m.user_id.startsWith('bot-')) {
              return { ...m, display_name: `Bot ${m.user_id.replace('bot-', '')}` };
            }
            // Use username if available, otherwise truncate user ID
            return {
              ...m,
              display_name: username || (m.user_id.length > 12 ? m.user_id.substring(0, 8) + '...' : m.user_id)
            };
          }));
        } else {
          setMembers([]);
        }
      } catch (e) {
        console.error('Failed to fetch members:', e);
      } finally {
        setLoadingMembers(false);
      }
    })();
  }, [selectedLeague?.id]);

  const openLeagueDetail = (league: League) => {
    setSelectedLeague(league);
    setShowDetailModal(true);
  };

  const shareInviteCode = async () => {
    if (!selectedLeague?.invite_code) return;
    try {
      await Share.share({
        message: `Join my Fantasy Stock league "${selectedLeague.name}"! Use code: ${selectedLeague.invite_code}`,
      });
    } catch (e) {
      console.error('Failed to share:', e);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'TBD';
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const resetForm = () => {
    setLeagueName('');
    setLeagueType('duration');
    setNumTeams(12);
    setNumRounds(6);
    setBudgetMode('budget');
    setBudgetAmount('100000');
    setNumWeeks(11);
    setDurationDays(30);
    setPlayoffTeams(4);
    setDraftDate(null);
  };

  const handleCreateLeague = async () => {
    if (!user?.id) return;

    const name = leagueName.trim();
    if (!name) {
      Alert.alert('Error', 'Please enter a league name');
      return;
    }

    if (!draftDate) {
      Alert.alert('Error', 'Please select a draft date and time');
      return;
    }

    // Content moderation
    const contentCheck = validateLeagueName(name);
    if (!contentCheck.isValid) {
      Alert.alert('Error', contentCheck.reason || 'League name is not allowed');
      return;
    }

    setCreating(true);
    try {
      const capDisabled = budgetMode === 'no-budget';
      const budget = capDisabled ? null : (parseInt(budgetAmount) || 100000);
      const effectiveWeeks = leagueType === 'matchup' ? Math.max(numWeeks, minWeeks) : null;

      // Create the league
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .insert({
          name,
          commissioner_id: user.id,
          invite_code: generateInviteCode(),
          num_participants: numTeams,
          num_rounds: numRounds,
          budget_mode: budgetMode,
          budget_amount: budget || 100000,
          salary_cap_limit: budget,
          league_type: leagueType,
          duration_days: leagueType === 'duration' ? durationDays : 30,
          num_weeks: effectiveWeeks,
          playoff_teams: leagueType === 'matchup' ? playoffTeams : null,
          draft_status: 'not_started',
          draft_date: draftDate!.toISOString(),
        })
        .select()
        .single();

      if (leagueError) throw leagueError;

      // Add creator as commissioner
      const { error: memberError } = await supabase
        .from('league_members')
        .insert({
          league_id: league.id,
          user_id: user.id,
          role: 'commissioner',
        });

      if (memberError) throw memberError;

      // Refresh leagues and close modal
      await refresh();
      setShowCreateModal(false);
      resetForm();

      // Set as active league
      setActiveLeagueId(league.id);
      Alert.alert('Success', `League "${name}" created! Share code: ${league.invite_code}`);
    } catch (error: any) {
      console.error('Failed to create league:', error);
      Alert.alert('Error', error.message || 'Failed to create league');
    } finally {
      setCreating(false);
    }
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>Sign in to view leagues</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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
        <View style={styles.header}>
          <Text style={styles.title}>Leagues</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.joinButton}
              onPress={() => router.push('/join-league')}
            >
              <Text style={styles.joinButtonText}>Join</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => setShowCreateModal(true)}
            >
              <Text style={styles.createButtonText}>+ Create</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <Text style={styles.loadingText}>Loading leagues...</Text>
        ) : leagues.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No leagues yet</Text>
            <Text style={styles.emptySubtitle}>
              Create a league or join one with an invite code to get started
            </Text>
          </View>
        ) : (
          <View style={styles.section}>
            {leagues.map((league) => {
              const status = getStatusBadge(league.draft_status);
              const isActive = league.id === activeLeagueId;

              return (
                <TouchableOpacity
                  key={league.id}
                  style={[styles.leagueCard, isActive && styles.leagueCardActive]}
                  onPress={() => openLeagueDetail(league)}
                >
                  <View style={styles.leagueHeader}>
                    <Text style={styles.leagueName}>{league.name}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: status.color + '20' }]}>
                      <Text style={[styles.statusText, { color: status.color }]}>
                        {status.text}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.leagueDetails}>
                    <Text style={styles.leagueDetail}>
                      {league.league_type === 'matchup' ? 'Matchup' : 'Duration'} League
                    </Text>
                    <Text style={styles.leagueDetail}>•</Text>
                    <Text style={styles.leagueDetail}>
                      {league.budget_mode === 'budget'
                        ? `$${league.budget_amount?.toLocaleString()} budget`
                        : 'No budget'}
                    </Text>
                  </View>

                  {league.draft_status === 'not_started' && (
                    <Text style={styles.draftDate}>
                      Draft: {new Date(league.draft_date).toLocaleDateString()}
                    </Text>
                  )}

                  {league.draft_status === 'completed' && league.league_type === 'matchup' && (
                    <Text style={styles.weekText}>Week {league.current_week}</Text>
                  )}

                  {isActive && (
                    <View style={styles.activeIndicator}>
                      <Text style={styles.activeText}>Currently viewing</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Tap + Create to start a new league
          </Text>
        </View>
      </ScrollView>

      {/* Create League Modal */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => { setShowCreateModal(false); resetForm(); }}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Create League</Text>
            <TouchableOpacity onPress={handleCreateLeague} disabled={creating}>
              {creating ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Text style={styles.modalCreate}>Create</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            {/* League Name */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>League Name</Text>
              <TextInput
                style={styles.input}
                value={leagueName}
                onChangeText={setLeagueName}
                placeholder="Enter league name"
                placeholderTextColor={Colors.textDark}
                autoCapitalize="words"
              />
            </View>

            {/* Draft Date */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Draft Date & Time</Text>
              <TouchableOpacity
                style={styles.input}
                onPress={() => setShowDatePicker(true)}
              >
                <Text style={draftDate ? styles.inputText : styles.inputPlaceholder}>
                  {draftDate ? draftDate.toLocaleString() : 'Select draft date & time'}
                </Text>
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker
                  value={draftDate || new Date()}
                  mode="datetime"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant="light"
                  onChange={(event, selectedDate) => {
                    setShowDatePicker(Platform.OS === 'ios');
                    if (selectedDate) setDraftDate(selectedDate);
                  }}
                  minimumDate={new Date()}
                />
              )}
              {Platform.OS === 'ios' && showDatePicker && (
                <TouchableOpacity
                  style={styles.datePickerDone}
                  onPress={() => setShowDatePicker(false)}
                >
                  <Text style={styles.datePickerDoneText}>Done</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Number of Teams */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Number of Teams</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => setNumTeams(Math.max(4, numTeams - 1))}
                >
                  <Text style={styles.stepperButtonText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{numTeams}</Text>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => setNumTeams(Math.min(16, numTeams + 1))}
                >
                  <Text style={styles.stepperButtonText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Stocks Per Team */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Stocks Per Team</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => setNumRounds(Math.max(1, numRounds - 1))}
                >
                  <Text style={styles.stepperButtonText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{numRounds}</Text>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => setNumRounds(Math.min(12, numRounds + 1))}
                >
                  <Text style={styles.stepperButtonText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Budget Mode */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Budget Mode</Text>
              <View style={styles.segmentedControl}>
                <TouchableOpacity
                  style={[styles.segment, budgetMode === 'budget' && styles.segmentActive]}
                  onPress={() => setBudgetMode('budget')}
                >
                  <Text style={[styles.segmentText, budgetMode === 'budget' && styles.segmentTextActive]}>
                    Salary Cap
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segment, budgetMode === 'no-budget' && styles.segmentActive]}
                  onPress={() => setBudgetMode('no-budget')}
                >
                  <Text style={[styles.segmentText, budgetMode === 'no-budget' && styles.segmentTextActive]}>
                    No Budget
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Budget Amount */}
            {budgetMode === 'budget' && (
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Salary Cap ($)</Text>
                <TextInput
                  style={styles.input}
                  value={budgetAmount}
                  onChangeText={setBudgetAmount}
                  placeholder="100000"
                  placeholderTextColor={Colors.textDark}
                  keyboardType="numeric"
                />
              </View>
            )}

            {/* League Type */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>League Type</Text>
              <View style={styles.segmentedControl}>
                <TouchableOpacity
                  style={[styles.segment, leagueType === 'duration' && styles.segmentActive]}
                  onPress={() => setLeagueType('duration')}
                >
                  <Text style={[styles.segmentText, leagueType === 'duration' && styles.segmentTextActive]}>
                    Duration
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segment, leagueType === 'matchup' && styles.segmentActive]}
                  onPress={() => setLeagueType('matchup')}
                >
                  <Text style={[styles.segmentText, leagueType === 'matchup' && styles.segmentTextActive]}>
                    Matchup
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.formHint}>
                {leagueType === 'duration'
                  ? 'Best portfolio wins at the end'
                  : 'Weekly head-to-head matchups'}
              </Text>
            </View>

            {/* Duration-specific: League Duration */}
            {leagueType === 'duration' && (
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>League Duration</Text>
                <View style={styles.optionList}>
                  {[
                    { value: 7, label: '1 Week' },
                    { value: 30, label: '1 Month' },
                    { value: 90, label: '3 Months' },
                    { value: 180, label: '6 Months' },
                    { value: 365, label: '1 Year' },
                  ].map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={[styles.optionItem, durationDays === option.value && styles.optionItemActive]}
                      onPress={() => setDurationDays(option.value)}
                    >
                      <Text style={[styles.optionText, durationDays === option.value && styles.optionTextActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Matchup-specific: Season Weeks & Playoff Teams */}
            {leagueType === 'matchup' && (
              <>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Season Length (Weeks)</Text>
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      style={styles.stepperButton}
                      onPress={() => setNumWeeks(Math.max(minWeeks, numWeeks - 1))}
                    >
                      <Text style={styles.stepperButtonText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{numWeeks}</Text>
                    <TouchableOpacity
                      style={styles.stepperButton}
                      onPress={() => setNumWeeks(numWeeks + 1)}
                    >
                      <Text style={styles.stepperButtonText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.formHint}>Min {minWeeks} weeks for round robin</Text>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Playoff Teams</Text>
                  <View style={styles.optionList}>
                    {validPlayoffOptions.map((option) => (
                      <TouchableOpacity
                        key={option}
                        style={[styles.optionItem, playoffTeams === option && styles.optionItemActive]}
                        onPress={() => setPlayoffTeams(option)}
                      >
                        <Text style={[styles.optionText, playoffTeams === option && styles.optionTextActive]}>
                          {option} teams
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* League Detail Modal */}
      <Modal
        visible={showDetailModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowDetailModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDetailModal(false)}>
              <Text style={styles.modalCancel}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{selectedLeague?.name || 'League'}</Text>
            <TouchableOpacity onPress={() => {
              if (selectedLeague) {
                setActiveLeagueId(selectedLeague.id);
                setShowDetailModal(false);
                router.push('/(tabs)');
              }
            }}>
              <Text style={styles.modalCreate}>View</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            {selectedLeague && (
              <>
                {/* Status Badge */}
                <View style={styles.detailStatusRow}>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusBadge(selectedLeague.draft_status).color + '20' }]}>
                    <Text style={[styles.statusText, { color: getStatusBadge(selectedLeague.draft_status).color }]}>
                      {getStatusBadge(selectedLeague.draft_status).text}
                    </Text>
                  </View>
                  {selectedLeague.commissioner_id === user?.id && (
                    <View style={[styles.statusBadge, { backgroundColor: '#a855f720' }]}>
                      <Text style={[styles.statusText, { color: '#a855f7' }]}>Commissioner</Text>
                    </View>
                  )}
                </View>

                {/* Quick Stats */}
                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Type</Text>
                    <Text style={styles.statValue}>
                      {selectedLeague.league_type === 'matchup' ? 'Matchup' : 'Duration'}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Teams</Text>
                    <Text style={styles.statValue}>{members.length} / {selectedLeague.num_participants}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Stocks</Text>
                    <Text style={styles.statValue}>{selectedLeague.num_rounds || 6}</Text>
                  </View>
                  {selectedLeague.league_type === 'matchup' && (
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>Week</Text>
                      <Text style={styles.statValue}>{selectedLeague.current_week || 1}</Text>
                    </View>
                  )}
                </View>

                {/* Action Buttons */}
                <View style={styles.detailActions}>
                  <TouchableOpacity
                    style={styles.detailActionBtn}
                    onPress={() => {
                      setActiveLeagueId(selectedLeague.id);
                      setShowDetailModal(false);
                      router.push('/(tabs)');
                    }}
                  >
                    <Text style={styles.detailActionText}>View Dashboard</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.detailActionBtn}
                    onPress={() => {
                      setActiveLeagueId(selectedLeague.id);
                      setShowDetailModal(false);
                      router.push('/(tabs)/league');
                    }}
                  >
                    <Text style={styles.detailActionText}>League</Text>
                  </TouchableOpacity>
                  {selectedLeague.commissioner_id === user?.id && (
                    <TouchableOpacity
                      style={[styles.detailActionBtn, styles.inviteBtn]}
                      onPress={shareInviteCode}
                    >
                      <Text style={styles.detailActionText}>Share Invite</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* League Info */}
                <View style={styles.detailCard}>
                  <Text style={styles.detailCardTitle}>League Info</Text>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Draft Date</Text>
                    <Text style={styles.detailValue}>{formatDate(selectedLeague.draft_date)}</Text>
                  </View>
                  {selectedLeague.league_type === 'matchup' && (
                    <>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Season Length</Text>
                        <Text style={styles.detailValue}>{selectedLeague.num_weeks} weeks</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Playoff Teams</Text>
                        <Text style={styles.detailValue}>{selectedLeague.playoff_teams || 4}</Text>
                      </View>
                    </>
                  )}
                  {selectedLeague.league_type === 'duration' && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Duration</Text>
                      <Text style={styles.detailValue}>
                        {selectedLeague.duration_days === 7 ? '1 Week' :
                         selectedLeague.duration_days === 30 ? '1 Month' :
                         selectedLeague.duration_days === 90 ? '3 Months' :
                         selectedLeague.duration_days === 180 ? '6 Months' :
                         selectedLeague.duration_days === 365 ? '1 Year' :
                         `${selectedLeague.duration_days} days`}
                      </Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Budget Mode</Text>
                    <Text style={styles.detailValue}>
                      {selectedLeague.budget_mode === 'budget'
                        ? `$${(selectedLeague.budget_amount || 100000).toLocaleString()}`
                        : 'No Budget'}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Invite Code</Text>
                    <Text style={styles.detailValue}>{selectedLeague.invite_code}</Text>
                  </View>
                </View>

                {/* Members */}
                <View style={styles.detailCard}>
                  <Text style={styles.detailCardTitle}>Members ({members.length})</Text>
                  {loadingMembers ? (
                    <ActivityIndicator color={Colors.primary} style={{ padding: 20 }} />
                  ) : members.length === 0 ? (
                    <Text style={styles.emptyMembersText}>No members yet</Text>
                  ) : (
                    members.map((member) => (
                      <View
                        key={member.user_id}
                        style={[
                          styles.memberRow,
                          member.user_id === user?.id && styles.memberRowHighlight
                        ]}
                      >
                        <Text style={styles.memberName}>
                          {member.display_name}
                          {member.user_id === user?.id && ' (You)'}
                        </Text>
                        {member.role === 'commissioner' && (
                          <View style={[styles.statusBadge, { backgroundColor: '#a855f720' }]}>
                            <Text style={[styles.statusText, { color: '#a855f7', fontSize: 10 }]}>
                              Commissioner
                            </Text>
                          </View>
                        )}
                      </View>
                    ))
                  )}
                </View>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.textPrimary,
  },
  section: {
    paddingHorizontal: 24,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 40,
  },
  emptyState: {
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
    textAlign: 'center',
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 100,
  },
  leagueCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  leagueCardActive: {
    borderColor: Colors.primary,
  },
  leagueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  leagueName: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  leagueDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  leagueDetail: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  draftDate: {
    fontSize: 13,
    color: Colors.warning,
    marginTop: 8,
  },
  weekText: {
    fontSize: 13,
    color: Colors.primaryLight,
    marginTop: 8,
  },
  activeIndicator: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  activeText: {
    fontSize: 12,
    color: Colors.primaryLight,
  },
  footer: {
    padding: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 13,
    color: Colors.textDark,
  },
  createButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  createButtonText: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  joinButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  joinButtonText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  modalCancel: {
    fontSize: 16,
    color: Colors.textMuted,
  },
  modalCreate: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primary,
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  formGroup: {
    marginBottom: 24,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  formHint: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 6,
  },
  input: {
    backgroundColor: Colors.cardBg,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: Colors.cardBg,
    borderRadius: 10,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: Colors.primary,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  segmentTextActive: {
    color: Colors.textPrimary,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: {
    fontSize: 24,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  stepperValue: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginHorizontal: 32,
    minWidth: 40,
    textAlign: 'center',
  },
  inputText: {
    fontSize: 16,
    color: Colors.textPrimary,
  },
  inputPlaceholder: {
    fontSize: 16,
    color: Colors.textDark,
  },
  datePickerDone: {
    alignItems: 'flex-end',
    paddingVertical: 8,
  },
  datePickerDoneText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primary,
  },
  optionList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionItemActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  optionTextActive: {
    color: Colors.textPrimary,
  },
  // Detail modal styles
  detailStatusRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.cardBg,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  detailActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  detailActionBtn: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  inviteBtn: {
    backgroundColor: Colors.success,
  },
  detailActionText: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  detailCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  detailLabel: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  detailValue: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: Colors.background,
    borderRadius: 8,
    marginBottom: 6,
  },
  memberRowHighlight: {
    backgroundColor: '#1e3a5f',
  },
  memberName: {
    fontSize: 14,
    color: Colors.textPrimary,
    flex: 1,
  },
  emptyMembersText: {
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: 20,
  },
});
