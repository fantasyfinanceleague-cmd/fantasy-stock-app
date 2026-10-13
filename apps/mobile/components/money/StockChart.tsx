/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
/**
 * StockChart: the stock sheet's line (3e, M2; W4 Game Night). The Game Night Chart (§9C rule
 * 6: one line, no grid, no fill, a dashed base, the end dot live while the market is open)
 * over a labelled X axis, and the range as money-screen pills under it.
 *
 * Giorgio's chart-ranges ruling (A, 2026-10-05): 1W / 1M / 3M / 1Y, 1W the default, no 1D
 * (the bars are daily). 1W sits on the Mon…Fri axis; the others on dated axes
 * (stockChartSeries.stockLineSeries). The base is the range's first value (the Design Lead's
 * 2026-10-06 ruling). The line draws in once per range (the Chart's drawKey); Reduce Motion
 * shows it drawn.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { Chart, RangePills } from '@/components/sp/gn';
import { formatMoney } from '@/components/sp/logic/money';
import { CHART_RANGES, DEFAULT_CHART_RANGE, stockLineSeries, type ChartRange } from '@/lib/money/stockChartSeries';
import { useStockChartData } from '@/lib/money/useStockChartData';
import { etDateOf } from '@/lib/game/matchupRoster';
import type { MarketCalendarSession } from '@/lib/time/marketWeek';

export interface StockChartProps {
  symbol: string;
  /** The live/current price (the sheet's own quote read) — the chart never reads its own. */
  price: number | null;
  /** True while the market is open: the end dot breathes. */
  live: boolean;
  /** The sheet's clock (the capture seam plays the fixture's); defaults to now. */
  now?: Date;
  /** This week's sessions, for 1W's Mon…Fri axis. */
  sessions: readonly MarketCalendarSession[];
  /** The sheet's gutter: the line runs past it to the sheet's edges. */
  bleed: number;
}

const HEIGHT = 140;

export function StockChart({ symbol, price, live, now = new Date(), sessions, bleed }: StockChartProps) {
  const [range, setRange] = useState<ChartRange>(DEFAULT_CHART_RANGE);
  const data = useStockChartData(symbol, true);
  const todayEt = etDateOf(now) ?? now.toISOString().slice(0, 10);
  const series = useMemo(
    () => stockLineSeries({ range, bars: data.bars, price, todayEt, now, sessions }),
    // `now` ticks; the line only changes with the date, the bars, the price and the range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range, data.bars, price, todayEt, sessions],
  );
  return (
    <View style={styles.wrap}>
      <Chart
        points={data.status === 'ready' ? series.points : []}
        base={series.base}
        axis={series.axis}
        height={HEIGHT}
        bleed={bleed}
        live={live}
        drawKey={`${symbol}-${range}`}
        formatValue={(v) => formatMoney(v)}
        accessibilityLabel={`${symbol} price`}
      />
      <RangePills options={CHART_RANGES} value={range} onChange={setRange} variant="pills" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space[3],
  },
});
