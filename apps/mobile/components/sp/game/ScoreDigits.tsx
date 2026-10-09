/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside DigitColumn's render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useRef } from 'react';
import { StyleSheet, Text as RNText } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, WithSpringConfig } from 'react-native-reanimated';
import type { withTiming as withTimingType, EasingFunctionFactory } from 'react-native-reanimated';

import { type, TypeVariant } from '@/constants/tokens';
import { digitDiff, DigitDiffEntry } from '@/components/sp/logic/digits';
import { useMotion } from '@/components/sp/motion';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useLeadChangeSpring } from '@/components/sp/game/motion';

// Stockpile — <ScoreDigits> (Phase 2 foundation). SOURCE OF TRUTH: the Phase
// 2 brief ("per-digit roll on change only, never on first paint") and §4/§5.
//
// Each character of `text` renders in its own animated column; only the
// columns `digitDiff` marks as changed roll in, the rest stay static. On
// FIRST paint every column reads as unchanged (there is no previous text to
// differ from, by construction — see `prevTextRef` below), so nothing rolls
// on mount, matching "never on first paint".
//
// `DigitColumn` is declared BEFORE `ScoreDigits` (which renders it) — an
// ordinary forward reference, not the RN styles-at-bottom idiom. The
// file-top eslint-disable below covers a real instance of that idiom
// instead (2026-10-07): `styles` (DigitColumn's own `flexShrink: 1`, a
// ThisWeekCard-overlap follow-up) is declared at the bottom and used
// inside DigitColumn, which runs after module init, so there's no TDZ.

interface DigitColumnProps {
  entry: DigitDiffEntry;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  textColor: string;
  reduced: boolean;
  duration: number;
  easing: EasingFunctionFactory;
  withTiming: typeof withTimingType;
  slam: boolean;
  leadChangeSpring: WithSpringConfig;
  maxFontSizeMultiplier?: number;
}

function DigitColumn({
  entry,
  fontFamily,
  fontSize,
  lineHeight,
  textColor,
  reduced,
  duration,
  easing,
  withTiming,
  slam,
  leadChangeSpring,
  maxFontSizeMultiplier,
}: DigitColumnProps) {
  const progress = useSharedValue(entry.changed ? 0 : 1);

  useEffect(() => {
    if (!entry.changed || reduced) {
      // §5: digit roll -> instant swap under reduced motion; static columns
      // never animate regardless.
      progress.value = 1;
      return;
    }
    progress.value = 0;
    if (slam) {
      progress.value = withSpring(1, leadChangeSpring);
    } else {
      progress.value = withTiming(1, { duration, easing });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-running per render (not just per `entry.char`) is intentional: a same-character "change" (e.g. 5 -> 5 after a round trip) still needs its own roll if `entry.changed` says so.
  }, [entry.char, entry.changed, reduced, slam]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 10 }],
  }));

  return (
    // `flexShrink: 1` here is load-bearing, not just on the parent row
    // (2026-10-07, a ThisWeekCard follow-up): the row's OWN flexShrink
    // bounds the ROW's box, but without each COLUMN also being shrinkable,
    // Yoga gives every column its natural/intrinsic width regardless --
    // the row's box ends up correctly sized while its children overflow
    // past it unconstrained, which is what was actually happening (two
    // ScoreDigits rows overlapping at $1M+ even after their containers
    // were fixed to a real 50/50 split). With this, a squeeze on the row
    // actually squeezes each column, so each Text receives a real,
    // bounded width and adjustsFontSizeToFit below has something to
    // shrink against.
    <Animated.View style={[styles.column, animatedStyle]}>
      <RNText
        style={{ fontFamily, fontSize, lineHeight, color: textColor, fontVariant: ['tabular-nums'] }}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        // Safety net (Design Lead, 2026-09-29): a score must never leave its
        // card, even past the maxFontSizeMultiplier cap above or at an
        // unusually wide value. adjustsFontSizeToFit scales it down (never
        // below 0.6x) rather than letting it overflow -- once the column
        // above actually has a bounded width to measure against.
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {entry.char}
      </RNText>
    </Animated.View>
  );
}

export interface ScoreDigitsProps {
  text: string;
  variant?: Extract<TypeVariant, 'score.xl' | 'score.lg' | 'score.md'>;
  color?: string;
  /** Game-only "score slam" overshoot for a lead-change moment (§9: lively
   * is importable only from game components — this is that import site). */
  slam?: boolean;
}

export function ScoreDigits({ text, variant = 'score.md', color: colorProp, slam = false }: ScoreDigitsProps) {
  const { colors } = useTheme();
  const prevTextRef = useRef(text);
  const diff = digitDiff(prevTextRef.current, text);
  const { reduced, duration, easing, withTiming } = useMotion();
  const leadChangeSpring = useLeadChangeSpring();

  useEffect(() => {
    prevTextRef.current = text;
  }, [text]);

  const typeStyle = type[variant];
  const textColor = colorProp ?? colors.text;

  return (
    <Animated.View style={{ flexDirection: 'row', flexShrink: 1 }}>
      {diff.map((entry, index) => (
        <DigitColumn
          key={`${index}-${diff.length}`}
          entry={entry}
          fontFamily={typeStyle.fontFamily}
          fontSize={typeStyle.fontSize}
          lineHeight={typeStyle.lineHeight}
          textColor={textColor}
          reduced={reduced}
          duration={duration.base}
          easing={easing.settle}
          withTiming={withTiming}
          slam={slam}
          leadChangeSpring={leadChangeSpring}
          maxFontSizeMultiplier={typeStyle.maxScale}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  column: { flexShrink: 1 },
});
