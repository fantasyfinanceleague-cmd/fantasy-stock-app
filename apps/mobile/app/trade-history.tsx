import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { router } from 'expo-router';
import { useState, useEffect } from 'react';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';

interface Trade {
  id: string;
  user_id: string;
  symbol: string;
  action: 'buy' | 'sell';
  quantity: number;
  price: number;
  total_value: number;
  created_at: string;
}

type FilterType = 'all' | 'mine' | 'buys' | 'sells';

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function TradeHistoryScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { activeLeagueId, activeLeague } = useLeagueContext();

  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');

  const fetchTrades = async () => {
    if (!activeLeagueId) {
      setTrades([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .eq('league_id', activeLeagueId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTrades(data || []);
    } catch (e) {
      console.error('Error fetching trades:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrades();
  }, [activeLeagueId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTrades();
    setRefreshing(false);
  };

  // Filter trades based on selected filter
  const filteredTrades = trades.filter(trade => {
    if (filter === 'mine') return trade.user_id === user?.id;
    if (filter === 'buys') return trade.action === 'buy';
    if (filter === 'sells') return trade.action === 'sell';
    return true; // 'all'
  });

  const FilterButton = ({ type, label }: { type: FilterType; label: string }) => (
    <TouchableOpacity
      style={[styles.filterButton, filter === type && styles.filterButtonActive]}
      onPress={() => setFilter(type)}
    >
      <Text style={[styles.filterButtonText, filter === type && styles.filterButtonTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Trade History</Text>
        <View style={styles.backButton} />
      </View>

      {/* League Name */}
      {activeLeague && (
        <Text style={styles.leagueName}>{activeLeague.name}</Text>
      )}

      {/* Filter Buttons */}
      <View style={styles.filterRow}>
        <FilterButton type="all" label="All" />
        <FilterButton type="mine" label="My Trades" />
        <FilterButton type="buys" label="Buys" />
        <FilterButton type="sells" label="Sells" />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {loading ? (
          <View style={styles.centered}>
            <Text style={styles.loadingText}>Loading trades...</Text>
          </View>
        ) : filteredTrades.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>No trades yet</Text>
            <Text style={styles.emptySubtitle}>
              {filter === 'all'
                ? 'Start trading to see your history here!'
                : `No ${filter === 'mine' ? 'trades by you' : filter} found.`}
            </Text>
          </View>
        ) : (
          filteredTrades.map((trade) => {
            const isMine = trade.user_id === user?.id;
            const isBuy = trade.action === 'buy';

            return (
              <View
                key={trade.id}
                style={[styles.tradeRow, isMine && styles.tradeRowMine]}
              >
                <View style={styles.tradeLeft}>
                  <View style={styles.tradeHeader}>
                    <Text style={styles.tradeSymbol}>{trade.symbol}</Text>
                    <View style={[styles.actionBadge, isBuy ? styles.buyBadge : styles.sellBadge]}>
                      <Text style={[styles.actionText, isBuy ? styles.buyText : styles.sellText]}>
                        {isBuy ? 'BUY' : 'SELL'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.tradeDetails}>
                    {trade.quantity} shares @ ${formatCurrency(trade.price)}
                  </Text>
                  <Text style={styles.tradeDate}>
                    {formatDate(trade.created_at)} at {formatTime(trade.created_at)}
                    {isMine && <Text style={styles.youLabel}> • You</Text>}
                  </Text>
                </View>
                <View style={styles.tradeRight}>
                  <Text style={[styles.tradeTotal, isBuy ? styles.negative : styles.positive]}>
                    {isBuy ? '-' : '+'}${formatCurrency(trade.total_value)}
                  </Text>
                </View>
              </View>
            );
          })
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  leagueName: {
    fontSize: 14,
    color: Colors.primaryLight,
    textAlign: 'center',
    paddingVertical: 8,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  filterButtonTextActive: {
    color: Colors.textPrimary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  tradeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tradeRowMine: {
    borderColor: Colors.primaryLight,
    borderWidth: 1,
  },
  tradeLeft: {
    flex: 1,
  },
  tradeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  tradeSymbol: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  buyBadge: {
    backgroundColor: Colors.successBg,
  },
  sellBadge: {
    backgroundColor: Colors.errorBg,
  },
  actionText: {
    fontSize: 11,
    fontWeight: '700',
  },
  buyText: {
    color: Colors.success,
  },
  sellText: {
    color: Colors.error,
  },
  tradeDetails: {
    fontSize: 13,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  tradeDate: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  youLabel: {
    color: Colors.primaryLight,
  },
  tradeRight: {
    alignItems: 'flex-end',
  },
  tradeTotal: {
    fontSize: 16,
    fontWeight: '600',
  },
  positive: {
    color: Colors.success,
  },
  negative: {
    color: Colors.error,
  },
});
