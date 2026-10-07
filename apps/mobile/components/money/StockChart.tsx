/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
/**
 * StockChart: the stock sheet's live chart (3e, M2). Reuses the shared chart
 * stack (lib/chart/chartGeometry, useChartScrub, useDrawIn) the same way
 * Home's SeasonChart does, with ranges instead of a fixed week window.
 *
 * Giorgio's chart-ranges ruling (A): ranges are 1W/1M/3M/1Y, default 1W, NO 1D --
 * overrides the older board mock and spec text, which both still show 1D.
 *
 * Design Lead ruling, 2026-10-06: the reference line is the range's FIRST
 * close (lib/money/stockChartSeries.referenceLine), not the previous close.
 * chartGeometry's "zero" math is reused unchanged by feeding it
 * `close - referenceLine.baseline` deltas. The header's own "today" figure is
 * unchanged -- it stays vs the previous close, whatever range is selected.
 *
 * M2 motion: the line draws in on the FIRST bars load only (`feature`,
 * length-reveal, same mechanism as Home). A range change cross-fades instead
 * (`base`): the OLD shape fades out while the NEW one fades in SIMULTANEOUSLY
 * (two stacked layers), so the chart is never blank mid-transition -- the
 * reference line and its label are part of each layer, so they swap with the
 * data. Reduce Motion: an instant swap, no second layer ever rendered.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import Animated, { runOnJS, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';

import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { formatMoney } from '@/components/sp/logic/money';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { buildChartGeometry, partialLinePath, type ChartGeometry } from '@/lib/chart/chartGeometry';
import { useChartScrub } from '@/lib/chart/useChartScrub';
import { useDrawIn } from '@/lib/chart/useDrawIn';
import {
  barsForRange,
  CHART_RANGES,
  DEFAULT_CHART_RANGE,
  deltaSeries,
  referenceLine,
  stockScrubLabel,
  type ChartRange,
  type DailyBar,
  type ReferenceLine,
} from '@/lib/money/stockChartSeries';
import { useStockChartData } from '@/lib/money/useStockChartData';

const AnimatedG = Animated.createAnimatedComponent(G);
const HEIGHT = 140;
const SCRUB_LABEL_CLEAR = 48;

interface Layer {
  range: ChartRange;
  geometry: ChartGeometry;
  ref: ReferenceLine;
  rangeBars: DailyBar[];
}

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
  // Memoized: geometry/ref/rangeBars feed a useEffect below keyed on their identity, and an
  // object literal rebuilt every render (even with unchanged values) would retrigger it every
  // render in an infinite loop (found on device, Maximum update depth exceeded).
  const allBars = useMemo<DailyBar[]>(() => {
    if (!live || price == null) return data.bars;
    const todayIso = new Date().toISOString().slice(0, 10);
    return [...data.bars.filter((b) => b.date !== todayIso), { date: todayIso, close: price }];
  }, [data.bars, live, price]);
  const rangeBars = useMemo(() => barsForRange(allBars, range, new Date()), [allBars, range]);
  const ref = useMemo(() => referenceLine(allBars, range, new Date()), [allBars, range]);
  const series = useMemo(() => (ref ? deltaSeries(rangeBars, ref.baseline) : []), [rangeBars, ref]);
  const geometry = useMemo(
    () => (width > 0 && series.length > 0 ? buildChartGeometry(series, width, HEIGHT) : null),
    [series, width],
  );

  // The length-reveal draw-in fires exactly once, the first time bars arrive -- never again
  // on a later range change (that gets the cross-fade below, not another reveal).
  const drawProgress = useDrawIn({
    key: data.status === 'ready' && data.bars.length > 0 ? 'loaded' : 'empty',
    lineLength: geometry?.lineLength ?? 0,
    reduced,
    durationMs: duration.feature,
  });

  // The cross-fade: two layers, old fading out while new fades in simultaneously, so the
  // chart is never blank mid-transition (DL ruling, 2026-10-06). Reduce Motion: an instant
  // swap -- the second layer is never created at all.
  const [displayed, setDisplayed] = useState<Layer | null>(null);
  const [previous, setPrevious] = useState<Layer | null>(null);
  const displayedRef = useRef<Layer | null>(null);
  const oldOpacity = useSharedValue(1);
  const newOpacity = useSharedValue(1);

  useEffect(() => {
    if (!geometry || !ref) return;
    const next: Layer = { range, geometry, ref, rangeBars };
    const prevLayer = displayedRef.current;
    displayedRef.current = next;
    setDisplayed(next);

    if (!prevLayer || prevLayer.range === range) return; // first paint, or just a data refresh

    if (reduced) {
      setPrevious(null);
      newOpacity.value = 1;
      return;
    }
    setPrevious(prevLayer);
    oldOpacity.value = 1;
    oldOpacity.value = withTiming(0, { duration: duration.base, easing: easing.settle });
    newOpacity.value = 0;
    newOpacity.value = withTiming(1, { duration: duration.base, easing: easing.settle }, (finished) => {
      if (finished) runOnJS(setPrevious)(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry/ref/rangeBars derive from range; range is the real trigger.
  }, [range, geometry, ref]);

  const oldProps = useAnimatedProps(() => ({ opacity: oldOpacity.value }));
  const newProps = useAnimatedProps(() => ({ opacity: newOpacity.value }));

  function handleLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  const { scrubIndex, pan, setScrubIndex } = useChartScrub(geometry, reduced);
  const scrubPoint = geometry && scrubIndex != null ? geometry.points[scrubIndex] : null;
  const scrubBar = scrubIndex != null ? rangeBars[scrubIndex] : null;
  const scrubLabel = scrubBar && ref
    ? stockScrubLabel(scrubBar, ref.baseline, scrubIndex === rangeBars.length - 1 && live, new Date())
    : null;

  const endpoint = geometry && geometry.points.length > 0 ? geometry.points[geometry.points.length - 1] : null;
  const endValue = series.length > 0 ? series[series.length - 1] : 0;
  const lineColor = endValue >= 0 ? colors.gain : colors.loss;

  const latestClose = rangeBars.length > 0 ? rangeBars[rangeBars.length - 1].close : null;
  const summary = latestClose != null
    ? `${symbol} price chart, ${range}, ${formatMoney(latestClose)}, ${endValue >= 0 ? 'up' : 'down'} ${formatMoney(Math.abs(endValue))} from ${ref?.text ?? 'the range start'}`
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
        accessibilityValue={scrubLabel ? { text: `${scrubLabel.primary}, ${scrubLabel.price}, ${scrubLabel.money}, ${scrubLabel.percent}` } : undefined}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => stepScrub(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      >
        {width > 0 && displayed ? (
          <GestureDetector gesture={pan}>
            <View>
              <Svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}>
                {previous ? (
                  <AnimatedG animatedProps={oldProps}>
                    <ChartLayerBase layer={previous} width={width} colors={colors} />
                  </AnimatedG>
                ) : null}
                <AnimatedG animatedProps={previous ? newProps : undefined}>
                  <ChartLayerBase layer={displayed} width={width} colors={colors} drawProgress={previous ? 1 : drawProgress} />
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
                  <Text variant="callout" style={{ fontWeight: '700' }} color={scrubLabel.gain ? colors.gain : colors.loss}>
                    {`${scrubLabel.price} · ${scrubLabel.money} · ${scrubLabel.percent}`}
                  </Text>
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

/** One layer's static paint: the reference line, its label, and the price line (full or
 * mid-reveal). No endpoint, no scrub overlay -- those belong to the current layer only,
 * rendered by the caller on top. Shared by both the fading-out and the fading-in layer, so
 * the reference line and its label swap together with the data (DL ruling). */
