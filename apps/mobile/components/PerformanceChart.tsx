import { useState, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { PLDataPoint } from '@/lib/useHistoricalPL';
import { Colors } from '@/constants/Colors';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_HEIGHT = 120;

type Period = '1W' | '1M' | 'Season' | 'All';

export interface PeriodPL {
  gainLoss: number;
  gainLossPercent: number;
  isPositive: boolean;
  period: Period;
}

interface PerformanceChartProps {
  data: PLDataPoint[];
  loading?: boolean;
  /** Called when the period changes with updated P/L relative to that period's start */
  onPeriodPLChange?: (pl: PeriodPL) => void;
}

function getCutoffDate(period: Period, data: PLDataPoint[]): string | null {
  if (period === 'All' || data.length === 0) return null;

  const now = new Date();
  let cutoff: Date;

  switch (period) {
    case '1W':
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '1M':
      cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'Season':
      cutoff = new Date(data[0].date);
      break;
    default:
      return null;
  }

  return cutoff.toISOString().split('T')[0];
}

function filterByPeriod(data: PLDataPoint[], period: Period): PLDataPoint[] {
  if (period === 'All' || data.length === 0) return data;

  const cutoffStr = getCutoffDate(period, data);
  if (!cutoffStr) return data;

  const filtered = data.filter(d => d.date >= cutoffStr);
  return filtered.length >= 2 ? filtered : data;
}

/** Check how many days of data we have */
function getDataSpanDays(data: PLDataPoint[]): number {
  if (data.length < 2) return 0;
  const first = new Date(data[0].date).getTime();
  const last = new Date(data[data.length - 1].date).getTime();
  return Math.floor((last - first) / (24 * 60 * 60 * 1000));
}

export function PerformanceChart({ data, loading, onPeriodPLChange }: PerformanceChartProps) {
  const [period, setPeriod] = useState<Period>('All');

  const filteredData = useMemo(() => filterByPeriod(data, period), [data, period]);

  // Compute period-relative P/L
  const periodPL = useMemo((): PeriodPL => {
    if (filteredData.length < 2) {
      return { gainLoss: 0, gainLossPercent: 0, isPositive: true, period };
    }
    const startValue = filteredData[0].value;
    const endValue = filteredData[filteredData.length - 1].value;
    const gainLoss = endValue - startValue;
    const gainLossPercent = startValue > 0 ? (gainLoss / startValue) * 100 : 0;
    return { gainLoss, gainLossPercent, isPositive: gainLoss >= 0, period };
  }, [filteredData, period]);

  // Notify parent of P/L changes
  useEffect(() => {
    onPeriodPLChange?.(periodPL);
  }, [periodPL]);

  // Check which periods have enough data
  const dataSpanDays = useMemo(() => getDataSpanDays(data), [data]);

  if (loading || data.length < 2) return null;

  const lineColor = periodPL.isPositive ? '#0891B2' : '#DC2626';

  const chartData = filteredData.map(d => ({
    value: d.value,
  }));

  // Y-axis auto-scaling: compute data range with 10% padding
  const values = filteredData.map(d => d.value);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const dataRange = dataMax - dataMin || 1; // avoid zero range
  const padding = dataRange * 0.1;
  const yMin = Math.max(0, dataMin - padding);
  const yMax = dataMax + padding;

  const periods: { key: Period; label: string; minDays: number }[] = [
    { key: '1W', label: '1W', minDays: 2 },
    { key: '1M', label: '1M', minDays: 8 },
    { key: 'Season', label: 'Season', minDays: 0 },
    { key: 'All', label: 'All', minDays: 0 },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.chartWrapper}>
        <LineChart
          data={chartData}
          height={CHART_HEIGHT}
          width={SCREEN_WIDTH}
          adjustToWidth
          hideDataPoints
          hideAxesAndRules
          hideYAxisText
          curved
          curvature={0.15}
          thickness={2}
          color={lineColor}
          initialSpacing={0}
          endSpacing={0}
          yAxisOffset={yMin}
          maxValue={yMax - yMin}
          disableScroll
          isAnimated
          animateOnDataChange
          animationDuration={400}
          onDataChangeAnimationDuration={300}
        />
      </View>

      {/* Period selectors */}
      <View style={styles.periodRow}>
        {periods.map(({ key, label, minDays }) => {
          const isAvailable = dataSpanDays >= minDays;
          const isActive = period === key;

          return (
            <TouchableOpacity
              key={key}
              style={[styles.periodPill, isActive && styles.periodPillActive]}
              onPress={() => isAvailable && setPeriod(key)}
              activeOpacity={isAvailable ? 0.7 : 1}
              disabled={!isAvailable}
            >
              <Text style={[
                styles.periodText,
                isActive && styles.periodTextActive,
                !isAvailable && styles.periodTextDisabled,
              ]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
  },
  chartWrapper: {
    marginHorizontal: -24, // Bleed to screen edges (parent has 24px padding)
    overflow: 'hidden',
  },
  periodRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    marginTop: 12,
    paddingHorizontal: 24,
  },
  periodPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  periodPillActive: {
    backgroundColor: '#F1F5F9',
  },
  periodText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  periodTextActive: {
    color: Colors.textPrimary,
  },
  periodTextDisabled: {
    color: '#CBD5E1', // Slate-300 — clearly disabled
  },
});
