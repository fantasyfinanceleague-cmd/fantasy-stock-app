import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { usePortfolio, Holding } from '@/lib/usePortfolio';
import { useStockNames, abbreviateName } from '@/lib/useStockNames';
import { router } from 'expo-router';
import { useState, useMemo } from 'react';
import { SkeletonHolding } from '@/components/Skeleton';
import { Colors } from '@/constants/Colors';
import LeagueSwitcher from '@/components/LeagueSwitcher';
import TradeModal from '@/components/TradeModal';
import PLBreakdownModal from '@/components/PLBreakdownModal';
import { Ionicons } from '@expo/vector-icons';

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number | null): string {
  if (value === null) return '--';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function HoldingRow({ holding, companyName, onBuy, onSell }: { holding: Holding; companyName?: string; onBuy: () => void; onSell: () => void }) {
  const hasPrice = holding.currentPrice !== null;
  const dayChange = holding.dayChangePercent ?? 0;
  const isDayPositive = dayChange >= 0;

  return (
    <View style={styles.holdingRow}>
      <View style={styles.holdingMain}>
        <View style={styles.holdingLeft}>
          <Text style={styles.holdingSymbol}>{holding.symbol}</Text>
          {companyName && (
            <Text style={styles.holdingName} numberOfLines={1}>{abbreviateName(companyName, 24)}</Text>
          )}
          <Text style={styles.holdingQty}>{holding.quantity} shares</Text>
        </View>

        <View style={styles.holdingRight}>
          {hasPrice ? (
            <>
              <Text style={styles.holdingValue}>${formatCurrency(holding.currentValue!)}</Text>
              <View style={[styles.dayChangeBadge, isDayPositive ? styles.positiveBg : styles.negativeBg]}>
                <Ionicons
                  name={isDayPositive ? 'trending-up' : 'trending-down'}
                  size={12}
                  color={isDayPositive ? Colors.success : Colors.error}
                />
                <Text style={[styles.dayChangeText, isDayPositive ? styles.positive : styles.negative]}>
                  {isDayPositive ? '+' : ''}{dayChange.toFixed(2)}%
                </Text>
              </View>
            </>
          ) : (
            <Text style={styles.holdingValue}>${formatCurrency(holding.totalCost)}</Text>
          )}
        </View>
      </View>

      <View style={styles.holdingActions}>
        <TouchableOpacity style={[styles.actionBtn, styles.buyBtn]} onPress={onBuy}>
          <Text style={styles.actionBtnText}>Buy</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.sellBtn]} onPress={onSell}>
          <Text style={styles.actionBtnText}>Sell</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function PortfolioScreen() {
  const { user, loading: authLoading } = useAuth();
  const { leagues, activeLeagueId, activeLeague, refresh: refreshLeagues } = useLeagueContext();
  const { holdings, drafts, trades, portfolioSummary, loading: portfolioLoading, refresh: refreshPortfolio } = usePortfolio(activeLeagueId);
  const [refreshing, setRefreshing] = useState(false);

  // Get all symbols for name fetching (current holdings + closed positions)
  const allSymbols = useMemo(() => {
    const holdingSymbols = holdings.map(h => h.symbol);
    const draftSymbols = drafts.map(d => d.symbol);
    const tradeSymbols = trades.map(t => t.symbol);
    return [...new Set([...holdingSymbols, ...draftSymbols, ...tradeSymbols])];
  }, [holdings, drafts, trades]);

  const { names: stockNames } = useStockNames(allSymbols);

  // Trade modal state
  const [tradeModalVisible, setTradeModalVisible] = useState(false);
  const [tradeSymbol, setTradeSymbol] = useState('');
  const [tradeAction, setTradeAction] = useState<'buy' | 'sell'>('buy');

  // P/L breakdown modal state
  const [plModalVisible, setPlModalVisible] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshLeagues(), refreshPortfolio()]);
    setRefreshing(false);
  };

  const openTradeModal = (symbol: string = '', action: 'buy' | 'sell' = 'buy') => {
    setTradeSymbol(symbol);
    setTradeAction(action);
    setTradeModalVisible(true);
  };

  const handleTradeComplete = async () => {
    // Refresh portfolio after successful trade
    await refreshPortfolio();
  };

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
          <Text style={styles.emptyTitle}>Sign in to view portfolio</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.push('/login')}>
            <Text style={styles.buttonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const budgetRemaining = activeLeague?.budget_mode === 'budget' && activeLeague?.budget_amount
    ? Math.max((activeLeague.budget_amount || 0) - portfolioSummary.totalCost, 0)
    : null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Sticky League Switcher Header */}
      <LeagueSwitcher />

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >

        {leagues.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>No leagues yet</Text>
            <Text style={styles.emptySubtitle}>Join a league to start building your portfolio</Text>
            <TouchableOpacity style={styles.button} onPress={() => router.push('/(tabs)/leagues')}>
              <Text style={styles.buttonText}>View Leagues</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.metricsRow}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Portfolio Value</Text>
                <Text style={styles.metricValue}>${formatCurrency(portfolioSummary.totalValue)}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Budget Left</Text>
                <Text style={styles.metricValue}>{budgetRemaining !== null ? `$${formatCurrency(budgetRemaining)}` : '—'}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Stocks</Text>
                <Text style={styles.metricValue}>{portfolioSummary.holdingsCount}</Text>
              </View>
            </View>

            {portfolioSummary.hasLivePrices && portfolioSummary.totalCost > 0 && (
              <TouchableOpacity
                style={styles.plSummary}
                onPress={() => setPlModalVisible(true)}
                activeOpacity={0.7}
              >
                <View style={styles.plSummaryHeader}>
                  <Text style={styles.plSummaryLabel}>Total P/L</Text>
                  <View style={styles.tapHint}>
                    <Ionicons name="analytics-outline" size={14} color={Colors.textMuted} />
                    <Text style={styles.tapHintText}>Tap for details</Text>
                  </View>
                </View>
                <View style={styles.plSummaryRow}>
                  <Text style={[styles.plSummaryValue, portfolioSummary.totalGainLoss >= 0 ? styles.positive : styles.negative]}>
                    {portfolioSummary.totalGainLoss >= 0 ? '+' : ''}${formatCurrency(portfolioSummary.totalGainLoss)}
                  </Text>
                  <View style={[styles.plBadge, portfolioSummary.totalGainLossPercent >= 0 ? styles.positiveBg : styles.negativeBg]}>
                    <Text style={[styles.plBadgeText, portfolioSummary.totalGainLossPercent >= 0 ? styles.positive : styles.negative]}>
                      {formatPercent(portfolioSummary.totalGainLossPercent)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}

            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.primaryButton} onPress={() => openTradeModal('', 'buy')}>
                <Text style={styles.primaryButtonText}>Buy Stock</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/trade-history')}>
                <Text style={styles.secondaryButtonText}>Trade History</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Current Holdings</Text>
              {portfolioLoading ? (
                <>
                  <SkeletonHolding />
                  <SkeletonHolding />
                  <SkeletonHolding />
                </>
              ) : holdings.length === 0 ? (
                <View style={styles.emptyHoldings}>
                  <Text style={styles.emptyText}>No holdings yet</Text>
                  <Text style={styles.emptySubtext}>Draft stocks or buy your first share!</Text>
                  <TouchableOpacity style={styles.button} onPress={() => openTradeModal('', 'buy')}>
                    <Text style={styles.buttonText}>Buy Stock</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                holdings.map((holding) => (
                  <HoldingRow
                    key={holding.symbol}
                    holding={holding}
                    companyName={stockNames[holding.symbol.toUpperCase()]}
                    onBuy={() => openTradeModal(holding.symbol, 'buy')}
                    onSell={() => openTradeModal(holding.symbol, 'sell')}
                  />
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Trade Modal */}
      {user && activeLeague && (
        <TradeModal
          visible={tradeModalVisible}
          onClose={() => setTradeModalVisible(false)}
          onTradeComplete={handleTradeComplete}
          leagueId={activeLeague.id}
          userId={user.id}
          currentHoldings={holdings}
          availableCash={budgetRemaining ?? 0}
          isBudgetMode={activeLeague.budget_mode === 'budget'}
          leagueType={activeLeague.league_type}
          initialSymbol={tradeSymbol}
          initialAction={tradeAction}
        />
      )}

      {/* P/L Breakdown Modal */}
      <PLBreakdownModal
        visible={plModalVisible}
        onClose={() => setPlModalVisible(false)}
        holdings={holdings}
        drafts={drafts}
        trades={trades}
        stockNames={stockNames}
        totalGainLoss={portfolioSummary.totalGainLoss}
        totalGainLossPercent={portfolioSummary.totalGainLossPercent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollView: { flex: 1 },
  loadingText: { color: Colors.textMuted, fontSize: 16, textAlign: 'center', marginTop: 100 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 100, paddingHorizontal: 24 },
  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },
  title: { fontSize: 28, fontWeight: 'bold', color: Colors.textPrimary },
  leagueName: { fontSize: 14, color: Colors.primaryLight, marginTop: 4 },
  metricsRow: { flexDirection: 'row', paddingHorizontal: 24, gap: 8, marginTop: 16, marginBottom: 16 },
  metricCard: { flex: 1, backgroundColor: Colors.cardBg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.border },
  metricLabel: { fontSize: 11, color: Colors.textMuted, marginBottom: 4 },
  metricValue: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  plSummary: { marginHorizontal: 24, backgroundColor: Colors.cardBg, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border, marginBottom: 16 },
  plSummaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  plSummaryLabel: { fontSize: 12, color: Colors.textMuted },
  tapHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tapHintText: { fontSize: 11, color: Colors.textMuted },
  plSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  plSummaryValue: { fontSize: 24, fontWeight: 'bold' },
  plBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  plBadgeText: { fontSize: 14, fontWeight: '600' },
  positive: { color: Colors.success },
  negative: { color: Colors.error },
  positiveBg: { backgroundColor: Colors.successBg },
  negativeBg: { backgroundColor: Colors.errorBg },
  actionsRow: { flexDirection: 'row', paddingHorizontal: 24, gap: 12, marginBottom: 24 },
  primaryButton: { flex: 1, backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  primaryButtonText: { color: Colors.textPrimary, fontSize: 16, fontWeight: '600' },
  secondaryButton: { flex: 1, backgroundColor: Colors.cardBg, paddingVertical: 14, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  secondaryButtonText: { color: Colors.textPrimary, fontSize: 16, fontWeight: '500' },
  section: { paddingHorizontal: 24, paddingBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: Colors.textPrimary, marginBottom: 16 },
  holdingRow: { backgroundColor: Colors.cardBg, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.border },
  holdingMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  holdingLeft: { flex: 1 },
  holdingRight: { alignItems: 'flex-end' },
  holdingSymbol: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  holdingName: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  holdingQty: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  holdingValue: { fontSize: 16, fontWeight: '600', color: Colors.textPrimary, marginBottom: 4 },
  dayChangeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  dayChangeText: { fontSize: 12, fontWeight: '600' },
  holdingActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 6, alignItems: 'center' },
  buyBtn: { backgroundColor: Colors.success },
  sellBtn: { backgroundColor: Colors.error },
  actionBtnText: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
  emptyHoldings: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 16, color: Colors.textPrimary, fontWeight: '600', marginBottom: 4 },
  emptySubtext: { fontSize: 14, color: Colors.textMuted, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: Colors.textPrimary, marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: Colors.textMuted, marginBottom: 24, textAlign: 'center' },
  button: { backgroundColor: Colors.primary, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
  buttonText: { color: Colors.textPrimary, fontSize: 16, fontWeight: '600' },
});
