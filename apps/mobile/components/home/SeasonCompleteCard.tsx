/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { Money } from '@/components/sp/Money';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
// `lively` (spring.lively) is scoped to game components by convention
// (§9: "importable only from game components"), but the spec explicitly
// calls for it here — "Season complete: the trophy springs in once
// (spring.lively)" — a one-shot celebration beat, the same family of
// motion as a lead-change overshoot, not a money-surface digit roll.
import { lively } from '@/components/sp/game/motion';
import { useSeasonResult } from '@/lib/home/useSeasonResult';
import {
  playoffTileLine, PLAYOFFS_TILE_TITLE, BEST_WEEK_TILE_TITLE,
  SEASON_COMPLETE_TITLE, CHAMPION_LABEL, wonLeagueLine, placeLabel, nonChampionLine, championAnnounceLine, coreCompleteTiles,
  playoffRecordLine, bestWeekLine, SEE_FINAL_STANDINGS, START_NEXT_SEASON,
} from '@/lib/home/homeCopy';
import { playoffRoundLabelForWeek } from '@/lib/playoffs';

// Stockpile — <SeasonCompleteCard> (Phase 3b-2, state 8). Rebuilt to match
// the board's HomeComplete exactly (Design Lead ruling, 2026-09-30, B6),
// on real get_season_result data (#77 merged) via useSeasonResult. Ships
// its HONEST MINIMUM (rank, record, season gain -- from get_home_summary,
// already available) only for a season whose get_season_result call
// errors or returns a non-'complete' status (a league whose current
// season predates #77, or genuinely inconsistent data) -- never a
// half-filled tile mixing the two sources.

export interface SeasonCompleteCardProps {
  leagueId: string;
  leagueName: string;
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

export function SeasonCompleteCard({
  leagueId, leagueName, seasonNumber, finalRank, standingsCount, wins, losses, ties, seasonGain, playoffTeams, numWeeks,
}: SeasonCompleteCardProps) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  const result = useSeasonResult(leagueId);
  const trophyScale = useSharedValue(0);

  // H6: the trophy springs in ONCE PER SEASON (a device-local flag,
  // keyed by league+season) — never on every Home open. Reduce Motion:
  // it just appears (final value, no spring, no glow).
  // The RPC's own season_number is the real key once it's loaded — using
  // only the prop-level `seasonNumber` (currently always null from the
  // caller) would collapse every completed season into the same "current"
  // AsyncStorage key, so the trophy would stop replaying after the FIRST
  // season this league ever completes, breaking H6's "once per season".
  const effectiveSeasonNumber = result?.season_number ?? seasonNumber;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const key = `home.trophy.${leagueId}.${effectiveSeasonNumber ?? 'current'}`;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs once when the RPC's real season_number arrives (see effectiveSeasonNumber's doc); the AsyncStorage check itself is what keeps a slow-network double-run from double-writing.
  }, [leagueId, effectiveSeasonNumber, reduced]);

  const record = `${wins}–${losses}${ties ? `–${ties}` : ''}`;

  const playoffResultLine = result
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
  // Orchestrator ruling (2026-09-30), B6 edge case: a league member who
  // did not play this particular season (joined after it started, say)
  // still sees who won -- the podium/champion always renders -- but never
  // "You won" or any of the CALLER tiles (final_rank/wins/points_for/best
  // week are all meaningless for someone who wasn't in the standings).
  // Defaults to true when `result` hasn't loaded yet (or the honest-
  // minimum fallback is in play): both of those paths already assume the
  // caller participated, by construction.
  const participated = result ? result.caller_participated : true;
  const core = coreCompleteTiles(seasonGain, finalRank, standingsCount, record);

  return (
    <>
      <Card style={styles.medallionCard}>
        {/* S8 (Design Lead, 2026-09-30): gold is a CHAMPION signal --
            a non-champion (2nd/3rd place) gets a neutral medallion, no
            live-gold wash or circle, so the color itself never implies
            a win that didn't happen. */}
        {isChampion ? <LinearGradient colors={[colors.liveGlow, 'transparent']} style={styles.wash} pointerEvents="none" /> : null}
        <Animated.View style={[styles.trophyCircle, { backgroundColor: isChampion ? colors.live : colors.text2 }, trophyStyle]}>
          <Ionicons name="trophy" size={36} color={colors.surface} />
        </Animated.View>
        <Text variant="tag" style={{ color: colors.liveText }}>
          {SEASON_COMPLETE_TITLE}
        </Text>
        {participated ? (
          <>
            <Text variant="score.md" style={styles.headline}>
              {isChampion ? CHAMPION_LABEL : placeLabel(finalRank)}
            </Text>
            <Text variant="callout">{isChampion ? wonLeagueLine(leagueName) : nonChampionLine(leagueName, record)}</Text>
          </>
        ) : (
          <>
            <Text variant="score.md" style={styles.headline}>
              {result?.champion_display_name ?? CHAMPION_LABEL}
            </Text>
            <Text variant="callout">{championAnnounceLine(leagueName)}</Text>
          </>
        )}
      </Card>

      {participated ? (
        <Card style={styles.tilesCard}>
          <View style={styles.tilesGrid}>
            <View style={styles.tile}>
              <Text variant="caption" tone="secondary">{core.seasonGainTitle}</Text>
              <Money value={core.seasonGain} size="headline" colorBySign sign="always" />
            </View>
            {result?.best_week_number != null && result.best_week_gain != null ? (
              <View style={styles.tile}>
                <Text variant="caption" tone="secondary">{BEST_WEEK_TILE_TITLE}</Text>
                <View style={styles.inlineRow}>
                  <Text variant="headline">{bestWeekLine(result.best_week_number)} · </Text>
                  <Money value={result.best_week_gain} size="headline" colorBySign sign="always" />
                </View>
              </View>
            ) : null}
            <View style={styles.tile}>
              <Text variant="caption" tone="secondary">{core.regularSeasonTitle}</Text>
              <Text variant="headline">{core.regularSeasonLine}</Text>
            </View>
            {/* detail_scope='standings_only' (a past season) never gets exit-round
             * indexing; playoffResultLine is null for that case unless the podium
             * itself (champion/runner_up) already answers it. */}
            {playoffResultLine ? (
              <View style={styles.tile}>
                <Text variant="caption" tone="secondary">{PLAYOFFS_TILE_TITLE}</Text>
                <Text variant="headline">{playoffRecordLine(result?.playoff_wins ?? null, result?.playoff_losses ?? null, playoffResultLine)}</Text>
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

      <Button label={SEE_FINAL_STANDINGS} onPress={() => router.push('/(tabs)/league')} variant="primary" />
      {/* B6 (Design Lead, 2026-09-30): "Start next season" is deliberately
       * NOT wired to start_new_league_season here -- that RPC is a
       * destructive, commissioner-gated action (CLAUDE.md: it deletes the
       * league's matchups/standings), and this card has no confirmation UX
       * or commissioner check. Routes to the league screen, where that real
       * flow belongs, rather than inventing a one-tap destructive action. */}
      <Button label={START_NEXT_SEASON} onPress={() => router.push('/(tabs)/league')} variant="secondary" />
    </>
  );
}

const styles = StyleSheet.create({
  medallionCard: {
    padding: space[6],
    gap: space[2],
    borderRadius: 14,
    alignItems: 'center',
    overflow: 'hidden',
  },
  wash: {
    ...StyleSheet.absoluteFillObject,
  },
  trophyCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    textAlign: 'center',
  },
  tilesCard: {
    padding: space[6],
    gap: space[4],
    borderRadius: 14,
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
  inlineRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
});
