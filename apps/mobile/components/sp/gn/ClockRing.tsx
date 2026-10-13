/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';
import type { AnimatedStyle } from 'react-native-reanimated';
import type { TextStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { CLOCK_RING_SIZE, CLOCK_RING_STROKE, CLOCK_RING_TEXT, CLOCK_RING_TEXT_MAX_SCALE, clockRingArc } from '@/lib/game/draftClockCard';

// Stockpile — <ClockRing>, Game Night (§9C; the board's Draft room frame, #call-game-night):
// the pick clock as a ring that runs down. A 6pt `track` circle, the arc over it in its tone
// (`live`; `loss` in the last 10 s), and the clock inside at 20/800, tabular. The arc moves a
// step a second with the clock it shows, never animated between steps, so Reduce Motion has
// nothing to stop. Decorative to VoiceOver: the card around it says the clock in words.

export interface ClockRingProps {
  /** "0:42" (pickClockLabel). */
  label: string;
  secondsLeft: number | null;
  totalSeconds: number;
  tone: 'live' | 'loss';
  /** The clock's colour (the your-turn flash re-inks it on the UI thread). */
  textColor: string;
  textAnimatedStyle?: AnimatedStyle<TextStyle>;
}

export function ClockRing({ label, secondsLeft, totalSeconds, tone, textColor, textAnimatedStyle }: ClockRingProps) {
  const { colors } = useTheme();
  const arc = clockRingArc(secondsLeft, totalSeconds);
  const c = CLOCK_RING_SIZE / 2;
  return (
    <View style={styles.ring} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={CLOCK_RING_SIZE} height={CLOCK_RING_SIZE} style={StyleSheet.absoluteFill}>
        <Circle cx={c} cy={c} r={arc.radius} fill="none" stroke={colors.track} strokeWidth={CLOCK_RING_STROKE} />
        <Circle
          testID="clock-ring-arc"
          cx={c}
          cy={c}
          r={arc.radius}
          fill="none"
          stroke={colors[tone]}
          strokeWidth={CLOCK_RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={arc.circumference}
          strokeDashoffset={arc.dashOffset}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </Svg>
      <Text
        variant="score.md"
        color={textColor}
        animatedStyle={textAnimatedStyle}
        maxFontSizeMultiplier={CLOCK_RING_TEXT_MAX_SCALE}
        numberOfLines={1}
        style={styles.clock}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    width: CLOCK_RING_SIZE,
    height: CLOCK_RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The board's 20/800, tabular (score.md is ExtraBold and tabular; the size is the ring's).
  clock: {
    fontSize: CLOCK_RING_TEXT,
    lineHeight: CLOCK_RING_TEXT + 4,
  },
});
