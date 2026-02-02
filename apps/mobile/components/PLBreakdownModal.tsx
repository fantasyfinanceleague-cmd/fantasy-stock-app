import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Dimensions, ActivityIndicator } from 'react-native';
import { useState, useMemo } from 'react';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { LineChart, LineChartBicolor } from 'react-native-gifted-charts';
import { Holding, DraftPick, Trade } from '@/lib/usePortfolio';
import { abbreviateName } from '@/lib/useStockNames';
import { useHistoricalPL, PLDataPoint } from '@/lib/useHistoricalPL';

// TimePeriod can be 'ALL' or a week number like 1, 2, 3, etc.
type TimePeriod = 'ALL' | number;

interface PLBreakdownModalProps {
  visible: boolean;
  onClose: () => void;
  holdings: Holding[];
  drafts: DraftPick[];
  trades: Trade[];
  stockNames: Record<string, string>;
  totalGainLoss: number;
  totalGainLossPercent: number;
}

interface ClosedPosition {
  symbol: string;
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  realizedPL: number;
  realizedPLPercent: number;
  acquiredDate: string;
  soldDate: string;
  wasFromDraft: boolean;
}

function formatCurrency(value: number): string {
  return Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  return Math.abs(value).toFixed(2);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const screenWidth = Dimensions.get('window').width;
const CHART_WIDTH = screenWidth - 80;

export default function PLBreakdownModal({
  visible,
  onClose,
  holdings,
  drafts,
  trades,
  stockNames,
  totalGainLoss,
  totalGainLossPercent,
}: PLBreakdownModalProps) {
  // Sort holdings by absolute gain/loss (biggest movers first)
  const sortedHoldings = [...holdings]
    .filter(h => h.gainLoss !== null)
    .sort((a, b) => Math.abs(b.gainLoss!) - Math.abs(a.gainLoss!));

  // Find the max absolute gain/loss for scaling the bar chart
  const maxAbsGainLoss = Math.max(
    ...sortedHoldings.map(h => Math.abs(h.gainLoss!)),
    1
  );

  // Separate winners and losers for summary
  const winners = sortedHoldings.filter(h => h.gainLoss! > 0);
  const losers = sortedHoldings.filter(h => h.gainLoss! < 0);
  const totalWins = winners.reduce((sum, h) => sum + h.gainLoss!, 0);
  const totalLosses = losers.reduce((sum, h) => sum + h.gainLoss!, 0);

  // Build acquisition info for each holding
  const getAcquisitionInfo = (symbol: string): { type: 'drafted' | 'bought'; date: string } | null => {
    // Check if it was drafted
    const draft = drafts.find(d => d.symbol.toUpperCase() === symbol.toUpperCase());
    if (draft) {
      return { type: 'drafted', date: draft.created_at };
    }

    // Check for first buy trade
    const buyTrade = trades.find(t =>
      t.symbol.toUpperCase() === symbol.toUpperCase() && t.action === 'buy'
    );
    if (buyTrade) {
      return { type: 'bought', date: buyTrade.created_at };
    }

    return null;
  };

  // Calculate closed positions (stocks that were sold completely)
  const closedPositions: ClosedPosition[] = [];

  // Get all symbols that had sells
  const sellTrades = trades.filter(t => t.action === 'sell');
  const soldSymbols = [...new Set(sellTrades.map(t => t.symbol.toUpperCase()))];

  for (const symbol of soldSymbols) {
    // Check if we still hold this stock
    const stillHeld = holdings.some(h => h.symbol.toUpperCase() === symbol);
    if (stillHeld) continue;

    // Get acquisition info
    const draft = drafts.find(d => d.symbol.toUpperCase() === symbol);
    const buyTrades = trades.filter(t =>
      t.symbol.toUpperCase() === symbol && t.action === 'buy'
    );
    const symbolSellTrades = trades.filter(t =>
      t.symbol.toUpperCase() === symbol && t.action === 'sell'
    );

    // Calculate totals
    let totalBuyCost = 0;
    let totalBuyQty = 0;
    let acquiredDate = '';
    let wasFromDraft = false;

    if (draft) {
      totalBuyCost += draft.entry_price * draft.quantity;
      totalBuyQty += draft.quantity;
      acquiredDate = draft.created_at;
      wasFromDraft = true;
    }

    for (const buy of buyTrades) {
      totalBuyCost += buy.price * buy.quantity;
      totalBuyQty += buy.quantity;
      if (!acquiredDate || new Date(buy.created_at) < new Date(acquiredDate)) {
        acquiredDate = buy.created_at;
      }
    }

    let totalSellValue = 0;
    let totalSellQty = 0;
    let soldDate = '';

    for (const sell of symbolSellTrades) {
      totalSellValue += sell.price * sell.quantity;
      totalSellQty += sell.quantity;
      if (!soldDate || new Date(sell.created_at) > new Date(soldDate)) {
        soldDate = sell.created_at;
      }
    }

    // Only count as closed if sold same or more than bought
    if (totalSellQty >= totalBuyQty && totalBuyQty > 0) {
      const avgBuyPrice = totalBuyCost / totalBuyQty;
      const avgSellPrice = totalSellValue / totalSellQty;
      const realizedPL = totalSellValue - totalBuyCost;
      const realizedPLPercent = (realizedPL / totalBuyCost) * 100;

      closedPositions.push({
        symbol,
        buyPrice: avgBuyPrice,
        sellPrice: avgSellPrice,
        quantity: totalSellQty,
        realizedPL,
        realizedPLPercent,
        acquiredDate,
        soldDate,
        wasFromDraft,
      });
    }
  }

  // Sort closed positions by realized P/L
  closedPositions.sort((a, b) => Math.abs(b.realizedPL) - Math.abs(a.realizedPL));

  const isPositive = totalGainLoss >= 0;

  // Fetch historical P/L data for the chart
  const { data: historicalData, loading: historyLoading } = useHistoricalPL(
    drafts,
    trades,
    visible // Only fetch when modal is visible
  );

  // Calculate draft start date and current week
  const { draftStartDate, currentWeek, weekOptions } = useMemo(() => {
    // Find earliest draft date
    let earliest: Date | null = null;
    for (const draft of drafts) {
      const date = new Date(draft.created_at);
      if (!earliest || date < earliest) {
        earliest = date;
      }
    }

    if (!earliest) {
      return { draftStartDate: null, currentWeek: 0, weekOptions: [] };
    }

    // Calculate current week number (weeks since draft)
    const now = new Date();
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weeksSinceDraft = Math.ceil((now.getTime() - earliest.getTime()) / msPerWeek);
    const currentWeek = Math.max(1, weeksSinceDraft);

    // Generate week options: W1, W2, W3, ... up to current week
    const weekOptions: TimePeriod[] = [];
    for (let i = 1; i <= currentWeek; i++) {
      weekOptions.push(i);
    }
    weekOptions.push('ALL'); // Add "All" at the end

    return { draftStartDate: earliest, currentWeek, weekOptions };
  }, [drafts]);

  // Time period selector state - default to ALL
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>('ALL');

  // Filter data based on selected week
  const filteredData = useMemo(() => {
    if (historicalData.length === 0 || !draftStartDate) return [];

    if (selectedPeriod === 'ALL') {
      return historicalData;
    }

    // Calculate the date range for the selected week
    const weekNumber = selectedPeriod as number;
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weekStart = new Date(draftStartDate.getTime() + (weekNumber - 1) * msPerWeek);
    const weekEnd = new Date(draftStartDate.getTime() + weekNumber * msPerWeek);

    return historicalData.filter(point => {
      const pointDate = new Date(point.date);
      return pointDate >= weekStart && pointDate < weekEnd;
    });
  }, [historicalData, selectedPeriod, draftStartDate]);

  // Generate week-based labels for x-axis
  const { chartData, xAxisLabels } = useMemo(() => {
    if (filteredData.length === 0) return { chartData: [], xAxisLabels: [] };

    const data = filteredData.map((point) => ({
      value: point.pl,
    }));

    // Generate week start date labels (every 7 days or so)
    const labels: string[] = [];
    const totalPoints = filteredData.length;

    // Show 3-4 labels max for readability
    const labelInterval = Math.max(1, Math.floor(totalPoints / 3));

    for (let i = 0; i < totalPoints; i += labelInterval) {
      const date = new Date(filteredData[i].date);
      labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }

    // Always include the last date if not already included
    if (totalPoints > 0) {
      const lastDate = new Date(filteredData[totalPoints - 1].date);
      const lastLabel = lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (labels[labels.length - 1] !== lastLabel) {
        labels.push(lastLabel);
      }
    }

    return { chartData: data, xAxisLabels: labels };
  }, [filteredData]);

  // Calculate chart bounds - always include 0, with balanced range above/below
  const { yMin, yMax, yLabels } = useMemo(() => {
    if (chartData.length === 0) return { yMin: -100, yMax: 100, yLabels: ['100', '0', '-100'] };

    const dataMin = Math.min(...chartData.map(d => d.value));
    const dataMax = Math.max(...chartData.map(d => d.value));

    // Find the larger absolute value to create symmetric range around 0
    const absMax = Math.max(Math.abs(dataMin), Math.abs(dataMax), 10); // minimum range of 10

    // Round up to a nice number
    const niceMax = Math.ceil(absMax / 10) * 10;

    const yMin = -niceMax;
    const yMax = niceMax;

    // Generate labels: top, 0, bottom
    const yLabels = [`$${niceMax}`, '$0', `-$${niceMax}`];

    return { yMin, yMax, yLabels };
  }, [chartData]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>P/L Breakdown</Text>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* Total P/L Card */}
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total Profit/Loss</Text>
            <Text style={[styles.totalValue, isPositive ? styles.positive : styles.negative]}>
              {isPositive ? '+' : '-'}${formatCurrency(totalGainLoss)}
            </Text>
            <View style={[styles.percentBadge, isPositive ? styles.positiveBg : styles.negativeBg]}>
              <Text style={[styles.percentText, isPositive ? styles.positive : styles.negative]}>
                {isPositive ? '+' : '-'}{formatPercent(totalGainLossPercent)}%
              </Text>
            </View>
          </View>

          {/* Quick Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Winners</Text>
              <Text style={[styles.statValue, styles.positive]}>{winners.length}</Text>
              <Text style={[styles.statSubvalue, styles.positive]}>+${formatCurrency(totalWins)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Losers</Text>
              <Text style={[styles.statValue, styles.negative]}>{losers.length}</Text>
              <Text style={[styles.statSubvalue, styles.negative]}>-${formatCurrency(Math.abs(totalLosses))}</Text>
            </View>
          </View>

          {/* P/L Over Time Chart */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>P/L Over Time</Text>

            {historyLoading ? (
              <View style={styles.chartLoading}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.chartLoadingText}>Loading chart...</Text>
              </View>
            ) : historicalData.length < 2 ? (
              <Text style={styles.emptyText}>Not enough data for chart</Text>
            ) : (
              <View style={styles.lineChartContainer}>
                {/* Time period selector */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.periodSelector}
                  contentContainerStyle={styles.periodSelectorContent}
                >
                  {weekOptions.map((period) => (
                    <TouchableOpacity
                      key={String(period)}
                      style={[
                        styles.periodButton,
                        selectedPeriod === period && styles.periodButtonActive,
                      ]}
                      onPress={() => setSelectedPeriod(period)}
                    >
                      <Text
                        style={[
                          styles.periodButtonText,
                          selectedPeriod === period && styles.periodButtonTextActive,
                        ]}
                      >
                        {period === 'ALL' ? 'All' : `W${period}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {chartData.length < 2 ? (
                  <View style={styles.noDataPeriod}>
                    <Text style={styles.noDataText}>No data for this period</Text>
                  </View>
                ) : (
                  <>
                    {/* Chart with Y-axis values */}
                    <View style={styles.chartWrapper}>
                      <View style={styles.chartArea}>
                        <LineChartBicolor
                          data={chartData.map(d => ({ value: d.value }))}
                          width={Math.min(screenWidth - 100, 280)}
                          height={120}
                          spacing={Math.min(280, screenWidth - 100) / Math.max(chartData.length - 1, 1)}
                          initialSpacing={0}
                          endSpacing={0}
                          thickness={2}
                          colorNegative={Colors.error}
                          color={Colors.success}
                          hideDataPoints
                          hideYAxisText
                          xAxisColor={Colors.border}
                          yAxisColor={'transparent'}
                          rulesType="solid"
                          rulesColor={Colors.border}
                          noOfSections={2}
                          maxValue={yMax}
                          mostNegativeValue={yMin}
                          yAxisOffset={yMin}
                        />
                      </View>

                      {/* Y-axis labels on the right */}
                      <View style={styles.yAxisLabels}>
                        {yLabels.map((label, i) => (
                          <Text key={i} style={[styles.yAxisText, label === '$0' && styles.yAxisZero]}>
                            {label}
                          </Text>
                        ))}
                      </View>
                    </View>

                    {/* X-axis week labels */}
                    <View style={styles.xAxisLabels}>
                      {xAxisLabels.map((label, i) => (
                        <Text key={i} style={styles.xAxisText}>{label}</Text>
                      ))}
                    </View>
                  </>
                )}
              </View>
            )}
          </View>

          {/* Bar Chart Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contribution by Stock</Text>
            <Text style={styles.sectionSubtitle}>How each holding affects your total P/L</Text>

            {sortedHoldings.length === 0 ? (
              <Text style={styles.emptyText}>No holdings with price data</Text>
            ) : (
              <View style={styles.chartContainer}>
                {sortedHoldings.map((holding) => {
                  const gainLoss = holding.gainLoss!;
                  const isWinner = gainLoss >= 0;
                  const barWidth = (Math.abs(gainLoss) / maxAbsGainLoss) * CHART_WIDTH;

                  return (
                    <View key={holding.symbol} style={styles.barRow}>
                      <View style={styles.barLabel}>
                        <Text style={styles.barSymbol}>{holding.symbol}</Text>
                      </View>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.bar,
                            isWinner ? styles.barPositive : styles.barNegative,
                            { width: Math.max(barWidth, 4) },
                          ]}
                        />
                      </View>
                      <Text style={[styles.barValue, isWinner ? styles.positive : styles.negative]}>
                        {isWinner ? '+' : '-'}${formatCurrency(gainLoss)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Current Holdings Breakdown */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Current Holdings</Text>
            <Text style={styles.sectionSubtitle}>Stocks you currently own</Text>

            {sortedHoldings.length === 0 ? (
              <Text style={styles.emptyText}>No current holdings</Text>
            ) : (
              sortedHoldings.map((holding) => {
                const isWinner = (holding.gainLoss ?? 0) >= 0;
                const acquisition = getAcquisitionInfo(holding.symbol);

                return (
                  <View key={holding.symbol} style={styles.detailRow}>
                    <View style={styles.detailHeader}>
                      <View style={styles.detailHeaderLeft}>
                        <Text style={styles.detailSymbol}>{holding.symbol}</Text>
                        {stockNames[holding.symbol.toUpperCase()] && (
                          <Text style={styles.detailName} numberOfLines={1}>
                            {abbreviateName(stockNames[holding.symbol.toUpperCase()], 28)}
                          </Text>
                        )}
                        {acquisition && (
                          <View style={styles.badgeRow}>
                            <View style={[styles.acquisitionBadge, acquisition.type === 'drafted' ? styles.draftedBadge : styles.boughtBadge]}>
                              <Ionicons
                                name={acquisition.type === 'drafted' ? 'trophy-outline' : 'cart-outline'}
                                size={10}
                                color={acquisition.type === 'drafted' ? Colors.gold : Colors.primary}
                              />
                              <Text style={[styles.acquisitionText, acquisition.type === 'drafted' ? styles.draftedText : styles.boughtText]}>
                                {acquisition.type === 'drafted' ? 'Drafted' : 'Bought'} {formatDate(acquisition.date)}
                              </Text>
                            </View>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.detailPL, isWinner ? styles.positive : styles.negative]}>
                        {isWinner ? '+' : '-'}${formatCurrency(holding.gainLoss!)}
                      </Text>
                    </View>

                    <View style={styles.detailGrid}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Shares</Text>
                        <Text style={styles.detailValue}>{holding.quantity}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Avg Cost</Text>
                        <Text style={styles.detailValue}>${holding.avgEntryPrice.toFixed(2)}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Current</Text>
                        <Text style={styles.detailValue}>${holding.currentPrice?.toFixed(2) ?? '--'}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Return</Text>
                        <Text style={[styles.detailValue, isWinner ? styles.positive : styles.negative]}>
                          {isWinner ? '+' : ''}{holding.gainLossPercent?.toFixed(1)}%
                        </Text>
                      </View>
                    </View>

                    <View style={styles.detailFooter}>
                      <Text style={styles.detailFooterLabel}>
                        Cost: ${formatCurrency(holding.totalCost)}
                      </Text>
                      <Text style={styles.detailFooterLabel}>
                        Value: ${formatCurrency(holding.currentValue ?? holding.totalCost)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* Closed Positions */}
          {closedPositions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Closed Positions</Text>
              <Text style={styles.sectionSubtitle}>Stocks you've sold</Text>

              {closedPositions.map((position) => {
                const isWinner = position.realizedPL >= 0;

                return (
                  <View key={position.symbol} style={[styles.detailRow, styles.closedRow]}>
                    <View style={styles.detailHeader}>
                      <View style={styles.detailHeaderLeft}>
                        <Text style={styles.detailSymbol}>{position.symbol}</Text>
                        {stockNames[position.symbol.toUpperCase()] && (
                          <Text style={styles.detailName} numberOfLines={1}>
                            {abbreviateName(stockNames[position.symbol.toUpperCase()], 28)}
                          </Text>
                        )}
                        <View style={styles.badgeRow}>
                          {/* Acquisition badge */}
                          <View style={[styles.acquisitionBadge, position.wasFromDraft ? styles.draftedBadge : styles.boughtBadge]}>
                            <Ionicons
                              name={position.wasFromDraft ? 'trophy-outline' : 'cart-outline'}
                              size={10}
                              color={position.wasFromDraft ? Colors.gold : Colors.primary}
                            />
                            <Text style={[styles.acquisitionText, position.wasFromDraft ? styles.draftedText : styles.boughtText]}>
                              {position.wasFromDraft ? 'Drafted' : 'Bought'} {formatDate(position.acquiredDate)}
                            </Text>
                          </View>
                          {/* Sold badge */}
                          <View style={styles.soldBadge}>
                            <Ionicons name="arrow-forward" size={10} color={Colors.textMuted} />
                            <Text style={styles.soldText}>Sold {formatDate(position.soldDate)}</Text>
                          </View>
                        </View>
                      </View>
                      <View style={styles.realizedPLContainer}>
                        <Text style={[styles.detailPL, isWinner ? styles.positive : styles.negative]}>
                          {isWinner ? '+' : '-'}${formatCurrency(position.realizedPL)}
                        </Text>
                        <Text style={styles.realizedLabel}>Realized</Text>
                      </View>
                    </View>

                    <View style={styles.detailGrid}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Shares Sold</Text>
                        <Text style={styles.detailValue}>{position.quantity}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Buy Price</Text>
                        <Text style={styles.detailValue}>${position.buyPrice.toFixed(2)}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Sell Price</Text>
                        <Text style={styles.detailValue}>${position.sellPrice.toFixed(2)}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Return</Text>
                        <Text style={[styles.detailValue, isWinner ? styles.positive : styles.negative]}>
                          {isWinner ? '+' : ''}{position.realizedPLPercent.toFixed(1)}%
                        </Text>
                      </View>
                    </View>

                    <View style={styles.detailFooter}>
                      <Text style={styles.detailFooterLabel}>
                        Cost: ${formatCurrency(position.buyPrice * position.quantity)}
                      </Text>
                      <Text style={styles.detailFooterLabel}>
                        Sold for: ${formatCurrency(position.sellPrice * position.quantity)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Bottom padding */}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
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
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  totalCard: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  totalLabel: {
    fontSize: 14,
    color: Colors.textMuted,
    marginBottom: 8,
  },
  totalValue: {
    fontSize: 36,
    fontWeight: '700',
    marginBottom: 8,
  },
  percentBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  percentText: {
    fontSize: 16,
    fontWeight: '600',
  },
  positive: { color: Colors.success },
  negative: { color: Colors.error },
  positiveBg: { backgroundColor: Colors.successBg },
  negativeBg: { backgroundColor: Colors.errorBg },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginTop: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  statSubvalue: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: 20,
  },
  lineChartContainer: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  periodSelector: {
    marginBottom: 16,
    marginHorizontal: -4,
  },
  periodSelectorContent: {
    paddingHorizontal: 4,
    gap: 6,
  },
  periodButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.background,
  },
  periodButtonActive: {
    backgroundColor: Colors.textMuted,
  },
  periodButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  periodButtonTextActive: {
    color: Colors.textPrimary,
  },
  noDataPeriod: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noDataText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  chartWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chartArea: {
    flex: 1,
    overflow: 'hidden',
  },
  yAxisLabels: {
    width: 50,
    height: 120,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingVertical: 4,
    paddingLeft: 8,
  },
  yAxisText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  yAxisZero: {
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  xAxisLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingRight: 50,
  },
  xAxisText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  chartLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  chartLoadingText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  chartContainer: {
    gap: 12,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  barLabel: {
    width: 50,
  },
  barSymbol: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  barTrack: {
    flex: 1,
    height: 24,
    backgroundColor: Colors.cardBg,
    borderRadius: 6,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 6,
  },
  barPositive: {
    backgroundColor: Colors.success,
  },
  barNegative: {
    backgroundColor: Colors.error,
  },
  barValue: {
    width: 75,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  detailRow: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  closedRow: {
    opacity: 0.85,
    borderStyle: 'dashed',
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  detailHeaderLeft: {
    flex: 1,
  },
  detailSymbol: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  detailName: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
    marginBottom: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  acquisitionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  draftedBadge: {
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
  },
  boughtBadge: {
    backgroundColor: Colors.primaryBg,
  },
  acquisitionText: {
    fontSize: 11,
    fontWeight: '500',
  },
  draftedText: {
    color: Colors.gold,
  },
  boughtText: {
    color: Colors.primary,
  },
  soldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(156, 163, 175, 0.15)',
  },
  soldText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  realizedPLContainer: {
    alignItems: 'flex-end',
  },
  realizedLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
  },
  detailPL: {
    fontSize: 18,
    fontWeight: '600',
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  detailItem: {
    width: '48%',
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
  },
  detailLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  detailFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  detailFooterLabel: {
    fontSize: 12,
    color: Colors.textMuted,
  },
});
