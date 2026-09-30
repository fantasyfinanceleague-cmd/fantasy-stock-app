/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { SeasonChart } from '@/components/home/SeasonChart';
import { windowSeries, type SeasonGainSeriesResult, type SeasonWindow } from '@/lib/home/seasonGainSeries';
import { SEASON_CARD_TITLE, SEASON_CARD_CAPTION } from '@/lib/home/homeCopy';

// Stockpile — <SeasonCard> (Phase 3b-2, D1 Concept A: "Season gain, week
// by week"). The chart plots the SCORED season (never mark-to-market),
// built by buildSeasonGainSeries — this component only renders what it's
// given, never re-derives a gain.

export interface SeasonCardWeekResult {
  week: number;
  result: 'W' | 'L' | 'T';
}

export interface SeasonCardProps {
  series: SeasonGainSeriesResult;
  weekResults: SeasonCardWeekResult[];
  currentWeek: number;
  isLive: boolean;
}

const WINDOWS: { label: string; value: SeasonWindow }[] = [
  { label: '1W', value: '1W' },
  { label: '1M', value: '1M' },
  { label: 'Season', value: 'Season' },
];

export function SeasonCard({ series, weekResults, currentWeek, isLive }: SeasonCardProps) {
  const { colors } = useTheme();
  const [window, setWindow] = useState<SeasonWindow>('Season');
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  const currentWeekIdx = Math.max(0, currentWeek - 1);
  const windowed = windowSeries(series, window, currentWeekIdx);
  // Each point already carries its own week — no index gymnastics needed.
  const highlightWeek = scrubIndex != null ? windowed[scrubIndex]?.week ?? null : null;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text variant="headline">{SEASON_CARD_TITLE}</Text>
        <Text variant="caption" tone="secondary">
          {SEASON_CARD_CAPTION}
        </Text>
      </View>

      <SeasonChart
        points={windowed}
        live={isLive && window !== '1M'}
        weekStartIdx={window === 'Season' ? series.weekStartIdx : []}
        onScrubIndex={setScrubIndex}
      />

      <View style={styles.chipsRow}>
        {weekResults.map((w) => (
          <View
            key={w.week}
            style={[
              styles.weekChip,
              { backgroundColor: colors.sunken },
              highlightWeek === w.week ? { borderColor: colors.accent, borderWidth: 1.5 } : null,
            ]}
          >
            <Text variant="caption" style={{ color: w.result === 'W' ? colors.gain : w.result === 'L' ? colors.loss : colors.text2, fontWeight: '700' }}>
              {w.result}
            </Text>
            <Text variant="caption" tone="secondary"> W{w.week}</Text>
          </View>
        ))}
        {isLive ? (
          <View style={[styles.weekChip, { backgroundColor: colors.sunken }]}>
            <View style={[styles.liveDotSmall, { backgroundColor: colors.live }]} />
            <Text variant="caption" tone="secondary">
              W{currentWeek}
            </Text>
          </View>
        ) : null}
      </View>

      <SegmentedControl options={WINDOWS} value={window} onChange={(v) => setWindow(v as SeasonWindow)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space[4],
    gap: space[3],
    borderRadius: 14,
  },
  header: {
    paddingHorizontal: space[2],
    gap: space[1],
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    paddingVertical: space[2],
  },
  weekChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    height: 26,
    paddingHorizontal: space[3],
    borderRadius: 999,
    justifyContent: 'center',
  },
  liveDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
