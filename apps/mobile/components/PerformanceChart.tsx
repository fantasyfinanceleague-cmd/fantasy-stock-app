import { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { PLDataPoint } from '@/lib/useHistoricalPL';
import { Colors } from '@/constants/Colors';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_HEIGHT = 130;

type Period = '1W' | '1M' | 'Season' | 'All';

interface PerformanceChartProps {
  data: PLDataPoint[];
  loading?: boolean;
}

function filterByPeriod(data: PLDataPoint[], period: Period): PLDataPoint[] {
  if (period === 'All' || data.length === 0) return data;

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
      // Use the earliest data point as season start (approximate)
      cutoff = new Date(data[0].date);
      break;
    default:
      return data;
  }

  const cutoffStr = cutoff.toISOString().split('T')[0];
  const filtered = data.filter(d => d.date >= cutoffStr);

  // If filter results in < 2 points, return all data
  return filtered.length >= 2 ? filtered : data;
}

export function PerformanceChart({ data, loading }: PerformanceChartProps) {
  const [period, setPeriod] = useState<Period>('All');

  const filteredData = useMemo(() => filterByPeriod(data, period), [data, period]);

  if (loading || data.length < 2) return null;

  const isPositive = filteredData.length > 0 &&
    filteredData[filteredData.length - 1].value >= filteredData[0].value;

  const lineColor = isPositive ? '#0891B2' : '#DC2626';

  const chartData = filteredData.map(d => ({
    value: d.value,
  }));

  // Calculate spacing to fill the chart width
  // Chart renders full-width (no horizontal padding) per spec
  const chartWidth = SCREEN_WIDTH;
  const spacing = chartData.length > 1 ? chartWidth / (chartData.length - 1) : chartWidth;

  return (
    <View style={styles.container}>
      <View style={styles.chartWrapper}>
        <LineChart
          data={chartData}
          height={CHART_HEIGHT}
          width={chartWidth}
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
          disableScroll
          isAnimated
          animationDuration={600}
        />
      </View>

      {/* Period selectors */}
      <View style={styles.periodRow}>
        {(['1W', '1M', 'Season', 'All'] as Period[]).map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.periodPill, period === p && styles.periodPillActive]}
            onPress={() => setPeriod(p)}
            activeOpacity={0.7}
          >
            <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
              {p}
            </Text>
          </TouchableOpacity>
        ))}
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
    borderRadius: 8,
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
});
