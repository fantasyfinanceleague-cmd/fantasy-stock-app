/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { radius, space, type } from '@/constants/tokens';
import { PhaseChip } from '@/components/sp/PhaseChip';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { Chyron } from '@/components/sp/game/Chyron';
import { ScoreDigits } from '@/components/sp/game/ScoreDigits';
import { TugBar } from '@/components/sp/game/TugBar';
import { formatMoney } from '@/components/sp/logic/money';
import { FINAL, ROSTER_PICKS, VERSUS } from '@/components/shell/onboarding/sampleData';

// Phase 3b-1 — S1's live vignettes: each onboarding card shows the product
// working, on the board's three cards (Design Lead ruling D2):
//   1. the roster filling round by round;
//   2. versus: the tug bar swinging through a lead change as the scores
//      roll, with the board's chyron;
//   3. the FINAL chip landing and "You win Week 6" rising.
// Each plays ONCE when its card becomes the focused card (`active`) and
// resets when it leaves, so it plays again on return — never a loop (§4).
// The data never moves with the parallax; only decorative layers do
// (OnboardingPager). Reduce Motion: each shows its final frame, still.

export interface VignetteProps {
  active: boolean;
}

// ── 1. Roster filling ────────────────────────────────────────────────────

export function RosterVignette({ active }: VignetteProps) {
  return (
    <View style={styles.grid} accessible accessibilityLabel={`A roster filling round by round: ${ROSTER_PICKS.join(', ')}`}>
      {ROSTER_PICKS.map((ticker, i) => (
        <RosterCell key={ticker} round={i + 1} ticker={ticker} index={i} active={active} />
      ))}
    </View>
  );
}

function RosterCell({ round, ticker, index, active }: { round: number; ticker: string; index: number; active: boolean }) {
  const { colors } = useTheme();
  const { reduced, duration, easing } = useMotion();
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
    <View style={[styles.cell, styles.cellEmpty, { borderColor: colors.borderStrong }]}>
      {/* The filled cell sits over the dashed placeholder's border, not inside it. */}
      <Animated.View style={[styles.cell, styles.cellFilled, { backgroundColor: colors.surface, borderColor: colors.line }, filledStyle]}>
        <Text variant="caption" tone="secondary">{`Rd ${round}`}</Text>
        <Text variant="headline" style={styles.ticker}>
          {ticker}
        </Text>
      </Animated.View>
    </View>
  );
}

// ── 2. Versus, with a lead change ───────────────────────────────────────

export function VersusVignette({ active }: VignetteProps) {
  const { colors } = useTheme();
  const { reduced, duration } = useMotion();
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

  const score = flipped ? VERSUS.after : VERSUS.before;

  return (
    <View style={styles.versus}>
      <View style={styles.versusRow}>
        <Badge initials={VERSUS.you.initials} fill={colors.you} ink={colors.onAccent} label={VERSUS.you.name} />
        <Text variant="score.lg" accessibilityElementsHidden importantForAccessibility="no">
          VS
        </Text>
        <Badge initials={VERSUS.opp.initials} fill={colors.opp} ink={colors.onOpp} label={VERSUS.opp.name} />
      </View>
      <View style={styles.versusRow}>
        <ScoreDigits text={formatMoney(score.you, { sign: 'always' })} variant="score.md" slam={flipped && !reduced} />
        <ScoreDigits text={formatMoney(score.opp, { sign: 'always' })} variant="score.md" />
      </View>
      <TugBar you={score.you} opponent={score.opp} opponentName={VERSUS.opp.name} height={10} />
      <Text variant="tag" tone="secondary" style={styles.center}>
        {VERSUS.tag}
      </Text>
      <View style={styles.chyronSlot}>
        <Chyron message={flipped ? VERSUS.chyron : null} durationMs={60_000} />
      </View>
    </View>
  );
}

function Badge({ initials, fill, ink, label }: { initials: string; fill: string; ink: string; label: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: fill }]} accessible accessibilityLabel={label}>
      <Text variant="headline" color={ink} maxFontSizeMultiplier={1}>
        {initials}
      </Text>
    </View>
  );
}

// ── 3. The Friday final ──────────────────────────────────────────────────

export function FinalVignette({ active }: VignetteProps) {
  const { colors } = useTheme();
  const { reduced, duration, easing, spring, withSpring } = useMotion();
  const chip = useSharedValue(reduced ? 1 : 0);
  const winner = useSharedValue(reduced ? 1 : 0);

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
  // The winner line rises into place.
  const winnerStyle = useAnimatedStyle(() => ({ opacity: winner.value, transform: [{ translateY: 12 * (1 - winner.value) }] }));

  return (
    <View style={styles.final}>
      <Animated.View style={[styles.centerSelf, chipStyle]}>
        <PhaseChip phase="week_final" />
      </Animated.View>
      <View style={styles.versusRow}>
        <Text variant="score.lg" color={colors.gain}>
          {formatMoney(FINAL.you, { sign: 'always' })}
        </Text>
        <Text variant="score.lg" color={colors.loss}>
          {formatMoney(FINAL.opp, { sign: 'always' })}
        </Text>
      </View>
      <Animated.View style={winnerStyle}>
        <Text variant="title" style={styles.center}>
          {FINAL.winner}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[4],
    width: '100%',
  },
  cell: {
    flexBasis: '30%',
    flexGrow: 1,
    height: 70,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space[4],
    justifyContent: 'space-between',
  },
  cellEmpty: {
    borderStyle: 'dashed',
  },
  cellFilled: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
  },
  ticker: {
    fontFamily: type.headline.fontFamily,
  },
  versus: {
    width: '100%',
    gap: space[5],
  },
  versusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chyronSlot: {
    minHeight: 40,
  },
  final: {
    width: '100%',
    gap: space[6],
  },
  centerSelf: {
    alignSelf: 'center',
  },
  center: {
    textAlign: 'center',
  },
});
