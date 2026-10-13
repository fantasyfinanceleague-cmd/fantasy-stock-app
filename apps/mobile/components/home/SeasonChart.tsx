/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { useTheme } from '@/components/sp/ThemeProvider';
import { Text } from '@/components/sp/Text';
import { Chart, type UnderRow } from '@/components/sp/gn';
import { formatMoney } from '@/components/sp/logic/money';
import { dayOffset, type AxisSpec } from '@/components/sp/logic/chartAxis';
import type { SeasonGainPoint } from '@/lib/home/seasonGainSeries';
import { weekMarks, MARK_MAX_FONT_SCALE, LIVE_MARK_SIZE, PIP_SIZE, PIP_RING_STROKE, type WeekMark, type WeekMarkInput, type WeekMarkTone } from '@/lib/home/weekMarks';

// Stockpile — <SeasonChart>, Home's season line on the Game Night <Chart> (§9C "Chart",
// W4, 2026-10-12; the calm-Home chart, decided A). Season gain, week by week: one line in
// `gain`/`loss` by the window's sign, edge to edge, a dashed zero line, no fill, no grid,
// no Y axis; the end dot in `live` with its halo, breathing only while the market is open
// in a regular week (the caller's `live`; B′ in the playoffs is the static dot).
//
// Under the plot, in this order (the board's Line: the marks at h−22, the dates at h−3):
//   1. the W/L marks, each centred under its week's span (lib/home/weekMarks), in the
//      Season window only: "W" gain, "L" loss, "T"/"Bye" text2, the live week a 6pt dot,
//      a dense season the 5pt shapes (never colour alone);
//   2. the X axis: TWO dates (`maxLabels: 2`), the first point's under the first mark and
//      the last point's (today) at the live end (Giorgio, 2026-10-12: two end dates).
// The axis is DATED (calendar days from the first point), the §9C rule for every dated
// range; the line stops at the last real point, so there are no future slots.
//
// Motion: the line draws in once per `drawKey` (S-5: the window, never a value — the 30 s
// live poll moves the end in place); a league switch (`skipEntrance`, H5) shows it drawn.
// Scrub: long-press and drag; the label names the date ("Oct 6 · +$41.26") and the
// scrubbed week's mark is underlined in the accent. Reduce Motion: drawn at once, no ticks.

export interface SeasonChartProps {
  points: SeasonGainPoint[];
  live?: boolean;
  weekStartIdx: number[];
  /** True when this mount was caused by a LEAGUE SWITCH, not Home's first open (H5,
   * Design Lead ruling 2026-09-29, Blocking 1): the first draw shows the line drawn. Later
   * window changes within the SAME league still draw in. */
  skipEntrance?: boolean;
  /** What the line draws in for (S-5): the chart's window ('1W' | '1M' | 'Season'). */
  drawKey?: string;
  /** The PLOT's height; the marks and the date row add below it. */
  height?: number;
  /** The screen gutter the line runs past to the screen's edges. */
  bleed?: number;
  /** One result per week of the series (parallel to `weekStartIdx`): the axis marks.
   * Omitted (or empty) in the 1W/1M windows, which have no week ticks. */
  markResults?: WeekMarkInput[];
  /** What the chart is, for VoiceOver (Home lists the week results in it). */
  accessibilityLabel: string;
}

/** ISO calendar day of a series date (ET dates as the data carries them). */
function day(iso: string): string {
  return iso.slice(0, 10);
}

/** The dated axis for a window's points: first point → last point (now). */
export function seasonAxis(points: SeasonGainPoint[], today: string): AxisSpec {
  const start = points.length ? day(points[0].date) : today;
  const end = points.length ? day(points[points.length - 1].date) : today;
  return { kind: 'dated', start, end, maxLabels: 2 };
}

