import { View, Text, StyleSheet } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';
import { Holding } from '@/lib/usePortfolio';
import { Colors } from '@/constants/Colors';

// Color palette for the pie chart
const CHART_COLORS = [
  '#3b82f6', // blue (primary)
  '#8b5cf6', // purple
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
  '#84cc16', // lime
];

interface PortfolioChartProps {
  holdings: Holding[];
  totalValue: number;
}

export function PortfolioChart({ holdings, totalValue }: PortfolioChartProps) {
  if (holdings.length === 0 || totalValue === 0) {
    return null;
  }

  // Sort by value and take top holdings
  const sortedHoldings = [...holdings].sort((a, b) => {
    const aValue = a.currentValue ?? a.totalCost;
    const bValue = b.currentValue ?? b.totalCost;
    return bValue - aValue;
  });

  // If more than 6 holdings, group smaller ones as "Other"
  const maxSlices = 6;
  let chartData: { value: number; color: string; symbol: string; percentage: number }[] = [];
  let otherValue = 0;

  sortedHoldings.forEach((holding, index) => {
    const value = holding.currentValue ?? holding.totalCost;
    const percentage = (value / totalValue) * 100;

    if (index < maxSlices - 1 || sortedHoldings.length <= maxSlices) {
      chartData.push({
        value,
        color: CHART_COLORS[index % CHART_COLORS.length],
        symbol: holding.symbol,
        percentage,
      });
    } else {
      otherValue += value;
    }
  });

  // Add "Other" slice if needed
  if (otherValue > 0) {
    chartData.push({
      value: otherValue,
      color: Colors.textDark,
      symbol: 'Other',
      percentage: (otherValue / totalValue) * 100,
    });
  }

  // Format for PieChart
  const pieData = chartData.map(item => ({
    value: item.value,
    color: item.color,
    text: item.percentage >= 5 ? `${item.percentage.toFixed(0)}%` : '',
    textColor: '#fff',
    textSize: 10,
  }));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Allocation</Text>

      <View style={styles.chartContainer}>
        <PieChart
          data={pieData}
          donut
          radius={70}
          innerRadius={45}
          innerCircleColor={Colors.cardBg} // solid color needed for donut center
          centerLabelComponent={() => (
            <View style={styles.centerLabel}>
              <Text style={styles.centerValue}>{holdings.length}</Text>
              <Text style={styles.centerText}>stocks</Text>
            </View>
          )}
        />

        <View style={styles.legend}>
          {chartData.map((item, index) => (
            <View key={item.symbol} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: item.color }]} />
              <Text style={styles.legendSymbol}>{item.symbol}</Text>
              <Text style={styles.legendPercent}>{item.percentage.toFixed(1)}%</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.glassBg,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  title: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: 16,
  },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  centerLabel: {
    alignItems: 'center',
  },
  centerValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.textPrimary,
  },
  centerText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  legend: {
    flex: 1,
    marginLeft: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  legendSymbol: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  legendPercent: {
    fontSize: 13,
    color: Colors.textMuted,
  },
});
