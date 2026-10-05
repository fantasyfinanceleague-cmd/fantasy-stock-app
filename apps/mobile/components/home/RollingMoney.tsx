/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useRef } from 'react';
import { StyleSheet, Text as RNText } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { type, TypeVariant } from '@/constants/tokens';
import { digitDiff } from '@/components/sp/logic/digits';
import { useMotion } from '@/components/sp/motion';
import { useTheme } from '@/components/sp/ThemeProvider';

// Stockpile — <RollingMoney> (Phase 3b-2, Home's H1 "hero roll"), separate
// from <ScoreDigits> (components/sp/game/ScoreDigits.tsx): the hero uses
// `<Card>` with no `variant`, so it rolls on `duration.base` + `easing.settle`
// — a plain timing curve, never a spring or an overshoot — matching that
// row's own H1 motion. ScoreDigits is `<Card variant="scoreboard">`'s own
// digit roll and is free to use `lively` where the game surface calls for it.
//
// `rollKey` (the active league's id) is the H5 guard: switching leagues
// must never present a different league's number as a "change" (spec:
// "key Roll by league id so a different league's value is never presented
// as a change"). When `rollKey` differs from the previous render, this
// diffs `text` against ITSELF instead of the real previous text, so every
// column reads as unchanged and nothing rolls — identical to "never on
// first paint" (mount and a league switch are the same case: no prior
// value to roll FROM).

interface DigitColumnProps {
  char: string;
  changed: boolean;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  textColor: string;
  reduced: boolean;
  duration: number;
  easing: ReturnType<typeof useMotion>['easing']['settle'];
  withTiming: ReturnType<typeof useMotion>['withTiming'];
  maxFontSizeMultiplier?: number;
}

function DigitColumn({
  char, changed, fontFamily, fontSize, lineHeight, textColor, reduced, duration, easing, withTiming, maxFontSizeMultiplier,
}: DigitColumnProps) {
  const progress = useSharedValue(changed ? 0 : 1);

  useEffect(() => {
    if (!changed || reduced) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration, easing });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-running per render, not just per `char`: a same-character "change" (round trip) still needs its own roll if `changed` says so.
  }, [char, changed, reduced]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 8 }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <RNText
        style={{ fontFamily, fontSize, lineHeight, color: textColor, fontVariant: ['tabular-nums'] }}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        numberOfLines={1}
      >
        {char}
      </RNText>
    </Animated.View>
  );
}

export interface RollingMoneyProps {
  /** Pre-formatted text (from formatMoney/formatPercent) — this component
   * only handles the roll, never the money formatting itself. */
  text: string;
  size: TypeVariant;
  color?: string;
  /** The active league's id — see the module doc's H5 guard. */
  rollKey: string;
}

export function RollingMoney({ text, size, color, rollKey }: RollingMoneyProps) {
  const { colors } = useTheme();
  const { reduced, duration, easing, withTiming } = useMotion();
  const prevTextRef = useRef(text);
  const prevKeyRef = useRef(rollKey);
  const keyChanged = prevKeyRef.current !== rollKey;
  const diff = digitDiff(keyChanged ? text : prevTextRef.current, text);

  useEffect(() => {
    prevTextRef.current = text;
    prevKeyRef.current = rollKey;
  });

  const typeStyle = type[size];
  const textColor = color ?? colors.text;

  return (
    <Animated.View style={styles.row} accessibilityLabel={text}>
      {diff.map((entry, i) => (
        <DigitColumn
          key={`${i}-${diff.length}-${rollKey}`}
          char={entry.char}
          changed={entry.changed}
          fontFamily={typeStyle.fontFamily}
          fontSize={typeStyle.fontSize}
          lineHeight={typeStyle.lineHeight}
          textColor={textColor}
          reduced={reduced}
          duration={duration.base}
          easing={easing.settle}
          withTiming={withTiming}
          maxFontSizeMultiplier={typeStyle.maxScale}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexShrink: 1 },
});
