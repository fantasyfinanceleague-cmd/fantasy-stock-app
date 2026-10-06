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
import { playoffRoundLabelForWeek, playoffRoundShortName } from '@/lib/playoffs';

// Stockpile — <SeasonCard> (Phase 3b-2, D1 Concept A: "Season gain, week
// by week"). The chart plots the SCORED season (never mark-to-market),
// built by buildSeasonGainSeries — this component only renders what it's
// given, never re-derives a gain.

export interface SeasonCardWeekResult {
  week: number;
  /** S7 (Design Lead, 2026-09-30): a regular-season bye still gets its own
   * chip ("Bye W6") -- Giorgio's "never a W/L chip" rule (2026-09-29) is
   * about never colouring a bye green/red as a win or loss, not about
   * hiding the week from the row entirely. */
  result: 'W' | 'L' | 'T' | 'BYE';
}

export interface SeasonCardProps {
  series: SeasonGainSeriesResult;
  weekResults: SeasonCardWeekResult[];
  currentWeek: number;
  isLive: boolean;
  /** For the week chips' playoff round short-names (B7) -- null/undefined
   * degrades every week to the plain "W{n}" chip, same as before. */
  numWeeks?: number | null;
  playoffTeams?: number | null;
  /** See SeasonChart's own doc — threaded straight through (H5). */
  skipEntrance?: boolean;
}

/** "W6" for a regular-season week, "WC"/"SF"/"F" for a playoff one (B7,
 * Design Lead ruling, 2026-09-30) -- never "W15", which named nothing a
 * viewer could place on the bracket. */
function weekChipLabel(week: number, numWeeks: number | null | undefined, playoffTeams: number | null | undefined): string {
  const round = playoffRoundLabelForWeek(week, numWeeks, playoffTeams);
  return round ? playoffRoundShortName(round) : `W${week}`;
}

const WINDOWS: { label: string; value: SeasonWindow }[] = [
  { label: '1W', value: '1W' },
  { label: '1M', value: '1M' },
  { label: 'Season', value: 'Season' },
];

export function SeasonCard({ series, weekResults, currentWeek, isLive, numWeeks, playoffTeams, skipEntrance = false }: SeasonCardProps) {
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
        live={isLive}
        weekStartIdx={window === 'Season' ? series.weekStartIdx : []}
        onScrubIndex={setScrubIndex}
        skipEntrance={skipEntrance}
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
            {w.result === 'BYE' ? (
              <Text variant="caption" tone="secondary">Bye</Text>
            ) : (
              <Text variant="caption" style={{ color: w.result === 'W' ? colors.gain : w.result === 'L' ? colors.loss : colors.text2, fontWeight: '700' }}>
                {w.result}
              </Text>
            )}
            <Text variant="caption" tone="secondary"> {weekChipLabel(w.week, numWeeks, playoffTeams)}</Text>
          </View>
        ))}
        {isLive ? (
          <View style={[styles.weekChip, { backgroundColor: colors.sunken }]}>
            <View style={[styles.liveDotSmall, { backgroundColor: colors.live }]} />
            <Text variant="caption" tone="secondary">
              {weekChipLabel(currentWeek, numWeeks, playoffTeams)}
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
