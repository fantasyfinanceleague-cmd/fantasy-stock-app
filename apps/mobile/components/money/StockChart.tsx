/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
/**
 * StockChart: the stock sheet's live chart (3e, M2). Reuses the shared chart
 * stack (lib/chart/chartGeometry, useChartScrub, useDrawIn) the same way
 * Home's SeasonChart does, with the baseline at the previous close instead
 * of $0 (chartGeometry's "zero" math is reused unchanged by feeding it
 * `close - prevClose` deltas) and ranges instead of a fixed week window.
 *
 * D1 (Giorgio, standing): ranges are 1W/1M/3M/1Y, default 1W, NO 1D --
 * overrides the older board mock and spec text, which both still show 1D.
 *
 * M2 motion: the line draws in on the FIRST bars load only (`feature`,
 * length-reveal, same mechanism as Home). A range change does not redo that
 * reveal -- the new shape cross-fades in at `base` instead (a simplification
 * of "morphs": an opacity fade between shapes, not a point-for-point
 * interpolation, which has no clean correspondence across ranges of very
 * different bar counts). Reduce Motion: drawn at once, range changes swap
 * instantly, the scrub label still works, no haptic ticks.
 */
import { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';

import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { formatMoney } from '@/components/sp/logic/money';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { buildChartGeometry, partialLinePath } from '@/lib/chart/chartGeometry';
import { useChartScrub } from '@/lib/chart/useChartScrub';
import { useDrawIn } from '@/lib/chart/useDrawIn';
import {
  barsForRange,
  CHART_RANGES,
  DEFAULT_CHART_RANGE,
  deltaSeries,
  stockScrubLabel,
  type ChartRange,
  type DailyBar,
} from '@/lib/money/stockChartSeries';
import { useStockChartData } from '@/lib/money/useStockChartData';

const AnimatedG = Animated.createAnimatedComponent(G);
const HEIGHT = 140;
const SCRUB_LABEL_CLEAR = 48;

export interface StockChartProps {
  symbol: string;
  /** The live/current price (the sheet's own quote read) — the chart never reads its own. */
  price: number | null;
  prevClose: number | null;
  /** True while the market is open: the endpoint is the pulsing live dot, not a static circle. */
  live: boolean;
}

export function StockChart({ symbol, price, prevClose, live }: StockChartProps) {
  const { colors } = useTheme();
  const { reduced, duration, easing } = useMotion();
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState<ChartRange>(DEFAULT_CHART_RANGE);
  const enabled = price != null && prevClose != null;
  const data = useStockChartData(symbol, enabled);

  // Market open: the live price stands in for today's still-forming bar, appended to the
  // real history (never inserted MID-history — it is always today, always the last point).
  const todayIso = new Date().toISOString().slice(0, 10);
  const allBars: DailyBar[] = live && price != null
    ? [...data.bars.filter((b) => b.date !== todayIso), { date: todayIso, close: price }]
    : data.bars;
  const rangeBars = barsForRange(allBars, range, new Date());
  const baseline = prevClose ?? 0;
  const series = deltaSeries(rangeBars, baseline);
  const geometry = width > 0 && series.length > 0 ? buildChartGeometry(series, width, HEIGHT) : null;

  // The length-reveal draw-in fires exactly once, the first time bars arrive -- never again
  // on a later range change (that gets the cross-fade below, not another reveal).
  const drawProgress = useDrawIn({
    key: data.status === 'ready' && data.bars.length > 0 ? 'loaded' : 'empty',
    lineLength: geometry?.lineLength ?? 0,
    reduced,
    durationMs: duration.feature,
  });

  // The cross-fade: a range change fades the new shape in at `base`, instead of redrawing it.
  const fadeOpacity = useSharedValue(1);
  const prevRangeRef = useRef(range);
  useEffect(() => {
    if (prevRangeRef.current === range) return;
    prevRangeRef.current = range;
    if (reduced) {
      fadeOpacity.value = 1;
      return;
    }
    fadeOpacity.value = 0;
    fadeOpacity.value = withTiming(1, { duration: duration.base, easing: easing.settle });
  }, [range, reduced, duration.base, easing.settle, fadeOpacity]);
  const fadeProps = useAnimatedProps(() => ({ opacity: fadeOpacity.value }));

  function handleLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  const { scrubIndex, pan, setScrubIndex } = useChartScrub(geometry, reduced);
  const scrubPoint = geometry && scrubIndex != null ? geometry.points[scrubIndex] : null;
  const scrubBar = scrubIndex != null ? rangeBars[scrubIndex] : null;
  const scrubLabel = scrubBar ? stockScrubLabel(scrubBar) : null;

  const endpoint = geometry && geometry.points.length > 0 ? geometry.points[geometry.points.length - 1] : null;
  const endValue = series.length > 0 ? series[series.length - 1] : 0;
  const lineColor = endValue >= 0 ? colors.gain : colors.loss;

  const latestClose = rangeBars.length > 0 ? rangeBars[rangeBars.length - 1].close : null;
  const summary = latestClose != null
    ? `${symbol} price chart, ${range}, ${formatMoney(latestClose)}, ${endValue >= 0 ? 'up' : 'down'} ${formatMoney(Math.abs(endValue))} from the previous close`
    : `${symbol} price chart`;

  // VoiceOver's adjustable action (M2's accessibility requirement) steps the
  // scrub index one bar at a time, starting from the endpoint.
  function stepScrub(dir: 1 | -1) {
    if (!geometry || geometry.points.length === 0) return;
    const from = scrubIndex ?? geometry.points.length - 1;
    const next = Math.min(geometry.points.length - 1, Math.max(0, from + dir));
    setScrubIndex(next);
  }

  if (!enabled) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.chart} onLayout={handleLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={summary}
        accessibilityValue={scrubLabel ? { text: `${scrubLabel.primary}, ${scrubLabel.money}` } : undefined}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => stepScrub(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      >
        {width > 0 && geometry ? (
          <GestureDetector gesture={pan}>
            <View>
              <Svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}>
                <AnimatedG animatedProps={fadeProps}>
                  <Line x1={0} x2={width} y1={geometry.zeroY} y2={geometry.zeroY} stroke={colors.borderStrong} strokeDasharray="3 4" strokeWidth={1} />
                  {/* Board convention (key-screens.html StockSheet): the label sits BELOW the
                      dashed line, not above it like Home's "$0" label. */}
                  <SvgText x={2} y={geometry.zeroY + 14} fontSize={11} fontWeight="600" fill={colors.text2}>
                    {`Prev close ${formatMoney(baseline)}`}
                  </SvgText>
                  <Path
                    d={drawProgress >= 1 ? geometry.linePath : partialLinePath(geometry.points, drawProgress, geometry.lineLength)}
                    stroke={lineColor}
                    strokeWidth={2.25}
                    strokeLinejoin="round"
                    fill="none"
                  />
                  {endpoint && !scrubPoint && !live ? (
                    <Circle cx={endpoint.x} cy={endpoint.y} r={4} fill={lineColor} stroke={colors.surface} strokeWidth={2} />
                  ) : null}
                  {scrubPoint ? (
                    <>
                      <Line x1={scrubPoint.x} x2={scrubPoint.x} y1={0} y2={HEIGHT} stroke={colors.text2} strokeWidth={1} />
                      <Circle cx={scrubPoint.x} cy={scrubPoint.y} r={5} fill={colors.accent} />
                    </>
                  ) : null}
                </AnimatedG>
              </Svg>
              {endpoint && !scrubPoint && live ? (
                <View style={[styles.liveDotOverlay, { left: endpoint.x - 4, top: endpoint.y - 4 }]} pointerEvents="none">
                  <LiveDot size={8} />
                </View>
              ) : null}
              {scrubLabel ? (
                <View style={[styles.scrubLabel, scrubPoint && scrubPoint.y < SCRUB_LABEL_CLEAR ? { top: scrubPoint.y + 12 } : null, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text variant="caption" tone="secondary">{scrubLabel.primary}</Text>
                  <Text variant="callout" style={{ fontWeight: '700' }}>{scrubLabel.money}</Text>
                </View>
              ) : null}
            </View>
          </GestureDetector>
        ) : null}
      </View>

      <SegmentedControl
        options={CHART_RANGES.map((r) => ({ label: r, value: r }))}
        value={range}
        onChange={(v) => setRange(v as ChartRange)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  chart: { width: '100%', position: 'relative' },
  scrubLabel: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  liveDotOverlay: {
    position: 'absolute',
  },
});
