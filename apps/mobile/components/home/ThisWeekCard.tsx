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
import { THIS_WEEK_TAG, YOU_LABEL, vsOpponentLabel, leadLabel, thisWeekLiveChip, thisWeekAccessibilityLabel, SCORING_MESSAGE } from '@/lib/home/homeCopy';

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
  you: { gain: number; pct: number };
  opponent: { gain: number; pct: number };
  opponentName: string;
  /** "Ends Fri 4:00 PM ET" / "…at Thursday's close" / etc. */
  rightLabel: string;
  liveChipLabel?: string;
  /** The top-left tag — "This week" normally, or the playoff round name
   * during playoffs (spec: "the this-week card's tag becomes the round
   * name" — code review, 2026-09-29 found the round never reaching this
   * card at all). Defaults to THIS_WEEK_TAG. */
  tag?: string;
  /** State 3: neither side's gain is posted yet — skeleton scores, no
   * tug, no lead line, the "Results post…" message instead of a footer. */
  scoring?: boolean;
  /** State 4: both gains are posted (real numbers, from `you`/`opponent`
   * — the caller passes the authoritative scored values here, never a
   * live recompute). Adds the win/loss result line and swaps the footer
   * to "Week N+1 starts…" instead of the tug's lead line. */
  resultLine?: string;
}

export function ThisWeekCard({
  week, isLive, you, opponent, opponentName, rightLabel, liveChipLabel, tag, scoring = false, resultLine,
}: ThisWeekCardProps) {
  const { colors } = useTheme();
  const { reduced, duration, easing, withTiming } = useMotion();
  const leader = leaderOf(you.gain, opponent.gain);
  const ahead = leader === 'you' || leader === 'tie';
  const gap = Math.abs(you.gain - opponent.gain);

  const youText = formatMoney(you.gain, { sign: 'always' });
  const oppText = formatMoney(opponent.gain, { sign: 'always' });

  const a11yLabel = scoring
    ? `Week ${week}. Scoring — results post shortly.`
    : thisWeekAccessibilityLabel(week, isLive, youText, opponentName, oppText, gap.toString(), ahead, rightLabel);

  // H3: a leader change gets one accent wash (never a loop; no haptic —
  // this isn't user-initiated). Never on first paint — prevLeaderRef
  // starts at the CURRENT leader, so mount reads as "unchanged".
  const prevLeaderRef = useRef<Leader>(leader);
  const washOpacity = useSharedValue(0);
  useEffect(() => {
    if (prevLeaderRef.current !== leader && !scoring) {
      if (reduced) {
        washOpacity.value = 0; // a one-shot fade is exactly the motion Reduce Motion removes
      } else {
        washOpacity.value = 0.35;
        washOpacity.value = withTiming(0, { duration: duration.base * 3, easing: easing.exit });
      }
    }
    prevLeaderRef.current = leader;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-running per `leader` change is the point; duration/easing/withTiming are stable per render from useMotion().
  }, [leader, scoring, reduced]);
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
        <Text variant="callout" tone="secondary">
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
            <ScoreDigits text={youText} variant="score.lg" color={colors.youText} />
          </View>
          <View style={styles.scoreCell}>
            <ScoreDigits text={oppText} variant="score.lg" color={colors.oppText} />
          </View>
        </View>
      )}

      {!scoring ? <TugBar you={you.gain} opponent={opponent.gain} opponentName={opponentName} /> : null}

      {scoring ? (
        <Text variant="caption" tone="secondary">
          {SCORING_MESSAGE}
        </Text>
      ) : (
        <View style={styles.footerRow}>
          <Text variant="caption">
            {resultLine ?? (
              <>
                {leadLabel(ahead)} <Text variant="caption" style={styles.leadAmount}>{formatMoney(gap)}</Text>
              </>
            )}
          </Text>
          <Text variant="caption" tone="secondary">
            {rightLabel}
          </Text>
        </View>
      )}
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
    justifyContent: 'space-between',
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
    justifyContent: 'space-between',
  },
  leadAmount: {
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  wash: {
    ...StyleSheet.absoluteFillObject,
  },
});
