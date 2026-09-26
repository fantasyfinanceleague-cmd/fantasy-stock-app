import { useEffect, useRef } from 'react';
import { Text as RNText } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, WithSpringConfig } from 'react-native-reanimated';
import type { withTiming as withTimingType, EasingFunctionFactory } from 'react-native-reanimated';

import { color as tokenColor, type, TypeVariant } from '@/constants/tokens';
import { digitDiff, DigitDiffEntry } from '@/components/sp/logic/digits';
import { useMotion } from '@/components/sp/motion';
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
// `DigitColumn` is declared BEFORE `ScoreDigits` (which renders it) so this
// file needs no eslint-disable: unlike the RN styles-at-bottom idiom, this
// isn't a value only referenced inside a later render — it's an ordinary
// forward reference, so it's fixed by reordering, not suppressing (CLAUDE.md
// "ESLint (mobile)": real TDZ-shaped issues get fixed, not silenced).

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
    <Animated.View style={animatedStyle}>
      <RNText style={{ fontFamily, fontSize, lineHeight, color: textColor, fontVariant: ['tabular-nums'] }}>{entry.char}</RNText>
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
  const prevTextRef = useRef(text);
  const diff = digitDiff(prevTextRef.current, text);
  const { reduced, duration, easing, withTiming } = useMotion();
  const leadChangeSpring = useLeadChangeSpring();

  useEffect(() => {
    prevTextRef.current = text;
  }, [text]);

  const typeStyle = type[variant];
  const textColor = colorProp ?? tokenColor.text.onGame.primary;

  return (
    <Animated.View style={{ flexDirection: 'row' }}>
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
        />
      ))}
    </Animated.View>
  );
}
