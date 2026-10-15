/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { space } from '@/constants/tokens';
import { PhaseChip } from '@/components/sp/PhaseChip';
import { Text } from '@/components/sp/Text';
import { useMotion } from '@/components/sp/motion';
import { DraftTile, Scoreboard } from '@/components/sp/gn';
import { formatMoney } from '@/components/sp/logic/money';
import { lineUnderTotalsCap } from '@/components/sp/logic/gameNight';
import { FINAL, ROSTER_PICKS, VERSUS, versusSides } from '@/components/shell/onboarding/sampleData';

// Phase 3b-1 — S1's live vignettes: each onboarding card shows the product
// working, on the board's three cards (Design Lead ruling D2):
//   1. the roster filling round by round;
//   2. versus: a lead change on the scoreboard;
//   3. the FINAL chip landing and "You win Week 6" rising.
// Each plays ONCE when its card becomes the focused card (`active`) and
// resets when it leaves, so it plays again on return — never a loop (§4).
// The data never moves with the parallax; only decorative layers do
// (OnboardingPager). Reduce Motion: each shows its final frame, still.
//
// Game Night (W4 Onboarding): the vignettes are built from the screens they preview, so the
// first thing a new player sees is the app they'll get. The roster is the draft board's
// DraftTile (`surface`, the 3pt category line at the bottom, never a fill); versus and the final
// are Matchup's Scoreboard (your half shaded, the totals in `text`, the one line under the card).
// The Game Day pieces they used before (tug bar, chyron, slammed digits, VS) are gone: Matchup
// itself no longer has them ("no win %, bars … chart", Giorgio's Matchup ruling).

export interface VignetteProps {
  active: boolean;
  /** The final frame, no motion: "How it works" in Profile shows each scene as a thumbnail (W4). */
  still?: boolean;
}

// ── 1. Roster filling ────────────────────────────────────────────────────

export function RosterVignette({ active, still }: VignetteProps) {
  return (
    <View style={styles.grid} accessible accessibilityLabel={`A roster filling round by round: ${ROSTER_PICKS.map((p) => p.ticker).join(', ')}`}>
      {ROSTER_PICKS.map((p, i) => (
        <RosterCell key={p.ticker} index={i} ticker={p.ticker} category={p.category} active={active} still={!!still} />
      ))}
    </View>
  );
}

function RosterCell({ index, ticker, category, active, still }: { index: number; ticker: string; category: (typeof ROSTER_PICKS)[number]['category']; active: boolean; still: boolean }) {
  const { reduced: reducedMotion, duration, easing } = useMotion();
  const reduced = reducedMotion || still;
  const fill = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      fill.value = 1;
      return;
    }
    // One round per `base`, like picks landing in a live draft.
    fill.value = active ? withDelay((index + 1) * duration.base, withTiming(1, { duration: duration.base, easing: easing.settle })) : 0;
  }, [active, reduced, index, duration.base, easing.settle, fill]);

  const filledStyle = useAnimatedStyle(() => ({ opacity: fill.value, transform: [{ scale: 0.92 + 0.08 * fill.value }] }));

  return (
    <View style={styles.cell} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {/* The empty cell (`sunken`, its pick number) until the pick lands over it. */}
      <DraftTile pick={index + 1} state="empty" height={TILE_HEIGHT} />
      <Animated.View style={[styles.filled, filledStyle]}>
        <DraftTile pick={index + 1} state="picked" ticker={ticker} category={category} height={TILE_HEIGHT} />
      </Animated.View>
    </View>
  );
}

// ── 2. Versus, with a lead change ───────────────────────────────────────

