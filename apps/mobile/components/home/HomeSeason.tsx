/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { type } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { SeasonChart } from '@/components/home/SeasonChart';
import { windowSeries, type SeasonGainSeriesResult, type SeasonWindow } from '@/lib/home/seasonGainSeries';
import { HOME_CHART_HEIGHT } from '@/lib/home/calmHome';
import {
  RANGE_TABS, RANGE_TAB_MAX_FONT_SCALE, RANGE_TAB_UNDERLINE, MIN_HIT, marksShownFor, rangeTabHitSlop, rangeTabLook,
  regularMarkResults, seasonChartA11yLabel, chartLiveEnd,
} from '@/lib/home/weekMarks';

// Stockpile — <HomeSeason> (a calm Home, decided A, 2026-10-12). The old Season
// card's contents, now part of the hero block with no card, title or caption (the
// hero's line already says "season gain"): the chart (124pt, W/L marks on its axis in
// the Season window) and the range as text tabs under it, right-aligned. The chart
// still plots the SCORED season, week by week (buildSeasonGainSeries, windowSeries);
// this component only renders what it's given.

export interface HomeSeasonProps {
  series: SeasonGainSeriesResult;
  /** The view model's per-week results (past regular weeks, plus a current bye). */
  weekResults: { week: number; result: 'W' | 'L' | 'T' | 'BYE' }[];
  currentWeek: number;
  /** The market is open this week (the This week card's live state). */
  marketOpen: boolean;
  /** The current week is a playoff week: the line's end is the static dot (B′). */
  isPlayoff: boolean;
  /** The current week's posted result, when it is a scored regular week. */
  currentScored: 'W' | 'L' | 'T' | null;
  /** See SeasonChart's own doc — threaded straight through (H5). */
  skipEntrance?: boolean;
}

export function HomeSeason({ series, weekResults, currentWeek, marketOpen, isPlayoff, currentScored, skipEntrance = false }: HomeSeasonProps) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const [window, setWindow] = useState<SeasonWindow>('Season');

  const currentWeekIdx = Math.max(0, currentWeek - 1);
  const windowed = windowSeries(series, window, currentWeekIdx);
  const live = chartLiveEnd(marketOpen, isPlayoff);
  const chartWeeks = series.weekStartIdx.map((i) => series.points[i]?.week).filter((w): w is number => typeof w === 'number');
  const results = regularMarkResults({ chartWeeks, weeklyResults: weekResults, currentWeek, isLive: live, currentScored });
  const seasonEnd = series.points.length ? series.points[series.points.length - 1].gain : 0;

  // The tab's content: callout (capped at 1.3x) + the underline and its air.
  const tabContent = type.callout.lineHeight * Math.min(Math.max(fontScale, 1), RANGE_TAB_MAX_FONT_SCALE) + RANGE_TAB_UNDERLINE * 2;
  const hitSlop = rangeTabHitSlop(tabContent);

  return (
    <>
      <SeasonChart
        points={windowed}
        live={live}
        weekStartIdx={window === 'Season' ? series.weekStartIdx : []}
        markResults={marksShownFor(window) ? results : undefined}
        accessibilityLabel={seasonChartA11yLabel(seasonEnd, results)}
        skipEntrance={skipEntrance}
        drawKey={window}
        height={HOME_CHART_HEIGHT}
      />
      <View style={styles.tabs} accessibilityRole="tablist">
        {RANGE_TABS.map((t) => {
          const selected = t.value === window;
          const look = rangeTabLook(selected);
          return (
            <Pressable
              key={t.value}
              onPress={() => setWindow(t.value)}
              hitSlop={hitSlop}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
            >
              {/* The underline is the label's own width (the inner view hugs the text). */}
              <View>
                <Text
                  variant="callout"
                  maxFontSizeMultiplier={RANGE_TAB_MAX_FONT_SCALE}
                  style={{ fontWeight: look.fontWeight, color: colors[look.color] }}
                >
                  {t.label}
                </Text>
                <View style={[styles.underline, { backgroundColor: look.underline ? colors.text : 'transparent' }]} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  // Each tab is at least MIN_HIT wide on its own (no shared hit areas); the short labels
  // sit centred in theirs, so the labels read about 18-24pt apart. The vertical hit area
  // reaches MIN_HIT through hitSlop, so the row stays the text's own height.
  tab: {
    minWidth: MIN_HIT,
    alignItems: 'center',
    paddingTop: RANGE_TAB_UNDERLINE,
  },
  underline: {
    height: RANGE_TAB_UNDERLINE,
  },
});
