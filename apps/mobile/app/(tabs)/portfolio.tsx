import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { usePortfolio, Holding } from '@/lib/usePortfolio';
import { useHistoricalPL } from '@/lib/useHistoricalPL';
import { useStockNames, abbreviateName } from '@/lib/useStockNames';
import { PerformanceChart, PeriodPL } from '@/components/PerformanceChart';
import { router } from 'expo-router';
import { useState, useMemo, useCallback } from 'react';
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

function HoldingRow({ holding, companyName, onPress }: { holding: Holding; companyName?: string; onPress: () => void }) {
  const hasPrice = holding.currentPrice !== null;
  const dayChange = holding.dayChangePercent ?? 0;
  const isDayPositive = dayChange >= 0;

  return (
    <TouchableOpacity style={styles.holdingRow} onPress={onPress} activeOpacity={0.7}>
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
                color={isDayPositive ? '#059669' : '#DC2626'}
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
    </TouchableOpacity>
  );
}

export default function PortfolioScreen() {
  const { user, loading: authLoading } = useAuth();
  const { leagues, activeLeagueId, activeLeague, refresh: refreshLeagues } = useLeagueContext();
  const { holdings, drafts, trades, portfolioSummary, loading: portfolioLoading, refresh: refreshPortfolio } = usePortfolio(activeLeagueId);
  const { data: historicalData, loading: histLoading } = useHistoricalPL(drafts, trades, drafts.length > 0);
  const [refreshing, setRefreshing] = useState(false);
  const [periodPL, setPeriodPL] = useState<PeriodPL | null>(null);
  const handlePeriodPLChange = useCallback((pl: PeriodPL) => setPeriodPL(pl), []);

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
      <SafeAreaView style={styles.container} edges={['top']}>
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <LeagueSwitcher />

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0891B2" />}
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
            {/* Hero: Portfolio Value */}
            <View style={styles.heroSection}>
              <Text style={styles.heroLabel}>Portfolio Value</Text>
              <Text style={styles.heroValue}>${formatCurrency(portfolioSummary.totalValue)}</Text>

              {portfolioSummary.hasLivePrices && portfolioSummary.totalCost > 0 && (() => {
                const hasChart = historicalData.length >= 2;
                const gl = hasChart && periodPL ? periodPL.gainLoss : portfolioSummary.totalGainLoss;
                const glPct = hasChart && periodPL ? periodPL.gainLossPercent : portfolioSummary.totalGainLossPercent;
                const isUp = hasChart && periodPL ? periodPL.isPositive : portfolioSummary.totalGainLoss >= 0;
                return (
                  <TouchableOpacity
                    style={styles.plPill}
                    onPress={() => setPlModalVisible(true)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.plPillInner, isUp ? styles.positiveBg : styles.negativeBg]}>
                      <Ionicons
                        name={isUp ? 'trending-up' : 'trending-down'}
                        size={14}
                        color={isUp ? '#059669' : '#DC2626'}
                      />
                      <Text style={[styles.plPillText, isUp ? styles.positive : styles.negative]}>
                        {isUp ? '+' : ''}${formatCurrency(gl)}
                        {' '}({formatPercent(glPct)})
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color="#94A3B8" style={{ marginLeft: 4 }} />
                  </TouchableOpacity>
                );
              })()}

              {budgetRemaining !== null && (
                <Text style={styles.budgetCaption}>
                  ${formatCurrency(budgetRemaining)} budget remaining
                </Text>
              )}
            </View>

            {/* Performance Chart */}
            {historicalData.length >= 2 && (
              <View style={styles.chartSection}>
                <PerformanceChart
                  data={historicalData}
                  loading={histLoading}
                  onPeriodPLChange={handlePeriodPLChange}
                />
              </View>
            )}

            {/* Actions */}
            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.primaryButton} onPress={() => openTradeModal('', 'buy')}>
                <Text style={styles.primaryButtonText}>Buy Stock</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghostButton} onPress={() => router.push('/trade-history')}>
                <Text style={styles.ghostButtonText}>View trade history</Text>
                <Ionicons name="arrow-forward" size={16} color="#0891B2" />
              </TouchableOpacity>
            </View>

            {/* Holdings */}
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
                  <View style={styles.emptyIcon}>
                    <Ionicons name="bar-chart-outline" size={32} color="#94A3B8" />
                  </View>
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
                    onPress={() => openTradeModal(holding.symbol, 'buy')}
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
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scrollView: { flex: 1 },
  loadingText: { color: '#94A3B8', fontSize: 16, textAlign: 'center', marginTop: 100 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 100, paddingHorizontal: 24 },

  // Hero
  heroSection: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  heroLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
    marginBottom: 4,
  },
  heroValue: {
    fontSize: 34,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  plPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  plPillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  plPillText: {
    fontSize: 14,
    fontWeight: '600',
  },
  budgetCaption: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 8,
  },

  // Chart
  chartSection: {
    paddingHorizontal: 24,
    marginBottom: 8,
  },

  // Actions
  actionsRow: {
    paddingHorizontal: 24,
    gap: 12,
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: '#0891B2',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  ghostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  ghostButtonText: {
    color: '#0891B2',
    fontSize: 15,
    fontWeight: '500',
  },

  // Section
  section: { paddingHorizontal: 24, paddingBottom: 24 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 16,
  },

  // Holding rows — clean, no card wrapper
  holdingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  holdingLeft: { flex: 1 },
  holdingRight: { alignItems: 'flex-end' },
  holdingSymbol: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  holdingName: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 1,
  },
  holdingQty: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  holdingValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 4,
  },
  dayChangeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dayChangeText: { fontSize: 12, fontWeight: '600' },

  // Status colors
  positive: { color: '#059669' },
  negative: { color: '#DC2626' },
  positiveBg: { backgroundColor: '#ECFDF5' },
  negativeBg: { backgroundColor: '#FEF2F2' },

  // Empty states
  emptyHoldings: { alignItems: 'center', paddingVertical: 40 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
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
    marginBottom: 16,
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
});