export function VersusVignette({ active, still }: VignetteProps) {
  const { reduced: reducedMotion, duration } = useMotion();
  const reduced = reducedMotion || !!still;
  const [flipped, setFlipped] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setFlipped(true);
      return;
    }
    if (!active) {
      setFlipped(false);
      return;
    }
    const t = setTimeout(() => setFlipped(true), duration.slow + duration.base);
    return () => clearTimeout(t);
  }, [active, reduced, duration.slow, duration.base]);

  const { you, opponent } = versusSides(flipped ? 'after' : 'before');
  return (
    <View style={styles.fill}>
      <Scoreboard you={you} opponent={opponent} />
    </View>
  );
}

// ── 3. The Friday final ──────────────────────────────────────────────────

export function FinalVignette({ active, still }: VignetteProps) {
  const { reduced: reducedMotion, duration, easing, spring, withSpring } = useMotion();
  const reduced = reducedMotion || !!still;
  const chip = useSharedValue(reduced ? 1 : 0);
  const winner = useSharedValue(reduced ? 1 : 0);
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  // The winner line never outranks the totals above it: capped from their FITTED size (the
  // Scoreboard's score.xl, 32pt ≤ 1.2×, shrunk into each half's inner width: half − 2 × 20pt).
  const winnerCap = lineUnderTotalsCap({
    totals: [formatMoney(FINAL.you, { sign: 'always' }), formatMoney(FINAL.opp, { sign: 'always' })],
    totalPt: TOTAL_PT * Math.min(fontScale, TOTAL_MAX_SCALE),
    innerWidth: width / 2 - 2 * HALF_PAD,
    linePt: WINNER_PT,
  });

  useEffect(() => {
    if (reduced) {
      chip.value = 1;
      winner.value = 1;
      return;
    }
    if (!active) {
      chip.value = 0;
      winner.value = 0;
      return;
    }
    chip.value = withDelay(duration.base, withSpring(1, spring.snappy));
    winner.value = withDelay(duration.base + duration.slow, withTiming(1, { duration: duration.slow, easing: easing.settle }));
  }, [active, reduced, duration.base, duration.slow, easing.settle, spring.snappy, withSpring, chip, winner]);

  // The chip "lands": from slightly large and transparent onto its spot.
  const chipStyle = useAnimatedStyle(() => ({ opacity: chip.value, transform: [{ scale: 1.35 - 0.35 * chip.value }] }));
  // The winner line rises into place, where the scoreboard's own line would sit.
  const winnerStyle = useAnimatedStyle(() => ({ opacity: winner.value, transform: [{ translateY: 12 * (1 - winner.value) }] }));

  return (
    <View style={[styles.fill, styles.final]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.centerSelf, chipStyle]}>
        <PhaseChip phase="week_final" />
      </Animated.View>
      <Scoreboard you={{ name: VERSUS.you.name, gain: FINAL.you }} opponent={{ name: VERSUS.opp.name, gain: FINAL.opp }} final showLine={false} />
      <Animated.View style={winnerStyle}>
        {/* headline (17pt, bold): at 1× a title (22pt) already sat above the fitted totals. */}
        <Text variant="headline" maxFontSizeMultiplier={winnerCap} style={[styles.center, styles.winner]}>
          {FINAL.winner}
        </Text>
      </Animated.View>
    </View>
  );
}

/** The Scoreboard's totals (score.xl, capped 1.2×) and its half padding, for the winner-line cap. */
const TOTAL_PT = 32;
const TOTAL_MAX_SCALE = 1.2;
const HALF_PAD = space[5];
/** The winner line's base size (headline). */
const WINNER_PT = 17;

/** The draft board's tile, grown to fill a third of the art panel. */
const TILE_HEIGHT = 64;

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
    width: '100%',
  },
  cell: {
    flexBasis: '30%',
    flexGrow: 1,
  },
  filled: {
    ...StyleSheet.absoluteFillObject,
  },
  fill: {
    width: '100%',
  },
  final: {
    gap: space[5],
  },
  centerSelf: {
    alignSelf: 'center',
  },
  center: {
    textAlign: 'center',
  },
  winner: {
    fontWeight: '700',
  },
});
