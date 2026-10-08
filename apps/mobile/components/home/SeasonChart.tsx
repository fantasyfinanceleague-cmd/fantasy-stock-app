/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, Line, Path, Rect, Circle, Text as SvgText } from 'react-native-svg';
import { GestureDetector } from 'react-native-gesture-handler';

import { space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { formatMoney } from '@/components/sp/logic/money';
import { CHART_ZERO_LABEL, seasonScrubLabel } from '@/lib/home/homeCopy';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { buildChartGeometry, partialLinePath } from '@/lib/chart/chartGeometry';
import { useChartScrub } from '@/lib/chart/useChartScrub';
import { useDrawIn } from '@/lib/chart/useDrawIn';
import type { SeasonGainPoint } from '@/lib/home/seasonGainSeries';

// Height the scrub label needs at the top edge (S1): a point above this line
// flips its label below the point.
const SCRUB_LABEL_CLEAR = 52;

// Stockpile — <SeasonChart> (Phase 3b-2, D1 Concept A: "Season gain, week
// by week"). Zero baseline, gain fill above / loss fill below via two
// clip-rects at the zero line — mirrors the design board's own GainChart
// (docs/design/screens/screens.jsx) approach exactly.
//
// H2: the line draws in on first view (`feature` duration) via the
// solid dash of the line's real length, with strokeDashoffset drawing it
// in (B1, 2026-10-05); a window change morphs
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
  const { reduced, duration } = useMotion();
  const [width, setWidth] = useState(0);

  const series = points.map((p) => p.gain);
  // x-extent is exactly the real points on screen -- through the CURRENT
  // week, never the whole regular season padded out to a hypothetical
  // future Friday (Design Lead ruling, 2026-09-30, board convention).
  const positions = points.map((p) => p.dayIndex);
  const geometry = width > 0 ? buildChartGeometry(series, width, HEIGHT, {}, positions) : null;
  const lineLength = geometry?.lineLength ?? 0;

  // H2: the line draws in on first view, and again after a window or series
  // change (lib/chart/useDrawIn, shared with 3e's stock chart, M2).
  const drawProgress = useDrawIn({
    key: series.join(','),
    lineLength,
    reduced,
    durationMs: duration.feature,
    skipFirst: skipEntrance,
  });

  function handleLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  // The scrub gesture (lib/chart/useChartScrub, shared with 3e's stock chart, M2).
  const { scrubIndex, pan } = useChartScrub(geometry, reduced, onScrubIndex);

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
              {/* S4 (Design Lead, 2026-09-30): the board's "$0" baseline
                  label, board-verbatim position (x=2, just above the zero
                  line) -- screens.jsx's GainChart. */}
              <SvgText x={2} y={geometry.zeroY - 6} fontSize={11} fontWeight="600" fill={colors.text2}>
                {CHART_ZERO_LABEL}
              </SvgText>
              <Path
                d={drawProgress >= 1 ? geometry.linePath : partialLinePath(geometry.points, drawProgress, lineLength)}
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
              // S1 (Design Lead gate, 2026-10-05): a point in the top strip would
              // sit under a label pinned to the top edge, so the label drops below it.
              <View style={[styles.scrubLabel, scrubPoint && scrubPoint.y < SCRUB_LABEL_CLEAR ? { top: scrubPoint.y + 12 } : null, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
