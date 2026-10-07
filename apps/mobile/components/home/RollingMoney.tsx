/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { type, TypeVariant } from '@/constants/tokens';
import { digitDiff } from '@/components/sp/logic/digits';
import { fitScale } from '@/components/sp/logic/fitScale';
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
//
// X-1 fix (Design Lead final check, 2026-10-07): because this draws one
// Text per digit, it can't use RN's own `adjustsFontSizeToFit` the way a
// single Text could -- at XL/XXXL Dynamic Type a wide value (seen:
// $14,446,031.99 on Portfolio) ran off the container and clipped its last
// digit. Fixed by measuring the container (outer View) and the row's own
// natural, unscaled width (inner Animated.View -- `transform` never
// affects layout, so its onLayout keeps reporting the TRUE natural size
// even once scaled down), then shrinking the row by `fitScale`'s ratio,
// anchored at the left edge (`transformOrigin`) so it still reads as the
// same left-aligned number, just smaller. Floored at 0.7 -- if even that
// doesn't fit, the row is left to overflow its box rather than ever clip
// (see fitScale.ts).

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
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);

  useEffect(() => {
    prevTextRef.current = text;
    prevKeyRef.current = rollKey;
  });

  const typeStyle = type[size];
  const textColor = color ?? colors.text;
  const scale = fitScale(containerWidth, naturalWidth);

  return (
    <View style={styles.container} onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}>
      <Animated.View
        style={[styles.row, { transform: [{ scale }], transformOrigin: 'left center' }]}
        onLayout={(e) => setNaturalWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={text}
      >
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexShrink: 1 },
  row: { flexDirection: 'row' },
});
