/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState, type ReactNode } from 'react';
import { LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { GestureDetector } from 'react-native-gesture-handler';

import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { partialLinePath } from '@/lib/chart/chartGeometry';
import { useChartScrub } from '@/lib/chart/useChartScrub';
import { useDrawIn } from '@/lib/chart/useDrawIn';
import { buildLine, lineTone, type LinePointIn } from '@/components/sp/logic/lineChart';
import {
  AXIS_GAP, AXIS_LINE_HEIGHT, axisDomain, axisRangeLabel, estimateLabelWidth, layoutAxis, pointName, type AxisSpec,
} from '@/components/sp/logic/chartAxis';

// Stockpile — <Chart>, Game Night (§9C "Chart", rule 6, and "The X axis" — Giorgio,
// 2026-10-12: "Even the chart, like that's such an ugly chart"; "a real X axis with dates";
// this-week charts "Mon…Fri").
//
// One line, 2.5pt, in `gain` / `loss` by the window's sign (flat: `zero`), EDGE TO EDGE:
// pass the screen gutter as `bleed` and the line runs past it to the screen's edges. A
// dashed base line (zero gain, or the start price) in `borderStrong`. No fill, no grid, no
// Y axis. The line stops at the last real point; the end dot is `live` with a 9pt
// `liveGlow` halo, and breathes (LiveDot) only while `live` — the market open and the value
// live. Under it, the X axis: labels only (caption, `text2`, tabular), 6pt below the plot,
// laid out by logic/chartAxis.ts (week: Mon…Fri; dated: start → now). The labels keep to
// the screen gutter even though the line bleeds past it.
//
// Short states are designed, never blank: 0 points → the base line and the full axis;
// 1 point → the dot alone (a week on Monday morning: a dot at Monday's open).
//
// Motion (§9C): the line draws left to right once per `drawKey` (lib/chart/useDrawIn);
// Reduce Motion shows it drawn. Scrub: long-press and drag; the label names the day or date
// ("Wed · +$41.26"); VoiceOver steps the points (adjustable) and hears the range first.

export interface ChartProps {
  points: LinePointIn[];
  /** The dashed base line's value (0 for a gain series; the start price for a price line). */
  base: number;
  axis: AxisSpec;
  /** The plot's height (the axis row adds below it). */
  height?: number;
  /** The screen gutter the line runs past to the screen's edge. */
  bleed?: number;
  /** The end dot breathes: the market is open and the value is live. */
  live?: boolean;
  /** A new value draws the line in again (a range change); the same key never redraws. */
  drawKey?: string;
  /** How a point's value reads in the scrub label and to VoiceOver ("+$41.26"). */
  formatValue: (value: number) => string;
  /** What the chart is ("NVDA this week"); the range and the last value follow it. */
  accessibilityLabel: string;
  /** A row the Chart lays out but doesn't own: Home's W/L marks. */
  under?: ReactNode;
  /** Where `under` sits. 'beforeAxis' puts it between the plot and the axis labels: Home's
   * season chart as the board draws it (directions.jsx Line: the marks at h−22, the two end
   * dates — `axis.maxLabels: 2` — at h−3, under the marks). 'afterAxis' (the default) puts
   * it below the labels. */
  underPlacement?: 'beforeAxis' | 'afterAxis';
}

const STROKE = 2.5;
const DOT_R = 4.5;
const HALO_R = 9;
const PAD = { top: HALO_R + 3, bottom: HALO_R, left: 2, right: HALO_R + 3 };
// The scrub label sits beside the scrubbed point, flipping side past the middle.
const SCRUB_HALF = 40;
// A centred label's box is widened this much on each side, so a wide glyph never truncates it.
const LABEL_SLACK = 12;

export function Chart({ points, base, axis, height = 124, bleed = 0, live = false, drawKey = 'chart', formatValue, accessibilityLabel, under, underPlacement = 'afterAxis' }: ChartProps) {
  const { colors } = useTheme();
  const { reduced, duration } = useMotion();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);

  const geometry = buildLine(points, axisDomain(axis), base, {
    width, height, padLeft: PAD.left, padRight: PAD.right, padTop: PAD.top, padBottom: PAD.bottom,
  });
  const tone = lineTone(points, base);
  const lineColor = colors[tone];

  const progress = useDrawIn({ key: drawKey, lineLength: geometry.length, reduced, durationMs: duration.feature });
  const path = progress >= 1 || geometry.length === 0 ? geometry.path : partialLinePath(geometry.points, progress, geometry.length);

  const { scrubIndex, pan, setScrubIndex } = useChartScrub(width > 0 ? geometry : null, reduced);
  const scrubbed = scrubIndex != null ? points[scrubIndex] : null;
  const scrubPx = scrubIndex != null ? geometry.points[scrubIndex] : null;
  const scrubText = scrubbed ? `${pointName(axis, scrubbed.t)} · ${formatValue(scrubbed.value)}` : null;

  // Labels keep to the gutter: lay them out over the inner width, then shift back by `bleed`.
  const inner = Math.max(0, width - 2 * bleed);
  const labels = width > 0 ? layoutAxis(axis, inner, (t) => geometry.toX(t) - bleed, (s) => estimateLabelWidth(s, fontScale)) : [];

  const last = points.length ? points[points.length - 1] : null;
  const range = axisRangeLabel(axis, last?.t);
  const summary = `${accessibilityLabel}, ${range}${last ? `, ${formatValue(last.value)}` : ''}`;
  // The line runs edge to edge, but the end dot keeps its whole halo on screen (a Monday-
  // morning dot sits at the very first x).
  const end = geometry.end ? { x: Math.min(Math.max(geometry.end.x, HALO_R + 1), width - HALO_R - 1), y: geometry.end.y } : null;
  // A 0/1-point line has no length to draw in (useDrawIn waits for one), so its dot shows at once.
  const drawn = progress >= 1 || geometry.length === 0;
  const endVisible = end && drawn && !scrubPx;

  function step(dir: 1 | -1) {
    if (!points.length) return;
    const from = scrubIndex ?? points.length - 1;
    setScrubIndex(Math.min(points.length - 1, Math.max(0, from + dir)));
  }

  return (
    <View
      style={{ marginHorizontal: -bleed }}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={summary}
      accessibilityValue={scrubText ? { text: scrubText } : undefined}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
    >
      {width > 0 ? (
        <GestureDetector gesture={pan}>
          <View style={{ height }}>
            <Svg width={width} height={height}>
              <Line x1={0} x2={width} y1={geometry.baseY} y2={geometry.baseY} stroke={colors.borderStrong} strokeWidth={1} strokeDasharray="3 5" />
              {path ? <Path testID="chart-line" d={path} stroke={lineColor} strokeWidth={STROKE} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
              {endVisible && !live ? (
                <>
                  <Circle cx={end.x} cy={end.y} r={HALO_R} fill={colors.liveGlow} />
                  <Circle cx={end.x} cy={end.y} r={DOT_R} fill={colors.live} />
                </>
              ) : null}
              {scrubPx ? (
                <>
                  <Line x1={scrubPx.x} x2={scrubPx.x} y1={0} y2={height} stroke={colors.text2} strokeWidth={1} />
                  <Circle cx={scrubPx.x} cy={scrubPx.y} r={DOT_R} fill={colors.accent} />
                </>
              ) : null}
            </Svg>
            {endVisible && live ? (
              <View pointerEvents="none" style={[styles.liveDot, { left: end.x - HALO_R, top: end.y - HALO_R }]}>
                <LiveDot size={DOT_R * 2} />
              </View>
            ) : null}
            {scrubText && scrubPx ? (
              <Text
                variant="caption"
                style={[styles.scrub, scrubPx.x > width / 2 ? { right: Math.max(bleed, width - scrubPx.x - SCRUB_HALF) } : { left: Math.max(bleed, scrubPx.x - SCRUB_HALF) }]}
                numberOfLines={1}
              >
                {scrubText}
              </Text>
            ) : null}
          </View>
        </GestureDetector>
      ) : (
        <View style={{ height }} />
      )}
      {under && underPlacement === 'beforeAxis' ? <View testID="chart-under-before-axis" style={[styles.underBefore, { marginHorizontal: bleed }]}>{under}</View> : null}
      <View style={[styles.axis, underPlacement === 'beforeAxis' && under ? styles.axisAfterUnder : null, { height: AXIS_LINE_HEIGHT * fontScale + 2 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {labels.map((l) => (
          // Anchored by the aligned edge, never given the estimated width, so a glyph wider
          // than the estimate can't truncate the label (the estimate only decides which fit).
          <Text
            key={`${l.text}@${l.x}`}
            variant="caption"
            tone="secondary"
            numberOfLines={1}
            style={[
              styles.label,
              l.align === 'left' ? { left: l.left + bleed }
                : l.align === 'right' ? { right: width - (l.left + l.width + bleed), textAlign: 'right' }
                  : { left: l.left + bleed - LABEL_SLACK, width: l.width + 2 * LABEL_SLACK, textAlign: 'center' },
            ]}
          >
            {l.text}
          </Text>
        ))}
      </View>
      {under && underPlacement === 'afterAxis' ? <View style={{ marginHorizontal: bleed }}>{under}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  liveDot: {
    position: 'absolute',
    width: HALO_R * 2,
    height: HALO_R * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrub: {
    position: 'absolute',
    top: 0,
  },
  // §9C: 6pt between the plot's lowest point (PAD.bottom above the SVG's bottom) and the labels.
  axis: {
    marginTop: AXIS_GAP - PAD.bottom,
  },
  // With the marks between the plot and the labels, the marks take the 6pt gap under the
  // plot and the labels follow them directly.
  underBefore: {
    marginTop: AXIS_GAP - PAD.bottom,
  },
  axisAfterUnder: {
    marginTop: 0,
  },
  label: {
    position: 'absolute',
    top: 0,
    fontVariant: ['tabular-nums'],
  },
});

