/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from '@/components/sp/Icon';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { radius, space } from '@/constants/tokens';
import { clearOf } from '@/constants/tokens/color';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { FULL_WIDTH_FONT_SCALE } from '@/components/sp/Button';
import { ListRow } from '@/components/sp/ListRow';
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
  playoffRecordLine, bestWeekLine, SEE_FINAL_STANDINGS,
} from '@/lib/home/homeCopy';
import { playoffRoundLabelForWeek } from '@/lib/playoffs';
import { useBracket } from '@/lib/game/useBracket';
import { seasonCompletePlace } from '@/lib/game/finalStandings';

// Stockpile — <SeasonCompleteCard> (Phase 3b-2, state 8). Rebuilt to match
// the board's HomeComplete exactly (Design Lead ruling, 2026-09-30, B6),
// on real get_season_result data (#77 merged) via useSeasonResult. Ships
// its HONEST MINIMUM (rank, record, season gain -- from get_home_summary,
// already available) only for a season whose get_season_result call
// errors or returns a non-'complete' status (a league whose current
// season predates #77, or genuinely inconsistent data) -- never a
// half-filled tile mixing the two sources.
//
// A calm Home (2026-10-12): ONE card. The medallion block (a 60pt disc), the tiles, then
// "See the final standings" as a row with a chevron. No filled button: Run it back
// (commissioner) or the ask (member) is the screen's only primary (lib/home/calmHome
// seasonOverPrimary).
//
// Game Night (§9C, W4): the rimmed card; the tiles on an `inset` panel (radius 14) instead
// of between hairlines (rule 2); the champion's disc and wash in `medalGold` with its own
// `onMedal` ink (rule 4); the headline at 28pt (`score.lg`).

export interface SeasonCompleteCardProps {
  leagueId: string;
  leagueName: string;
  seasonNumber: number | null;
  /** Your REGULAR-SEASON rank (the "Regular season" tile). The headline's place is the
   * final standings' (GS-4), worked out here from the playoff result. */
  finalRank: number;
  standingsCount: number;
  myUserId: string;
  /** The regular-season standings (the seeding), for the final standings' order. */
  standings: { user_id: string; rank: number; display_name: string }[];
  wins: number;
  losses: number;
  ties: number;
  seasonGain: number;
  playoffTeams: number | null;
  numWeeks: number | null;
}