function ChartLayerBase({ layer, width, colors, drawProgress = 1 }: {
  layer: Layer;
  width: number;
  colors: ReturnType<typeof useTheme>['colors'];
  drawProgress?: number;
}) {
  const { geometry, ref } = layer;
  const lastBar = layer.rangeBars.length > 0 ? layer.rangeBars[layer.rangeBars.length - 1] : null;
  const endValue = lastBar ? lastBar.close - ref.baseline : 0;
  const lineColor = endValue >= 0 ? colors.gain : colors.loss;
  return (
    <>
      <Line x1={0} x2={width} y1={geometry.zeroY} y2={geometry.zeroY} stroke={colors.borderStrong} strokeDasharray="3 4" strokeWidth={1} />
      {/* DL ruling, 2026-10-06: the reference line's own label, below the dashed line
          (board convention, key-screens.html StockSheet) -- swaps with the data. */}
      <SvgText x={2} y={geometry.zeroY + 14} fontSize={11} fontWeight="600" fill={colors.text2}>
        {ref.text}
      </SvgText>
      <Path
        d={drawProgress >= 1 ? geometry.linePath : partialLinePath(geometry.points, drawProgress, geometry.lineLength)}
        stroke={lineColor}
        strokeWidth={2.25}
        strokeLinejoin="round"
        fill="none"
      />
    </>
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
