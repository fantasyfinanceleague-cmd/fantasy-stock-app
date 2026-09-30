/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { brand } from '@/constants/brand';

// Phase 3b-1 — the refined bars as animatable Views (S4 auth brand moment,
// S5 pull-to-refresh). Same proportions as sp/BrandMark (8/12/16 of a 24
// grid, the tallest in accent, the others text2), but each bar grows from
// its own baseline via a per-bar `rise` value (0 = flat, 1 = full), so a
// caller can drive them from time (S4) or from pull distance (S5).

const HEIGHTS = [8, 12, 16] as const;
const GRID = 24;
const BAR = 4;
const GAP = 2.5;
/** S4: "the three brand bars rise in sequence (slow, 60 ms stagger)". */
export const BRAND_BAR_STAGGER_MS = 60;

export interface BrandBarsProps {
  size: number;
  /** One 0..1 value per bar. */
  rise: readonly [SharedValue<number>, SharedValue<number>, SharedValue<number>];
}

export function BrandBars({ size, rise }: BrandBarsProps) {
  const { colors } = useTheme();
  const unit = size / GRID;
  return (
    <View style={[styles.row, { height: HEIGHTS[2] * unit, gap: GAP * unit }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {HEIGHTS.map((h, i) => (
        <Bar key={h} height={h * unit} width={BAR * unit} color={i === 2 ? colors.accent : colors.text2} rise={rise[i]} />
      ))}
    </View>
  );
}

function Bar({ height, width, color, rise }: { height: number; width: number; color: string; rise: SharedValue<number> }) {
  // Grow from the baseline: translate down by the missing half, then scale.
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: (height * (1 - rise.value)) / 2 }, { scaleY: Math.max(rise.value, 0.001) }],
  }));
  return <Animated.View style={[{ height, width, borderRadius: width * 0.375, backgroundColor: color }, style]} />;
}

/** Three rise values, rising once on mount in sequence (S4); already risen under Reduce Motion. */
export function useRisingBars() {
  const { reduced, duration, easing } = useMotion();
  const a = useSharedValue(reduced ? 1 : 0);
  const b = useSharedValue(reduced ? 1 : 0);
  const c = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    [a, b, c].forEach((v, i) => {
      v.value = withDelay(i * BRAND_BAR_STAGGER_MS, withTiming(1, { duration: duration.slow, easing: easing.settle }));
    });
    // Mount-only: the moment plays once per screen visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [a, b, c] as const;
}

/** The bars plus the wordmark (brand.name) — the auth screens' header. */
export function BrandLockup() {
  const rise = useRisingBars();
  return (
    <View style={styles.lockup} accessible accessibilityRole="header" accessibilityLabel={brand.name}>
      <BrandBars size={30} rise={rise} />
      <Text variant="title" style={styles.wordmark}>
        {brand.wordmark}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  lockup: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  wordmark: {
    lineHeight: 26,
  },
});
