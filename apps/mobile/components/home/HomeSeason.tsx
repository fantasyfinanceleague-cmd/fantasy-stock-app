import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { space } from '@/constants/tokens';
import { RangePills } from '@/components/sp/gn';
import { SeasonChart } from '@/components/home/SeasonChart';
import { windowSeries, type SeasonGainSeriesResult, type SeasonWindow } from '@/lib/home/seasonGainSeries';
import { HOME_CHART_HEIGHT } from '@/lib/home/calmHome';
import { RANGE_TABS, marksShownFor, regularMarkResults, seasonChartA11yLabel, chartLiveEnd, rangeTabsPullUp, rangeTabsSlackBelow } from '@/lib/home/weekMarks';

// Stockpile — <HomeSeason> (a calm Home, decided A, 2026-10-12; Game Night, W4). The old
// Season card's contents, part of the hero block with no card, title or caption (the
// hero's line already says "season gain"): the season line edge to edge (its W/L marks
// and two end dates under it, components/home/SeasonChart) and the range as Game Night
// text tabs (RangePills "tabs": the selected one in `text` with a 2pt `accent`
// underline), right-aligned under it. The chart plots the SCORED season, week by week
// (buildSeasonGainSeries, windowSeries); this component only renders what it's given.

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

const RANGE_OPTIONS = RANGE_TABS.map((t) => t.value);

export function HomeSeason({ series, weekResults, currentWeek, marketOpen, isPlayoff, currentScored, skipEntrance = false }: HomeSeasonProps) {
  const { fontScale } = useWindowDimensions();
  const [window, setWindow] = useState<SeasonWindow>('Season');

  const currentWeekIdx = Math.max(0, currentWeek - 1);
  const windowed = windowSeries(series, window, currentWeekIdx);
  const live = chartLiveEnd(marketOpen, isPlayoff);
  const chartWeeks = series.weekStartIdx.map((i) => series.points[i]?.week).filter((w): w is number => typeof w === 'number');
  const results = regularMarkResults({ chartWeeks, weeklyResults: weekResults, currentWeek, isLive: live, currentScored });
  const seasonEnd = series.points.length ? series.points[series.points.length - 1].gain : 0;

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
        // Edge to edge (§9C Chart): the line runs past the 20pt gutter; marks and dates keep to it.
        bleed={space[6]}
      />
      {/* F1 (Design Lead gate): the tab labels sit 8pt under the date labels, glyph to glyph
          (rangeTabsPullUp); the row draws after the chart, so its pulled-up box overlaps only
          the date row's empty strip, and every tab keeps its 44pt target. The box's strip
          under the underline is taken back (rangeTabsSlackBelow), so the 24pt block gap is
          measured from the underline. */}
      <View style={{ marginTop: -rangeTabsPullUp(fontScale), marginBottom: -rangeTabsSlackBelow(fontScale) }}>
        <RangePills options={RANGE_OPTIONS} value={window} onChange={setWindow} variant="tabs" />
      </View>
    </>
  );
}
