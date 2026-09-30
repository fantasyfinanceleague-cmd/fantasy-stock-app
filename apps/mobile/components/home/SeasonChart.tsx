/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, Line, Path, Rect, Circle } from 'react-native-svg';
import Animated, { runOnJS, useAnimatedProps, useSharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';

import { space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { formatMoney } from '@/components/sp/logic/money';
import { seasonScrubLabel } from '@/lib/home/homeCopy';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { buildChartGeometry, nearestPointIndex } from '@/lib/home/chartGeometry';
import type { SeasonGainPoint } from '@/lib/home/seasonGainSeries';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Stockpile — <SeasonChart> (Phase 3b-2, D1 Concept A: "Season gain, week
// by week"). Zero baseline, gain fill above / loss fill below via two
// clip-rects at the zero line — mirrors the design board's own GainChart
// (docs/design/screens/screens.jsx) approach exactly.
//
// H2: the line draws in on first view (`feature` duration) via the
// standard pathLength=1 / strokeDashoffset trick; a window change morphs
// between paths at `base`. The live endpoint gets the pulsing dot ONLY
// while the market is open (the caller passes `live`). Scrub: a
// long-press-then-drag Pan gesture shows a floating (date · gain) label
// and fires one light haptic per trading-day index change; the matching
// week chip highlight is the caller's job (onScrubIndex).
//
// Reduce Motion: the line appears fully drawn, a window change swaps
// instantly, and the scrub label still works with no haptic ticks (§5).

export interface SeasonChartProps {
  points: SeasonGainPoint[];
  live?: boolean;
  weekStartIdx: number[];
  onScrubIndex?: (index: number | null) => void;
  /** True when this mount was caused by a LEAGUE SWITCH, not Home's first
   * open (H5, Design Lead ruling 2026-09-29, Blocking 1) — the very first
   * draw after the switch shows the new line already fully drawn, with no
   * H2 draw-in to replay. Later window changes within the SAME league
   * still draw in as usual. */
  skipEntrance?: boolean;
}

const HEIGHT = 148;

export function SeasonChart({ points, live = false, weekStartIdx, onScrubIndex, skipEntrance = false }: SeasonChartProps) {
  const { colors } = useTheme();
  const { reduced, duration, easing, withTiming } = useMotion();
  const [width, setWidth] = useState(0);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const lastHapticIndex = useRef<number | null>(null);
  const drawProgress = useSharedValue(reduced || skipEntrance ? 1 : 0);
  const skippedFirstDraw = useRef(false);

  const series = points.map((p) => p.gain);
  const geometry = width > 0 ? buildChartGeometry(series, width, HEIGHT) : null;

  // H2: draw on first view only (a window/series change morphs instead —
  // approximated here as a re-draw, since a true morph between differing
  // point counts needs path interpolation this pass doesn't build).
  const currentKey = series.join(',');
  useEffect(() => {
    if (reduced) {
      drawProgress.value = 1;
      return;
    }
    if (skipEntrance && !skippedFirstDraw.current) {
      // The mount this component was created with — already handled by
      // this shared value's own initializer above. Only skip ONCE: a
      // window change right after a switch should still draw in.
      skippedFirstDraw.current = true;
      return;
    }
    drawProgress.value = 0;
    drawProgress.value = withTiming(1, { duration: duration.feature, easing: easing.settle });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-running per `currentKey` change is the point (a new series draws in); duration/easing/withTiming are stable per render from useMotion().
  }, [currentKey, reduced]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: 1 - drawProgress.value,
  }));

  function handleLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  function updateScrub(x: number) {
    if (!geometry) return;
    const idx = nearestPointIndex(geometry.points, x);
    if (idx !== scrubIndex) {
      setScrubIndex(idx);
      onScrubIndex?.(idx);
      if (!reduced && idx !== lastHapticIndex.current) {
        Haptics.selectionAsync().catch(() => {});
      }
      lastHapticIndex.current = idx;
    }
  }

  function endScrub() {
    setScrubIndex(null);
    onScrubIndex?.(null);
    lastHapticIndex.current = null;
  }

  // Reanimated auto-workletizes these callbacks and runs them on the UI
  // thread; `updateScrub`/`endScrub` call `setState` and `Haptics`, plain
  // JS that must run on the JS thread — found in code review (2026-09-29)
  // as a likely crash on the first long-press. `runOnJS` is what
  // LeagueSheet.tsx / OnboardingPager.tsx already use for the same reason.
  const pan = Gesture.Pan()
    .activateAfterLongPress(120)
    .onUpdate((e) => runOnJS(updateScrub)(e.x))
    .onEnd(() => runOnJS(endScrub)())
    .onFinalize(() => runOnJS(endScrub)());

  const scrubPoint = geometry && scrubIndex != null ? geometry.points[scrubIndex] : null;
  const scrubValue = scrubIndex != null ? points[scrubIndex] : null;
  const scrubLabel = scrubValue && scrubIndex != null
    ? seasonScrubLabel(scrubValue, scrubIndex > 0 ? points[scrubIndex - 1].gain : null)
    : null;

  const endpoint = geometry && geometry.points.length > 0 ? geometry.points[geometry.points.length - 1] : null;
  const endValue = series.length > 0 ? series[series.length - 1] : 0;

  return (
    <View style={styles.wrap} onLayout={handleLayout} accessible accessibilityRole="image" accessibilityLabel={`Season gain: ${formatMoney(endValue)}`}>
      {width > 0 && geometry ? (
        <GestureDetector gesture={pan}>
          <View>
            <Svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}>
              <Defs>
                <ClipPath id="gainClip">
                  <Rect x={0} y={0} width={width} height={geometry.zeroY} />
                </ClipPath>
                <ClipPath id="lossClip">
                  <Rect x={0} y={geometry.zeroY} width={width} height={HEIGHT - geometry.zeroY} />
                </ClipPath>
              </Defs>
              <Path d={geometry.areaPath} fill={colors.gain} opacity={0.1} clipPath="url(#gainClip)" />
              <Path d={geometry.areaPath} fill={colors.loss} opacity={0.1} clipPath="url(#lossClip)" />
              <Line x1={0} x2={width} y1={geometry.zeroY} y2={geometry.zeroY} stroke={colors.borderStrong} strokeDasharray="3 4" strokeWidth={1} />
              <AnimatedPath
                d={geometry.linePath}
                // react-native-svg 15's TS types omit `pathLength`, even
                // though RNSVG supports the attribute at runtime (the
                // standard "normalize the path to length 1" trick this
                // draw-in animation relies on) — cast only this one prop.
                {...({ pathLength: 1 } as { pathLength: number })}
                strokeDasharray="1"
                animatedProps={animatedProps}
                stroke={endValue >= 0 ? colors.gain : colors.loss}
                strokeWidth={2}
                fill="none"
              />
              {endpoint && !scrubPoint && !live ? (
                <Circle cx={endpoint.x} cy={endpoint.y} r={4} fill={endValue >= 0 ? colors.gain : colors.loss} stroke={colors.surface} strokeWidth={2} />
              ) : null}
              {scrubPoint ? (
                <>
                  <Line x1={scrubPoint.x} x2={scrubPoint.x} y1={0} y2={HEIGHT} stroke={colors.text2} strokeWidth={1} />
                  <Circle cx={scrubPoint.x} cy={scrubPoint.y} r={5} fill={colors.accent} />
                </>
              ) : null}
              {weekStartIdx.map((idx, w) => {
                const p = geometry.points[idx];
                if (!p) return null;
                return <Line key={w} x1={p.x} x2={p.x} y1={HEIGHT - 20} y2={HEIGHT - 16} stroke={colors.borderStrong} strokeWidth={1} />;
              })}
            </Svg>
            {endpoint && !scrubPoint && live ? (
              // LiveDot is an RN View (its halo pulse is a reanimated
              // View transform, not an SVG element), so the ONLY loop on
              // this screen (spec §4: "the live dot while the market is
              // open") is overlaid on top of the SVG at the endpoint's
              // pixel position, rather than forced into the SVG tree.
              <View style={[styles.liveDotOverlay, { left: endpoint.x - 4, top: endpoint.y - 4 }]} pointerEvents="none">
                <LiveDot size={8} />
              </View>
            ) : null}
            {scrubLabel ? (
              <View style={[styles.scrubLabel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text variant="caption" tone="secondary">
                  {scrubLabel.primary}
                </Text>
                <Text variant="callout" style={{ fontWeight: '700' }}>
                  {scrubLabel.money}
                </Text>
              </View>
            ) : null}
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  scrubLabel: {
    position: 'absolute',
    top: 0,
    left: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  liveDotOverlay: {
    position: 'absolute',
  },
});