export function SeasonChart({
  points, live = false, weekStartIdx, skipEntrance = false, drawKey = 'season', height, bleed = 0, markResults, accessibilityLabel,
}: SeasonChartProps) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const showMarks = !!markResults && markResults.length > 0;
  const [scrubbedWeek, setScrubbedWeek] = useState<number | null>(null);

  const axis = seasonAxis(points, new Date().toISOString().slice(0, 10));
  const start = axis.kind === 'dated' ? axis.start : '';
  const line = points.map((p) => ({ t: dayOffset(start, day(p.date)), value: p.gain }));
  const toneColor = (t: WeekMarkTone) => (t === 'gain' ? colors.gain : t === 'loss' ? colors.loss : t === 'live' ? colors.live : colors.text2);

  const marksRow = ({ xs, width }: UnderRow) => {
    const marks = weekMarks(xs.map((x) => ({ x })), weekStartIdx, markResults!, width, fontScale);
    return (
      <View style={{ height: marksRowHeight(fontScale) }} pointerEvents="none">
        {marks.map((m) => (
          // RN Text (not SVG) so the marks follow Dynamic Type, capped at 1.3x. A wide,
          // centred box: the glyph is centred on the mark's x whatever its true width.
          <View key={m.week} style={[styles.mark, { left: m.x - MARK_BOX / 2 }]}>
            {m.glyph === 'live' || m.glyph === 'pipDot' || m.glyph === 'pipRing' || m.glyph === 'pipDash' ? (
              <View style={styles.markShape}>
                <View style={shapeStyle(m, toneColor(m.tone))} />
              </View>
            ) : (
              <Text variant="caption" maxFontSizeMultiplier={MARK_MAX_FONT_SCALE} numberOfLines={1} style={[styles.markText, { color: toneColor(m.tone) }]}>
                {m.glyph}
              </Text>
            )}
            <View style={[styles.markUnderline, { width: Math.max(m.w, LIVE_MARK_SIZE + PIP_SIZE), backgroundColor: scrubbedWeek === m.week ? colors.accent : 'transparent' }]} />
          </View>
        ))}
      </View>
    );
  };

  return (
    <Chart
      points={line}
      base={0}
      axis={axis}
      height={height}
      bleed={bleed}
      live={live}
      drawKey={drawKey}
      skipEntrance={skipEntrance}
      onScrubIndex={(i) => setScrubbedWeek(i != null ? points[i]?.week ?? null : null)}
      formatValue={(v) => formatMoney(v, { sign: 'always' })}
      accessibilityLabel={accessibilityLabel}
      under={showMarks ? marksRow : undefined}
      underPlacement="beforeAxis"
    />
  );
}

/** A shape mark: the live dot, or a dense season's dot / ring / dash (never colour alone). */
function shapeStyle(m: WeekMark, color: string) {
  if (m.glyph === 'pipRing') return { width: m.w, height: m.w, borderRadius: m.w / 2, borderWidth: PIP_RING_STROKE, borderColor: color };
  if (m.glyph === 'pipDash') return { width: m.w, height: 2, borderRadius: 1, backgroundColor: color };
  return { width: m.w, height: m.w, borderRadius: m.w / 2, backgroundColor: color };
}

// The box each axis mark is centred in (wider than any glyph, even "Bye" at 1.3x).
const MARK_BOX = 40;
// The marks' caption line; the row adds the scrub underline (2, with 1 above it).
const MARK_LINE = 16;
/** The marks row's height at a font scale (the marks cap at 1.3x). */
function marksRowHeight(fontScale: number): number {
  return Math.ceil(MARK_LINE * Math.min(Math.max(fontScale, 1), MARK_MAX_FONT_SCALE)) + 3;
}

const styles = StyleSheet.create({
  mark: {
    position: 'absolute',
    top: 0,
    width: MARK_BOX,
    alignItems: 'center',
  },
  markShape: {
    height: MARK_LINE,
    justifyContent: 'center',
  },
  markText: {
    fontWeight: '800',
    textAlign: 'center',
  },
  markUnderline: {
    height: 2,
    borderRadius: 1,
    marginTop: 1,
  },
});
