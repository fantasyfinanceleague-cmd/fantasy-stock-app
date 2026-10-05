/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { formatMoney } from '@/components/sp/logic/money';
import { leaderOf, type Leader } from '@/components/sp/logic/tug';
import { ScoreDigits } from '@/components/sp/game/ScoreDigits';
import { TugBar } from '@/components/sp/game/TugBar';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { Skeleton } from '@/components/Skeleton';
import { scoreTone } from '@/lib/home/scoreTone';
import { THIS_WEEK_TAG, YOU_LABEL, vsOpponentLabel, leadLabel, thisWeekLiveChip, thisWeekAccessibilityLabel, SCORING_MESSAGE, sideUnpricedCaption } from '@/lib/home/homeCopy';

// Stockpile — <ThisWeekCard> (Phase 3b-2, board "Home", key screen 1). A
// `<Card variant="scoreboard">` — every "game surface" now looks like this
// (§9A). Reuses <ScoreDigits>/<TugBar> (already game-only-motion-correct:
// `lively` on a lead change, reduced-motion-safe) rather than re-deriving
// either. Distinct from <Scoreboard> (components/sp/game/Scoreboard.tsx,
// used by the design gallery only so far): this card's header is the
// board's own "This week" tag + a live/final chip, not Scoreboard's
// "WEEK N · LEAGUE" band — the two components solve the same motion
// problem with different chrome, by design, for their own screens.
//
// H3: a quote refresh rolls both scores (ScoreDigits) and moves the tug
// (TugBar's own useLeadChangeSpring `lively`); a leader change crossfades
// the lead line (via a simple key-based remount + Card's own layout) and
// this component fades a one-shot accent wash on that same change.

export interface ThisWeekCardProps {
  week: number;
  isLive: boolean;
  you: { gain: number; pct: number; unpriced?: string[] };
  opponent: { gain: number; pct: number; unpriced?: string[] };
  opponentName: string;
  /** "Ends Fri 4:00 PM ET" / "Resumes Thu 9:30 AM ET" / etc. */
  rightLabel: string;
  /** "at Thursday's close" -- the tail of the lead line, set only while the
   * market is closed ("You lead by $X at Thursday's close"). */
  leadSuffix?: string;
  liveChipLabel?: string;
  /** The top-left tag — "This week" normally, or the playoff round name
   * during playoffs (spec: "the this-week card's tag becomes the round
   * name" — code review, 2026-09-29 found the round never reaching this
   * card at all). Defaults to THIS_WEEK_TAG. */
  tag?: string;
  /** State 3: neither side's gain is posted yet — skeleton scores, no
   * tug, no lead line, the "Results post…" message instead of a footer. */
  scoring?: boolean;
  /** State 5, pre-season (Design Lead ruling, 2026-09-30, B3): real
   * "$0.00" scores in zero grey — never a loading skeleton, since these
   * are KNOWN values (nothing has traded yet), not pending ones. Like
   * `scoring`, drops the tug bar and the lead-line footer for the single
   * `scoringMessage` caption instead — the board's HomePreSeason has no
   * tug and no "ends at" line either. */
  preSeason?: boolean;
  /** Overrides SCORING_MESSAGE when `scoring` or `preSeason` is set — the
   * playoff_pending/pre_season states each have their own reason to be in
   * this same visual shape, not a delayed Friday close. */
  scoringMessage?: string;
  /** State 4: both gains are posted (real numbers, from `you`/`opponent`
   * — the caller passes the authoritative scored values here, never a
   * live recompute). Adds the win/loss result line and swaps the footer
   * to "Week N+1 starts…" instead of the tug's lead line. */
  resultLine?: string;
}

