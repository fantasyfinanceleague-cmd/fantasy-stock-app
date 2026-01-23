import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useState, useEffect, useCallback } from 'react';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import LeagueSwitcher from '@/components/LeagueSwitcher';
import { notifyDraftTurn } from '@/lib/notifications';

interface DraftPick {
  id: string;
  user_id: string;
  symbol: string;
  entry_price: number;
  round: number;
  pick_number: number;
  created_at: string;
  display_name?: string;
}

interface LeagueMember {
  user_id: string;
  role: string;
  display_name?: string;
}

export default function DraftScreen() {
  const { user } = useAuth();
  const { activeLeagueId, activeLeague, refresh: refreshLeagues } = useLeagueContext();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);

  // Stock search
  const [searchSymbol, setSearchSymbol] = useState('');
  const [quote, setQuote] = useState<{ symbol: string; price: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Completed draft view state
  const [selectedRound, setSelectedRound] = useState(1);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // Derived state
  const numRounds = activeLeague?.num_rounds || 6;
  const totalPicks = draftOrder.length * numRounds;
  const currentPickNumber = picks.length + 1;
  const currentRound = Math.ceil(currentPickNumber / draftOrder.length) || 1;
  const pickInRound = ((currentPickNumber - 1) % draftOrder.length);

  // Snake draft: odd rounds go forward, even rounds go backward
  const isReverseRound = currentRound % 2 === 0;
  const orderForRound = isReverseRound ? [...draftOrder].reverse() : draftOrder;
  const currentPickerIndex = pickInRound;
  const currentPicker = orderForRound[currentPickerIndex];

  const isMyTurn = currentPicker === user?.id;
  const isDraftComplete = picks.length >= totalPicks;
  const isDraftStarted = activeLeague?.draft_status === 'in_progress';
  const isDraftNotStarted = activeLeague?.draft_status === 'not_started';
  const isDraftCompleted = activeLeague?.draft_status === 'completed';

  // Budget tracking
  const isBudgetMode = activeLeague?.budget_mode === 'budget';
  const leagueBudget = activeLeague?.budget_amount || 100000;
  const mySpent = picks
    .filter(p => p.user_id === user?.id)
    .reduce((sum, p) => sum + (p.entry_price || 0), 0);
  const budgetRemaining = leagueBudget - mySpent;

  // Fetch draft data
  const fetchDraftData = useCallback(async () => {
    if (!activeLeagueId) return;

    try {
      // Fetch members
      const { data: memberData } = await supabase
        .from('league_members')
        .select('user_id, role')
        .eq('league_id', activeLeagueId)
        .order('joined_at', { ascending: true });

      // Fetch profiles
      const userIds = (memberData || []).map(m => m.user_id).filter(id => !id.startsWith('bot-'));

      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, username')
        .in('id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p.username]) || []);

      const membersWithNames = (memberData || []).map(m => ({
        ...m,
        display_name: m.user_id.startsWith('bot-')
          ? `Bot ${m.user_id.replace('bot-', '')}`
          : profileMap.get(m.user_id) || m.user_id.substring(0, 8) + '...'
      }));

      setMembers(membersWithNames);
      setDraftOrder((memberData || []).map(m => m.user_id));

      // Fetch picks
      const { data: pickData } = await supabase
        .from('drafts')
        .select('id, user_id, symbol, entry_price, round, pick_number, created_at')
        .eq('league_id', activeLeagueId)
        .order('pick_number', { ascending: true });

      if (pickData) {
        // Add display names to picks using the freshly fetched members
        const picksWithNames = pickData.map(p => {
          const member = membersWithNames.find(m => m.user_id === p.user_id);
          return {
            ...p,
            display_name: p.user_id.startsWith('bot-')
              ? `Bot ${p.user_id.replace('bot-', '')}`
              : member?.display_name || profileMap.get(p.user_id) || p.user_id.substring(0, 8) + '...'
          };
        });
        setPicks(picksWithNames);
      }
    } catch (e) {
      console.error('Failed to fetch draft data:', e);
    } finally {
      setLoading(false);
    }
  }, [activeLeagueId]);

  // Initial load and refresh
  useEffect(() => {
    fetchDraftData();
  }, [fetchDraftData]);

  // Real-time subscription for picks
  useEffect(() => {
    if (!activeLeagueId) return;

    const channel = supabase
      .channel(`drafts:${activeLeagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'drafts',
          filter: `league_id=eq.${activeLeagueId}`
        },
        (payload) => {
          const newPick = payload.new as DraftPick;
          setPicks(prev => [...prev, {
            ...newPick,
            display_name: newPick.user_id.startsWith('bot-')
              ? `Bot ${newPick.user_id.replace('bot-', '')}`
              : members.find(m => m.user_id === newPick.user_id)?.display_name || newPick.user_id.substring(0, 8) + '...'
          }]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeLeagueId, members]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchDraftData(), refreshLeagues()]);
    setRefreshing(false);
  };

  // Search for stock quote
  const searchStock = async () => {
    const sym = searchSymbol.trim().toUpperCase();
    if (!sym) return;

    // Check if already picked
    if (picks.some(p => p.symbol.toUpperCase() === sym)) {
      Alert.alert('Error', `${sym} has already been drafted`);
      return;
    }

    setSearching(true);
    setQuote(null);

    try {
      const { data, error } = await supabase.functions.invoke('quote', {
        body: { symbol: sym }
      });

      if (error || data?.error) {
        Alert.alert('Error', data?.error || 'Failed to fetch quote');
        return;
      }

      const price = Number(data?.price);
      if (!Number.isFinite(price)) {
        Alert.alert('Error', 'Invalid price returned');
        return;
      }

      // Check budget
      if (isBudgetMode && price > budgetRemaining) {
        Alert.alert('Error', `Not enough budget. ${sym} costs $${price.toFixed(2)} but you only have $${budgetRemaining.toFixed(2)} remaining.`);
        return;
      }

      setQuote({ symbol: data?.symbol || sym, price });
    } catch (e) {
      Alert.alert('Error', 'Failed to fetch quote');
    } finally {
      setSearching(false);
    }
  };

  // Submit pick
  const submitPick = async () => {
    if (!quote || !user?.id || !activeLeagueId) return;

    // Double-check it's still my turn
    if (!isMyTurn) {
      Alert.alert('Error', "It's not your turn");
      return;
    }

    setSubmitting(true);

    try {
      const { error } = await supabase
        .from('drafts')
        .insert({
          league_id: activeLeagueId,
          user_id: user.id,
          symbol: quote.symbol,
          entry_price: quote.price,
          quantity: 1,
          round: currentRound,
          pick_number: currentPickNumber,
          draft_date: new Date().toISOString(),
        });

      if (error) throw error;

      // Clear search
      setSearchSymbol('');
      setQuote(null);

      // Check if draft is complete
      if (currentPickNumber >= totalPicks) {
        // Update league draft status
        await supabase
          .from('leagues')
          .update({ draft_status: 'completed' })
          .eq('id', activeLeagueId);

        await refreshLeagues();
        Alert.alert('Draft Complete!', 'The draft has finished. Good luck!');
      } else {
        // Notify the next player it's their turn
        const nextPickNumber = currentPickNumber + 1;
        const nextRound = Math.ceil(nextPickNumber / draftOrder.length);
        const nextPickInRound = ((nextPickNumber - 1) % draftOrder.length);
        const isNextRoundReverse = nextRound % 2 === 0;
        const nextOrderForRound = isNextRoundReverse ? [...draftOrder].reverse() : draftOrder;
        const nextPicker = nextOrderForRound[nextPickInRound];

        // Only notify if it's a real user (not a bot) and not the current user
        if (nextPicker && !nextPicker.startsWith('bot-') && nextPicker !== user?.id) {
          notifyDraftTurn(nextPicker, activeLeague?.name || 'your league');
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to submit pick');
    } finally {
      setSubmitting(false);
    }
  };

  const getPickerName = (userId: string) => {
    if (userId.startsWith('bot-')) return `Bot ${userId.replace('bot-', '')}`;
    const member = members.find(m => m.user_id === userId);
    return member?.display_name || userId.substring(0, 8) + '...';
  };

  if (!activeLeagueId || !activeLeague) {
    return (
      <SafeAreaView style={styles.container}>
        <LeagueSwitcher />
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No league selected</Text>
          <Text style={styles.emptySubtitle}>Select a league from Home</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isDraftNotStarted) {
    const hasDraftDate = activeLeague.draft_date != null;
    return (
      <SafeAreaView style={styles.container}>
        <LeagueSwitcher />
        <View style={styles.centered}>
          <Text style={styles.pendingIcon}>⏰</Text>
          <Text style={styles.emptyTitle}>Draft Not Started</Text>
          <Text style={styles.emptySubtitle}>
            {hasDraftDate
              ? `Scheduled for ${new Date(activeLeague.draft_date).toLocaleString()}`
              : 'Draft date not set yet'}
          </Text>
          <Text style={styles.hint}>
            {hasDraftDate
              ? 'The commissioner can start the draft from the website'
              : 'The commissioner needs to set a draft date before the draft can begin'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isDraftCompleted) {
    const myPicks = picks.filter(p => p.user_id === user?.id);
    const myTotalValue = myPicks.reduce((sum, p) => sum + p.entry_price, 0);

    // Calculate team count from actual picks (number of unique users who drafted)
    const uniqueDrafters = [...new Set(picks.map(p => p.user_id))];
    const teamCount = uniqueDrafters.length || members.length;

    // Group picks by user for team rosters
    const teamRosters = members.map(member => ({
      userId: member.user_id,
      displayName: member.display_name || 'Unknown',
      picks: picks.filter(p => p.user_id === member.user_id).sort((a, b) => a.pick_number - b.pick_number),
      totalValue: picks.filter(p => p.user_id === member.user_id).reduce((sum, p) => sum + p.entry_price, 0)
    })).sort((a, b) => b.totalValue - a.totalValue);

    return (
      <SafeAreaView style={styles.container}>
        <LeagueSwitcher />

        <ScrollView
          style={styles.scrollView}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          {/* Completion Header */}
          <View style={styles.completionHeader}>
            <Text style={styles.completionIcon}>🏆</Text>
            <Text style={styles.completionTitle}>Draft Complete!</Text>
          </View>

          {/* Summary Stats */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{teamCount}</Text>
                <Text style={styles.summaryLabel}>Teams</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{picks.length}</Text>
                <Text style={styles.summaryLabel}>Total Picks</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{numRounds}</Text>
                <Text style={styles.summaryLabel}>Rounds</Text>
              </View>
            </View>
          </View>

          {/* Your Team */}
          <View style={styles.section}>
            <View style={styles.yourTeamHeader}>
              <Text style={styles.sectionTitle}>Your Team</Text>
              <Text style={styles.teamValue}>${myTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            </View>
            <View style={styles.yourTeamCard}>
              {myPicks.sort((a, b) => a.pick_number - b.pick_number).map((pick, index) => {
                const calculatedRound = Math.ceil(pick.pick_number / teamCount);
                return (
                  <View key={pick.id} style={[styles.yourPickRow, index < myPicks.length - 1 && styles.yourPickBorder]}>
                    <View style={styles.pickRoundBadge}>
                      <Text style={styles.pickRoundBadgeText}>R{calculatedRound}</Text>
                    </View>
                    <Text style={styles.yourPickSymbol}>{pick.symbol}</Text>
                    <Text style={styles.yourPickPrice}>${pick.entry_price.toFixed(2)}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Draft by Round */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Draft by Round</Text>
            <View style={styles.dropdownContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dropdownScroll}>
                {Array.from({ length: numRounds }, (_, i) => i + 1).map((round) => (
                  <TouchableOpacity
                    key={round}
                    style={[styles.dropdownChip, selectedRound === round && styles.dropdownChipActive]}
                    onPress={() => setSelectedRound(round)}
                  >
                    <Text style={[styles.dropdownChipText, selectedRound === round && styles.dropdownChipTextActive]}>
                      Round {round}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <View style={styles.roundPicksCard}>
              {picks
                .filter(p => {
                  // Calculate round from pick_number instead of using stored round
                  const calculatedRound = Math.ceil(p.pick_number / teamCount);
                  return calculatedRound === selectedRound;
                })
                .sort((a, b) => a.pick_number - b.pick_number)
                .map((pick, index, filteredPicks) => {
                  const pickInRound = index + 1;
                  return (
                    <View key={pick.id} style={[styles.roundPickRow, index < filteredPicks.length - 1 && styles.roundPickBorder]}>
                      <Text style={styles.roundPickOrder}>{pickInRound}</Text>
                      <View style={styles.roundPickInfo}>
                        <Text style={styles.roundPickName}>
                          {pick.display_name || getPickerName(pick.user_id)}
                          {pick.user_id === user?.id && <Text style={styles.youBadge}> (You)</Text>}
                        </Text>
                      </View>
                      <Text style={styles.roundPickSymbol}>{pick.symbol}</Text>
                      <Text style={styles.roundPickPrice}>${pick.entry_price.toFixed(2)}</Text>
                    </View>
                  );
                })}
            </View>
          </View>

          {/* View Other Teams */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>View Team</Text>
            <View style={styles.dropdownContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dropdownScroll}>
                {teamRosters.filter(t => t.userId !== user?.id).map((team) => (
                  <TouchableOpacity
                    key={team.userId}
                    style={[styles.dropdownChip, selectedTeamId === team.userId && styles.dropdownChipActive]}
                    onPress={() => setSelectedTeamId(selectedTeamId === team.userId ? null : team.userId)}
                  >
                    <Text style={[styles.dropdownChipText, selectedTeamId === team.userId && styles.dropdownChipTextActive]}>
                      {team.displayName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            {selectedTeamId && (
              <View style={styles.teamDetailCard}>
                {(() => {
                  const team = teamRosters.find(t => t.userId === selectedTeamId);
                  if (!team) return null;
                  return (
                    <>
                      <View style={styles.teamDetailHeader}>
                        <Text style={styles.teamDetailName}>{team.displayName}</Text>
                        <Text style={styles.teamDetailValue}>${team.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                      </View>
                      {team.picks.sort((a, b) => a.pick_number - b.pick_number).map((pick, index) => {
                        const calculatedRound = Math.ceil(pick.pick_number / teamCount);
                        return (
                          <View key={pick.id} style={[styles.teamDetailRow, index < team.picks.length - 1 && styles.teamDetailBorder]}>
                            <View style={styles.pickRoundBadge}>
                              <Text style={styles.pickRoundBadgeText}>R{calculatedRound}</Text>
                            </View>
                            <Text style={styles.teamDetailSymbol}>{pick.symbol}</Text>
                            <Text style={styles.teamDetailPrice}>${pick.entry_price.toFixed(2)}</Text>
                          </View>
                        );
                      })}
                    </>
                  );
                })()}
              </View>
            )}
            {!selectedTeamId && (
              <View style={styles.selectTeamPrompt}>
                <Text style={styles.selectTeamText}>Select a team above to view their picks</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Sticky League Switcher Header */}
      <LeagueSwitcher />

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >

        {loading ? (
          <ActivityIndicator color={Colors.primary} size="large" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Draft Status */}
            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                <View style={styles.statusItem}>
                  <Text style={styles.statusLabel}>Round</Text>
                  <Text style={styles.statusValue}>{currentRound}/{numRounds}</Text>
                </View>
                <View style={styles.statusItem}>
                  <Text style={styles.statusLabel}>Pick</Text>
                  <Text style={styles.statusValue}>{currentPickNumber}/{totalPicks}</Text>
                </View>
                {isBudgetMode && (
                  <View style={styles.statusItem}>
                    <Text style={styles.statusLabel}>Budget</Text>
                    <Text style={styles.statusValue}>${budgetRemaining.toLocaleString()}</Text>
                  </View>
                )}
              </View>

              <View style={styles.turnIndicator}>
                {isMyTurn ? (
                  <Text style={styles.yourTurn}>🎯 Your Turn!</Text>
                ) : (
                  <Text style={styles.waitingTurn}>
                    Waiting for {getPickerName(currentPicker || '')}
                  </Text>
                )}
              </View>
            </View>

            {/* Stock Search (only show if it's my turn) */}
            {isMyTurn && (
              <View style={styles.searchCard}>
                <Text style={styles.searchTitle}>Search Stock</Text>
                <View style={styles.searchRow}>
                  <TextInput
                    style={styles.searchInput}
                    value={searchSymbol}
                    onChangeText={setSearchSymbol}
                    placeholder="Enter symbol (e.g. AAPL)"
                    placeholderTextColor={Colors.textDark}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    onSubmitEditing={searchStock}
                  />
                  <TouchableOpacity
                    style={styles.searchBtn}
                    onPress={searchStock}
                    disabled={searching || !searchSymbol.trim()}
                  >
                    {searching ? (
                      <ActivityIndicator color={Colors.textPrimary} size="small" />
                    ) : (
                      <Text style={styles.searchBtnText}>Search</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {quote && (
                  <View style={styles.quoteCard}>
                    <View style={styles.quoteInfo}>
                      <Text style={styles.quoteSymbol}>{quote.symbol}</Text>
                      <Text style={styles.quotePrice}>${quote.price.toFixed(2)}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.draftBtn}
                      onPress={submitPick}
                      disabled={submitting}
                    >
                      {submitting ? (
                        <ActivityIndicator color={Colors.textPrimary} size="small" />
                      ) : (
                        <Text style={styles.draftBtnText}>Draft {quote.symbol}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* Draft Order */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Draft Order (Round {currentRound})</Text>
              {orderForRound.map((userId, idx) => {
                const isCurrent = idx === currentPickerIndex;
                const hasPicked = idx < currentPickerIndex;
                return (
                  <View
                    key={userId}
                    style={[
                      styles.orderRow,
                      isCurrent && styles.orderRowCurrent,
                      hasPicked && styles.orderRowDone
                    ]}
                  >
                    <Text style={styles.orderNumber}>{idx + 1}</Text>
                    <Text style={[styles.orderName, isCurrent && styles.orderNameCurrent]}>
                      {getPickerName(userId)}
                      {userId === user?.id && ' (You)'}
                    </Text>
                    {hasPicked && <Text style={styles.orderCheck}>✓</Text>}
                    {isCurrent && <Text style={styles.orderArrow}>◀</Text>}
                  </View>
                );
              })}
            </View>

            {/* Recent Picks */}
            {picks.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recent Picks</Text>
                {[...picks].reverse().slice(0, 10).map((pick) => (
                  <View key={pick.id} style={styles.historyRow}>
                    <Text style={styles.historyPick}>#{pick.pick_number}</Text>
                    <Text style={styles.historyName}>{pick.display_name}</Text>
                    <Text style={styles.historySymbol}>{pick.symbol}</Text>
                    <Text style={styles.historyPrice}>${pick.entry_price.toFixed(2)}</Text>
                  </View>
                ))}
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.primaryLight,
    marginTop: 4,
  },
  pendingIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: 16,
  },
  hint: {
    fontSize: 12,
    color: Colors.textDark,
    textAlign: 'center',
  },
  statusCard: {
    marginHorizontal: 24,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statusItem: {
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  turnIndicator: {
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  yourTurn: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.success,
  },
  waitingTurn: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  searchCard: {
    marginHorizontal: 24,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: Colors.success,
    marginBottom: 16,
  },
  searchTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 10,
  },
  searchInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    borderRadius: 8,
    justifyContent: 'center',
  },
  searchBtnText: {
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  quoteCard: {
    marginTop: 16,
    padding: 16,
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quoteInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  quoteSymbol: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  quotePrice: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.success,
  },
  draftBtn: {
    backgroundColor: Colors.success,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  draftBtnText: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  orderRowCurrent: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  orderRowDone: {
    opacity: 0.5,
  },
  orderNumber: {
    width: 24,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  orderName: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  orderNameCurrent: {
    fontWeight: '600',
    color: Colors.success,
  },
  orderCheck: {
    color: Colors.success,
    fontWeight: '600',
  },
  orderArrow: {
    color: Colors.success,
    fontWeight: '600',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: Colors.cardBg,
    borderRadius: 8,
    marginBottom: 6,
  },
  historyPick: {
    width: 36,
    fontSize: 12,
    color: Colors.textMuted,
  },
  historyName: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  historySymbol: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primaryLight,
    marginRight: 12,
  },
  historyPrice: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  pickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: Colors.cardBg,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pickSymbol: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  pickRound: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  pickPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.success,
  },
  // Completion screen styles
  completionHeader: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  completionIcon: {
    fontSize: 56,
    marginBottom: 12,
  },
  completionTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  completionLeague: {
    fontSize: 16,
    color: Colors.primaryLight,
  },
  summaryCard: {
    marginHorizontal: 24,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 24,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  summaryLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  yourTeamHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  teamValue: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.success,
  },
  yourTeamCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.primary,
    overflow: 'hidden',
  },
  yourPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  yourPickBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pickRoundBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 12,
  },
  pickRoundBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  yourPickSymbol: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  yourPickPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  teamCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  teamHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  teamNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  teamRank: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
    marginRight: 8,
    width: 28,
  },
  teamName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  youBadge: {
    color: Colors.primaryLight,
    fontWeight: '400',
  },
  teamTotal: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.success,
  },
  teamPicks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  teamPickChip: {
    backgroundColor: Colors.background,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  teamPickText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primaryLight,
  },
  // Dropdown styles
  dropdownContainer: {
    marginBottom: 12,
  },
  dropdownScroll: {
    flexGrow: 0,
  },
  dropdownChip: {
    backgroundColor: Colors.cardBg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dropdownChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dropdownChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  dropdownChipTextActive: {
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  // Round picks styles
  roundPicksCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  roundPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  roundPickBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  roundPickOrder: {
    width: 24,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  roundPickInfo: {
    flex: 1,
  },
  roundPickName: {
    fontSize: 14,
    color: Colors.textPrimary,
  },
  roundPickSymbol: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primaryLight,
    marginRight: 12,
    minWidth: 50,
    textAlign: 'right',
  },
  roundPickPrice: {
    fontSize: 14,
    color: Colors.textMuted,
    minWidth: 70,
    textAlign: 'right',
  },
  // Team detail styles
  teamDetailCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  teamDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  teamDetailName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  teamDetailValue: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.success,
  },
  teamDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  teamDetailBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  teamDetailSymbol: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  teamDetailPrice: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  selectTeamPrompt: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  selectTeamText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
});
