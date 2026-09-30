/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Money } from '@/components/sp/Money';
import { useMotion } from '@/components/sp/motion';
// `lively` (spring.lively) is scoped to game components by convention
// (§9: "importable only from game components"), but the spec explicitly
// calls for it here — "Season complete: the trophy springs in once
// (spring.lively)" — a one-shot celebration beat, the same family of
// motion as a lead-change overshoot, not a money-surface digit roll.
import { lively } from '@/components/sp/game/motion';
import { supabase } from '@/lib/supabase';
import { playoffTileLine, REGULAR_SEASON_TILE_TITLE, PLAYOFFS_TILE_TITLE, BEST_WEEK_TILE_TITLE, SEASON_GAIN_TILE_TITLE } from '@/lib/home/homeCopy';
import { playoffRoundLabelForWeek } from '@/lib/playoffs';

// Stockpile — <SeasonCompleteCard> (Phase 3b-2, state 8). Backed by
// get_season_result (Phase 3 ask #11, PR #77 / origin/feat/season-result-
// summary @ dceeb40 — NOT merged to main as of this branch). Ships in its
// HONEST MINIMUM until that RPC lands, per the Orchestrator's ruling
// (2026-09-29): rank, record and season gain, which get_home_summary
// already has; no fabricated champion claim, no "Final value", no "Best
// pick" (both dropped from the board — neither is honestly derivable
// under weekly-snapshot scoring).
//
// Once get_season_result IS live, this component upgrades itself: it
// tries the RPC first, and only falls back to the minimum on any error
// or an absent/unsupported/inconsistent status — never partial-fills a
// tile from a mix of the two sources.

export interface SeasonCompleteCardProps {
  leagueId: string;
  seasonNumber: number | null;
  finalRank: number;
  standingsCount: number;
  wins: number;
  losses: number;
  ties: number;
  seasonGain: number;
  playoffTeams: number | null;
  numWeeks: number | null;
}

interface SeasonResultRow {
  status: string;
  reason: string | null;
  detail_scope: string | null;
  playoff_result: 'champion' | 'runner_up' | 'eliminated' | 'missed' | null;
  playoff_exit_round: number | null;
  best_week_number: number | null;
  best_week_gain: number | null;
}

export function SeasonCompleteCard({
  leagueId, seasonNumber, finalRank, standingsCount, wins, losses, ties, seasonGain, playoffTeams, numWeeks,
}: SeasonCompleteCardProps) {
  const [result, setResult] = useState<SeasonResultRow | null>(null);
  const { reduced } = useMotion();
  const trophyScale = useSharedValue(0);

  // H6: the trophy springs in ONCE PER SEASON (a device-local flag,
  // keyed by league+season) — never on every Home open. Reduce Motion:
  // it just appears (final value, no spring, no glow).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const key = `home.trophy.${leagueId}.${seasonNumber ?? 'current'}`;
      let already = false;
      try {
        already = (await AsyncStorage.getItem(key)) === '1';
      } catch {
        // Storage failure: play it once, harmlessly, rather than never.
      }
      if (cancelled) return;
      if (already || reduced) {
        trophyScale.value = 1;
        return;
      }
      trophyScale.value = withSpring(1, lively);
      try {
        await AsyncStorage.setItem(key, '1');
      } catch {
        // A failed write just means it may play again next time — safe.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only per league/season.
  }, [leagueId, seasonNumber]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_season_result', { p_league_id: leagueId });
      if (cancelled) return;
      // Honest degrade: an unmerged RPC (function does not exist), any
      // other error, or a non-'complete' status all fall through to the
      // minimum below — never a half-filled tile.
      if (error || !data) return;
      const row = (Array.isArray(data) ? data[0] : data) as SeasonResultRow | undefined;
      if (row && row.status === 'complete') setResult(row);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const record = `${wins}–${losses}${ties ? `–${ties}` : ''}`;

  const playoffLine = result
    ? playoffTileLine(
        result.playoff_result,
        result.playoff_result === 'eliminated' && result.playoff_exit_round
          ? playoffRoundLabelForWeek((numWeeks ?? 0) + result.playoff_exit_round, numWeeks, playoffTeams)
          : null,
      )
    : null;

  const trophyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: trophyScale.value }],
    opacity: trophyScale.value,
  }));
  const isChampion = result?.playoff_result === 'champion';

  return (
    <Card style={styles.card}>
      <View style={styles.titleRow}>
        <Text variant="title">Season complete</Text>
        {isChampion ? (
          <Animated.View style={trophyStyle}>
            <Text variant="title">{'\u{1F3C6}'}</Text>
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.tilesGrid}>
        <View style={styles.tile}>
          <Text variant="caption" tone="secondary">{SEASON_GAIN_TILE_TITLE}</Text>
          <Money value={seasonGain} size="headline" colorBySign sign="always" />
        </View>
        <View style={styles.tile}>
          <Text variant="caption" tone="secondary">{REGULAR_SEASON_TILE_TITLE}</Text>
          <Text variant="headline">
            {finalRank}
            <Text variant="callout" tone="secondary"> of {standingsCount}</Text>
          </Text>
          <Text variant="callout" tone="secondary">{record}</Text>
        </View>
        {/* detail_scope='standings_only' (a past season) never gets exit-round
         * indexing; playoffLine is null for that case unless the podium
         * itself (champion/runner_up) already answers it. */}
        {playoffLine ? (
          <View style={styles.tile}>
            <Text variant="caption" tone="secondary">{PLAYOFFS_TILE_TITLE}</Text>
            <Text variant="headline">{playoffLine}</Text>
          </View>
        ) : null}
        {result?.best_week_number != null && result.best_week_gain != null ? (
          <View style={styles.tile}>
            <Text variant="caption" tone="secondary">{BEST_WEEK_TILE_TITLE}</Text>
            <Text variant="headline">Week {result.best_week_number}</Text>
            <Money value={result.best_week_gain} size="callout" colorBySign sign="always" />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space[6],
    gap: space[4],
    borderRadius: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  tilesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[5],
  },
  tile: {
    minWidth: 130,
    gap: space[1],
  },
});