export function ThisWeekCard({
  week, isLive, you, opponent, opponentName, rightLabel, leadSuffix, liveChipLabel, tag, scoring = false, preSeason = false, scoringMessage, resultLine,
}: ThisWeekCardProps) {
  const { colors } = useTheme();
  const { reduced, duration, easing, withTiming } = useMotion();
  const leader = leaderOf(you.gain, opponent.gain);
  const ahead = leader === 'you' || leader === 'tie';
  const gap = Math.abs(you.gain - opponent.gain);

  const youText = formatMoney(you.gain, { sign: 'always' });
  const oppText = formatMoney(opponent.gain, { sign: 'always' });

  // I12 (Design Lead ruling, 2026-09-29): one caption per side that has an
  // unpriced symbol, reusing plCoverage.ts's wording. Never shown during
  // `scoring`/`preSeason` -- there are no real numbers on screen yet (or,
  // for pre-season, nothing has traded at all) to qualify.
  const youCaption = !scoring && !preSeason ? sideUnpricedCaption(YOU_LABEL, you.unpriced ?? []) : null;
  const oppCaption = !scoring && !preSeason ? sideUnpricedCaption(opponentName, opponent.unpriced ?? []) : null;

  const captionA11y = [youCaption, oppCaption].filter(Boolean).join('. ');
  const a11yLabel = scoring || preSeason
    ? `Week ${week}. ${scoringMessage ?? SCORING_MESSAGE}`
    : `${thisWeekAccessibilityLabel(week, isLive, youText, opponentName, oppText, `${gap.toString()}${leadSuffix ? ` ${leadSuffix}` : ''}`, ahead, rightLabel)}${captionA11y ? `. ${captionA11y}` : ''}`;

  // H3: a leader change gets one accent wash (never a loop; no haptic —
  // this isn't user-initiated). Never on first paint — prevLeaderRef
  // starts at the CURRENT leader, so mount reads as "unchanged".
  const prevLeaderRef = useRef<Leader>(leader);
  const washOpacity = useSharedValue(0);
  useEffect(() => {
    if (prevLeaderRef.current !== leader && !scoring && !preSeason) {
      if (reduced) {
        washOpacity.value = 0; // a one-shot fade is exactly the motion Reduce Motion removes
      } else {
        washOpacity.value = 0.35;
        washOpacity.value = withTiming(0, { duration: duration.base * 3, easing: easing.exit });
      }
    }
    prevLeaderRef.current = leader;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-running per `leader` change is the point; duration/easing/withTiming are stable per render from useMotion().
  }, [leader, scoring, preSeason, reduced]);
  const washStyle = useAnimatedStyle(() => ({ opacity: washOpacity.value }));

  return (
    <Card variant="scoreboard" style={styles.card} accessible accessibilityLabel={a11yLabel}>
      <Animated.View style={[styles.wash, { backgroundColor: colors.accentWash }, washStyle]} pointerEvents="none" />
      <View style={styles.header}>
        <Text variant="tag" style={{ color: colors.liveText }}>
          {tag ?? THIS_WEEK_TAG}
        </Text>
        <View style={[styles.chip, { backgroundColor: colors.inset }]}>
          {isLive ? <LiveDot size={7} /> : null}
          <Text variant="tag" style={{ color: isLive ? colors.liveText : colors.text2 }}>
            {liveChipLabel ?? thisWeekLiveChip(week)}
          </Text>
        </View>
      </View>

      <View style={styles.namesRow}>
        <Text variant="callout" style={{ color: colors.youText, fontWeight: '700' }}>
          {YOU_LABEL}
        </Text>
        {/* XXXL (XL check, 2026-10-05): a long opponent name used to run into
            "You". The minimum gap and wrap keep them apart; at default size
            the two labels stay at opposite edges, as before. */}
        <Text variant="callout" tone="secondary" style={styles.oppName}>
          {vsOpponentLabel(opponentName)}
        </Text>
      </View>

      {scoring ? (
        <View style={styles.scoresRow}>
          <View style={styles.scoreCell}>
            <Skeleton width="70%" height={38} />
          </View>
          <View style={styles.scoreCell}>
            <Skeleton width="70%" height={38} />
          </View>
        </View>
      ) : (
        <View style={styles.scoresRow}>
          <View style={styles.scoreCell}>
            <ScoreDigits text={youText} variant="score.lg" color={preSeason || scoreTone(you.gain, 'you') === 'zero' ? colors.zero : colors.youText} />
          </View>
          <View style={styles.scoreCell}>
            <ScoreDigits text={oppText} variant="score.lg" color={preSeason || scoreTone(opponent.gain, 'opp') === 'zero' ? colors.zero : colors.oppText} />
          </View>
        </View>
      )}

      {!scoring && !preSeason ? <TugBar you={you.gain} opponent={opponent.gain} opponentName={opponentName} /> : null}

      {scoring || preSeason ? (
        <Text variant="caption" tone="secondary">
          {scoringMessage ?? SCORING_MESSAGE}
        </Text>
      ) : (
        <View style={styles.footerRow}>
          <Text variant="caption" style={styles.footerLeft}>
            {resultLine ?? (
              <>
                {leadLabel(ahead)} <Text variant="caption" style={styles.leadAmount}>{formatMoney(gap)}</Text>
                {leadSuffix ? ` ${leadSuffix}` : null}
              </>
            )}
          </Text>
          <Text variant="caption" tone="secondary" style={styles.footerRight}>
            {rightLabel}
          </Text>
        </View>
      )}

      {youCaption ? (
        <Text variant="caption" tone="secondary">
          {youCaption}
        </Text>
      ) : null}
      {oppCaption ? (
        <Text variant="caption" tone="secondary">
          {oppCaption}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space[5],
    gap: space[3],
    borderRadius: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: 999,
  },
  namesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: space[2],
  },
  oppName: {
    flexShrink: 1,
    textAlign: 'right',
  },
  scoresRow: {
    flexDirection: 'row',
    gap: space[5],
  },
  scoreCell: {
    flex: 1,
  },
  footerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: space[1],
  },
  footerLeft: {
    flexShrink: 1,
  },
  footerRight: {
    flexShrink: 1,
    textAlign: 'right',
  },
  leadAmount: {
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  wash: {
    ...StyleSheet.absoluteFillObject,
  },
});
