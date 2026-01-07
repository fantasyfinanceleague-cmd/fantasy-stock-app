import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useState, useEffect, useCallback } from 'react';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';

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

      if (memberData?.length) {
        // Fetch profiles
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, username')
          .in('id', memberData.map(m => m.user_id));

        const profileMap = new Map(profiles?.map(p => [p.id, p.username]) || []);

        const membersWithNames = memberData.map(m => ({
          ...m,
          display_name: m.user_id.startsWith('bot-')
            ? `Bot ${m.user_id.replace('bot-', '')}`
            : profileMap.get(m.user_id) || m.user_id.substring(0, 8) + '...'
        }));

        setMembers(membersWithNames);
        setDraftOrder(memberData.map(m => m.user_id));
      }

      // Fetch picks
      const { data: pickData } = await supabase
        .from('drafts')
        .select('id, user_id, symbol, entry_price, round, pick_number, created_at')
        .eq('league_id', activeLeagueId)
        .order('pick_number', { ascending: true });

      if (pickData) {
        // Add display names to picks
        const picksWithNames = pickData.map(p => {
          const member = members.find(m => m.user_id === p.user_id);
          return {
            ...p,
            display_name: p.user_id.startsWith('bot-')
              ? `Bot ${p.user_id.replace('bot-', '')}`
              : member?.display_name || p.user_id.substring(0, 8) + '...'
          };
        });
        setPicks(picksWithNames);
      }
    } catch (e) {
      console.error('Failed to fetch draft data:', e);
    } finally {
      setLoading(false);
    }
  }, [activeLeagueId, members]);

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
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No league selected</Text>
          <Text style={styles.emptySubtitle}>Select a league from the Leagues tab</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isDraftNotStarted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.pendingIcon}>⏰</Text>
          <Text style={styles.emptyTitle}>Draft Not Started</Text>
          <Text style={styles.emptySubtitle}>
            {activeLeague.draft_date
              ? `Scheduled for ${new Date(activeLeague.draft_date).toLocaleString()}`
              : 'Waiting for commissioner to start'}
          </Text>
          <Text style={styles.hint}>
            The commissioner can start the draft from the website
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isDraftCompleted) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Draft Complete</Text>
            <Text style={styles.subtitle}>{activeLeague.name}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Picks</Text>
            {picks.filter(p => p.user_id === user?.id).map((pick) => (
              <View key={pick.id} style={styles.pickRow}>
                <View>
                  <Text style={styles.pickSymbol}>{pick.symbol}</Text>
                  <Text style={styles.pickRound}>Round {pick.round}</Text>
                </View>
                <Text style={styles.pickPrice}>${pick.entry_price.toFixed(2)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>All Picks ({picks.length})</Text>
            {[...picks].reverse().slice(0, 20).map((pick) => (
              <View key={pick.id} style={styles.historyRow}>
                <Text style={styles.historyPick}>#{pick.pick_number}</Text>
                <Text style={styles.historyName}>{pick.display_name}</Text>
                <Text style={styles.historySymbol}>{pick.symbol}</Text>
                <Text style={styles.historyPrice}>${pick.entry_price.toFixed(2)}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Draft</Text>
          <Text style={styles.subtitle}>{activeLeague.name}</Text>
        </View>

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
});
