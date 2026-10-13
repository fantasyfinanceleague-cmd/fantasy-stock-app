/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { radius, space } from '@/constants/tokens';
import { Avatar, AVATAR_RING, AVATAR_RING_GAP } from '@/components/sp/Avatar';
import { Card } from '@/components/sp/Card';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { formatMoney } from '@/components/sp/logic/money';
import { leaderOf, type Leader } from '@/components/sp/logic/tug';
import { chipLook } from '@/components/sp/logic/gameNight';
import { ScoreDigits } from '@/components/sp/game/ScoreDigits';
import { TugBar } from '@/components/sp/game/TugBar';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { Skeleton } from '@/components/Skeleton';
import { scoreTone } from '@/lib/home/scoreTone';
import { THIS_WEEK_TAG, YOU_LABEL, vsOpponentLabel, leadLabel, LIVE_CHIP, thisWeekAccessibilityLabel, SCORING_MESSAGE, sideUnpricedCaption } from '@/lib/home/homeCopy';
import { THIS_WEEK_HREF, OPENS_MATCHUP_HINT } from '@/lib/home/calmHome';

// Stockpile — <ThisWeekCard> (Phase 3b-2, board "Home", key screen 1). Reuses
// <ScoreDigits>/<TugBar> (already game-only-motion-correct: `lively` on a lead change,
// reduced-motion-safe) rather than re-deriving either. Distinct from Matchup's Game Night
// <Scoreboard> (components/sp/gn): this card's header is the board's own "This week" tag
// + a live/final chip, and it opens Matchup; the two share the your-half shading.
//
// H3: a quote refresh rolls both scores (ScoreDigits) and moves the tug
// (TugBar's own useLeadChangeSpring `lively`); a leader change crossfades
// the lead line (via a simple key-based remount + Card's own layout) and
// this component fades a one-shot accent wash on that same change.
//
// A calm Home (2026-10-12): the chip reads "Live"; a chevron follows it and the whole card
// opens Matchup, in every state it shows.
//
// Game Night (§9C, W4; the board's ThisWeek): the rimmed card; the scores at 28pt
// (`score.lg`, ExtraBold), so team value (`hero`, 46) stays the ONE standout number; the
// avatars (yours ringed in `you`, theirs the slate `opp`) beside "You" and "vs {name}";
// the 6pt tug; YOUR half shaded `youTint` (shading B), never the leader's.

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
  /** Your display name, for your avatar's initials (the card itself says "You"). */
  youName?: string;
}

