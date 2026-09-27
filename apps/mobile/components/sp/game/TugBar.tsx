/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { color, radius } from '@/constants/tokens';
import { tugRatio, hasLeadChanged, tugAccessibilityLabel } from '@/components/sp/logic/tug';
import { useMotion } from '@/components/sp/motion';
import { useLeadChangeSpring } from '@/components/sp/game/motion';

// Stockpile — <TugBar> (Phase 2 foundation). SOURCE OF TRUTH: §4/§9. "you vs
// opponent ratio, clamps, overshoots with `lively` on a lead change."
// Game surface only — team colours are used here strictly as FILLS, never
// as text (§9's non-swap rule), which is exactly what this component does.
//
// Accessibility (Design Lead, 2026-09-26): the label is dollars only, never a
// percentage — the visual ratio is a clamped layout fraction, not a
// probability, and reading it aloud as one would read as a win probability
// (ruled out product-wide). `opponentName` is required so the label can be
// worded correctly ("You lead by $X" / "{name} leads by $X" / "Tied") — see
// components/sp/logic/tug.ts's tugAccessibilityLabel.

export interface TugBarProps {
  you: number;
  opponent: number;
  opponentName: string;
  height?: number;
}

export function TugBar({ you, opponent, opponentName, height = 8 }: TugBarProps) {
  const ratio = tugRatio(you, opponent);
  const prevRef = useRef({ you, opponent });
  const leadChanged = hasLeadChanged(prevRef.current.you, prevRef.current.opponent, you, opponent);

  const widthPercent = useSharedValue(ratio * 100);
  const { reduced, duration, easing, withTiming, withSpring } = useMotion();
  const leadChangeSpring = useLeadChangeSpring();

  useEffect(() => {
    const target = ratio * 100;
    if (reduced) {
      // §5: "Tug bar overshoot ... -> Set to final value, no overshoot."
      widthPercent.value = target;
    } else if (leadChanged) {
      widthPercent.value = withSpring(target, leadChangeSpring);
    } else {
      widthPercent.value = withTiming(target, { duration: duration.base, easing: easing.settle });
    }
    prevRef.current = { you, opponent };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ratio`/`leadChanged` are derived from you/opponent every render; re-keying on them would re-run this identically.
  }, [you, opponent]);

  const youFillStyle = useAnimatedStyle(() => ({ width: `${widthPercent.value}%` }));
  const opponentFillStyle = useAnimatedStyle(() => ({ width: `${100 - widthPercent.value}%` }));

  return (
    <View
      style={[styles.track, { height, borderRadius: height / 2 }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={tugAccessibilityLabel(you, opponent, opponentName)}
    >
      <Animated.View style={[styles.fill, styles.youFill, youFillStyle]} />
      <Animated.View style={[styles.fill, styles.opponentFill, opponentFillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: color.surface.game.line,
  },
  fill: {
    height: '100%',
  },
  youFill: {
    backgroundColor: color.team.you.onGame,
    borderTopLeftRadius: radius.pill,
    borderBottomLeftRadius: radius.pill,
  },
  opponentFill: {
    backgroundColor: color.team.opponent,
    borderTopRightRadius: radius.pill,
    borderBottomRightRadius: radius.pill,
  },
});