export function SeasonCompleteCard({
  leagueId, leagueName, seasonNumber, finalRank, standingsCount, myUserId, standings, wins, losses, ties, seasonGain, playoffTeams, numWeeks,
}: SeasonCompleteCardProps) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  // At accessibility sizes the tiles stack, one per row: two across, each half was narrower than its own caption and
  // "Season gain" broke mid-word ("Seaso / n gain"; label-no-midword round, the Design Lead's rule).
  const { fontScale } = useWindowDimensions();
  const tileStyle = fontScale >= FULL_WIDTH_FONT_SCALE ? [styles.tile, styles.tileStacked] : styles.tile;
  const result = useSeasonResult(leagueId);
  // GS-4: the headline's place is the final standings' (League › Standings' order), so a
  // 1st seed who lost the Final reads "2nd place" here too, never "1st place".
  const bracket = useBracket(leagueId, playoffTeams, standings, true);
  const finalPlace = seasonCompletePlace({
    myUserId,
    regularRank: finalRank,
    standings,
    playoffTeams,
    playoffResult: result?.playoff_result ?? null,
    bracketStatus: bracket.status,
    playoffRows: bracket.rows,
  });
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
  const headline = isChampion ? CHAMPION_LABEL : finalPlace !== null ? placeLabel(finalPlace) : null;
  const core = coreCompleteTiles(seasonGain, finalRank, standingsCount, record);

  return (
    <Card style={styles.card}>
        {/* S8 (Design Lead, 2026-09-30): gold is a CHAMPION signal --
            a non-champion (2nd/3rd place) gets a neutral medallion, no
            live-gold wash or circle, so the color itself never implies
            a win that didn't happen. */}
        {/* The champion's gold wash fades out by the card's middle. */}
        {/* Game Night (W4): gold is `medalGold` now (§9C: "Medal disc, gold, season complete
            only") — W3 made `live` the cyan accent, so the old live-gold wash would have read
            as "live", not "champion". The wash is the gold at a low opacity, fading to the
            same gold at alpha 0 (never the transparent keyword, which is black at 0: a grey fade). */}
        {isChampion ? <LinearGradient colors={[colors.medalGold, clearOf(colors.medalGold)]} locations={[0, 0.5]} style={[styles.wash, styles.goldWash]} pointerEvents="none" /> : null}
        <View style={styles.medallionBlock}>
        {/* The medallion draws its own disc (§9B): a 30 pt glyph in a 60 pt disc, scaled with Dynamic Type. */}
        <Animated.View style={trophyStyle}>
          <Icon name="trophy" size="medallion" tone={isChampion ? 'onMedal' : 'surface'} discTone={isChampion ? 'medalGold' : 'text2'} discPt={60} />
        </Animated.View>
        <Text variant="tag" style={{ color: colors.liveText }}>
          {SEASON_COMPLETE_TITLE}
        </Text>
        {participated ? (
          <>
            {/* S3 (Design Lead gate, 2026-10-05): score.md caps at 1.2x while the
                subtitle below grows freely, so at XXXL the title rendered smaller
                than its own subtitle. The title's cap now matches the subtitle's reach. */}
            {/* GS-4: a place is shown only once the playoff result proves it (never the regular-season rank). */}
            {headline !== null ? (
              <Text variant="score.lg" maxFontSizeMultiplier={2.4} style={styles.headline}>
                {headline}
              </Text>
            ) : null}
            <Text variant="callout">{isChampion ? wonLeagueLine(leagueName) : nonChampionLine(leagueName, record)}</Text>
          </>
        ) : (
          <>
            <Text variant="score.lg" maxFontSizeMultiplier={2.4} style={styles.headline}>
              {result?.champion_display_name ?? CHAMPION_LABEL}
            </Text>
            <Text variant="callout">{championAnnounceLine(leagueName)}</Text>
          </>
        )}
        </View>

      {participated ? (
        <>
          {/* §9C rule 2: separation by surface, never by rules — the tiles sit on an `inset`
              panel (the key-figures strip's look), not between hairlines. */}
          <View style={[styles.tilesGrid, { backgroundColor: colors.inset }]}>
            <View style={tileStyle}>
              <Text variant="caption" tone="secondary">{core.seasonGainTitle}</Text>
              <Money value={core.seasonGain} size="headline" colorBySign sign="always" />
            </View>
            {result?.best_week_number != null && result.best_week_gain != null ? (
              <View style={tileStyle}>
                <Text variant="caption" tone="secondary">{BEST_WEEK_TILE_TITLE}</Text>
                <View style={styles.inlineRow}>
                  <Text variant="headline">{bestWeekLine(result.best_week_number)} · </Text>
                  <Money value={result.best_week_gain} size="headline" colorBySign sign="always" />
                </View>
              </View>
            ) : null}
            <View style={tileStyle}>
              <Text variant="caption" tone="secondary">{core.regularSeasonTitle}</Text>
              <Text variant="headline">{core.regularSeasonLine}</Text>
            </View>
            {/* detail_scope='standings_only' (a past season) never gets exit-round
             * indexing; playoffResultLine is null for that case unless the podium
             * itself (champion/runner_up) already answers it. */}
            {playoffResultLine ? (
              <View style={tileStyle}>
                <Text variant="caption" tone="secondary">{PLAYOFFS_TILE_TITLE}</Text>
                <Text variant="headline">{playoffRecordLine(result?.playoff_wins ?? null, result?.playoff_losses ?? null, playoffResultLine)}</Text>
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      <ListRow title={SEE_FINAL_STANDINGS} onPress={() => router.push('/(tabs)/league')} />
      {/* B4 (Design Lead gate, 2026-10-05): no "Start next season" here. The
       * start_new_league_season path is revoked, so a button for it is dead;
       * the "Run it back?" card (3c) owns the primary. */}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingTop: space[6],
    paddingHorizontal: space[6],
    paddingBottom: space[2],
    gap: space[5],
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  medallionBlock: {
    gap: space[2],
    alignItems: 'center',
  },
  wash: {
    ...StyleSheet.absoluteFillObject,
  },
  goldWash: {
    opacity: 0.22,
  },
  headline: {
    textAlign: 'center',
  },
  tilesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[5],
    padding: space[4],
    borderRadius: radius.lg,
  },
  // Two across (a 2 × 2 grid of the four tiles) inside the inset panel; a tile too wide
  // for its half (large text) takes the whole row.
  tile: {
    flexBasis: '40%',
    flexGrow: 1,
    minWidth: 130,
    gap: space[1],
  },
  // One per row from the accessibility scale (a tile's caption is wider than half the panel there).
  tileStacked: {
    flexBasis: '100%',
  },
  inlineRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
});