export function ThisWeekCard({
  week, isLive, you, opponent, opponentName, rightLabel, leadSuffix, liveChipLabel, tag, scoring = false, preSeason = false, scoringMessage, resultLine, youName = YOU_LABEL,
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

  // The chip (the board's .dr-chip): Live is the accent chip with its breathing dot; every
  // other state (closed, scoring, scored, pre-season) the `inset` chip in `text`. A tag:
  // uppercase in JS (Text), never a text-transform style.
  const chip = chipLook(isLive ? 'live' : 'default', colors);
  const scoreColor = (gain: number, side: 'you' | 'opp') => (preSeason || scoreTone(gain, side) === 'zero' ? colors.zero : colors.text);

  return (
    <PressableScale
      onPress={() => router.push(THIS_WEEK_HREF)}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={OPENS_MATCHUP_HINT}
    >
    <Card style={styles.card}>
      <Animated.View style={[styles.wash, { backgroundColor: colors.accentWash }, washStyle]} pointerEvents="none" />
      <View style={[styles.header, styles.padded]}>
        <Text variant="tag" style={{ color: colors.liveText }}>
          {tag ?? THIS_WEEK_TAG}
        </Text>
        <View style={styles.headerRight}>
          <View style={[styles.chip, { backgroundColor: chip.fill }]}>
            {isLive ? <LiveDot size={7} /> : null}
            <Text variant="tag" style={{ color: chip.ink }}>
              {liveChipLabel ?? LIVE_CHIP}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.text2} />
        </View>
      </View>

      {/* Shading B (Giorgio, 2026-10-12: "when it's you versus someone, it shades it so that
          it's clear. Not whoever's winning"): YOUR half sits on `youTint`, win or lose, the
          same grammar as Matchup's scoreboard; who leads is said by the totals and the lead
          line. The opponent is the right half, marked by position, not colour. */}
      <View style={styles.halves}>
        <View testID="this-week-you" style={[styles.half, styles.halfYou, { backgroundColor: colors.youTint }]}>
          <View style={styles.who}>
            <Avatar name={youName} size={AVATAR} tone="you" ring />
            <Text variant="callout" numberOfLines={1} style={styles.youName}>
              {YOU_LABEL}
            </Text>
          </View>
          <View style={styles.scoreCell}>
            {scoring ? <Skeleton width="70%" height={28} /> : <ScoreDigits text={youText} variant="score.lg" color={scoreColor(you.gain, 'you')} />}
          </View>
        </View>
        <View style={[styles.half, styles.halfOpp]}>
          {/* XXXL (XL check, 2026-10-05): a long opponent name wraps rather than running into
              your half; the avatar keeps the ringed avatar's footprint so the scores align. */}
          <View style={[styles.who, styles.whoMirror]}>
            <View style={styles.ringFootprint}>
              <Avatar name={opponentName} size={AVATAR} tone="opp" />
            </View>
            <Text variant="callout" tone="secondary" numberOfLines={2} style={styles.oppName}>
              {vsOpponentLabel(opponentName)}
            </Text>
          </View>
          <View style={[styles.scoreCell, styles.scoreCellRight]}>
            {scoring ? <Skeleton width="70%" height={28} /> : <ScoreDigits text={oppText} variant="score.lg" color={scoreColor(opponent.gain, 'opp')} />}
          </View>
        </View>
      </View>

      <View style={[styles.body, styles.padded]}>
        {!scoring && !preSeason ? <TugBar you={you.gain} opponent={opponent.gain} opponentName={opponentName} height={TUG_HEIGHT} /> : null}

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
      </View>
    </Card>
    </PressableScale>
  );
}

// The board's ThisWeek: 24pt avatars, a 6pt tug.
const AVATAR = 24;
const TUG_HEIGHT = 6;

const styles = StyleSheet.create({
  // §9C Card: `surface` + the 1pt rim, radius 14. The halves run edge to edge, so the
  // padding is per row (`padded`), 16 as on the board.
  card: {
    paddingVertical: space[5],
    gap: space[4],
    borderRadius: radius.lg,
  },
  padded: {
    paddingHorizontal: space[5],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 24,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.pill,
  },
  halves: {
    flexDirection: 'row',
  },
  // `minWidth: 0` is load-bearing (2026-10-07, the X-1 follow-up): without it, a flex
  // item's minimum width defaults to its CONTENT's intrinsic size, not 0 -- so at a wide
  // enough value (seen: both sides' gains overlapping at $1M+), `flex: 1` never actually
  // constrained either half, and ScoreDigits' own `adjustsFontSizeToFit` safety net never
  // got a real width to shrink against. With this, the 50/50 split is real and the two
  // sides can never overlap.
  // The halves stretch to the taller one, and each score sits at its half's bottom, so the
  // two scores share one baseline even when a long opponent name wraps (W4 gate, stress).
  half: {
    flex: 1,
    minWidth: 0,
    gap: space[3],
    paddingVertical: space[4],
    justifyContent: 'space-between',
  },
  // Your half's tint runs to the card's left edge (the card clips it to its radius).
  halfYou: {
    alignItems: 'flex-start',
    paddingLeft: space[5],
    paddingRight: space[4],
  },
  halfOpp: {
    alignItems: 'flex-end',
    paddingLeft: space[4],
    paddingRight: space[5],
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    maxWidth: '100%',
  },
  whoMirror: {
    flexDirection: 'row-reverse',
  },
  ringFootprint: {
    padding: AVATAR_RING + AVATAR_RING_GAP,
  },
  youName: {
    fontWeight: '700',
    flexShrink: 1,
  },
  oppName: {
    flexShrink: 1,
    textAlign: 'right',
  },
  scoreCell: {
    alignSelf: 'stretch',
    minWidth: 0,
  },
  // The opponent's score hugs its own (right) edge, mirroring yours on the left.
  scoreCellRight: {
    alignItems: 'flex-end',
  },
  body: {
    gap: space[3],
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
