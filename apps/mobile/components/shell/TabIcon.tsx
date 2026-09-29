import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { useMotion } from '@/components/sp/motion';

// Phase 3b-1 — the four tab icons (spec row 15; Design Lead ruling
// 2026-09-29): a filled glyph when active, its outline when not —
// home, trending-up (line chart), trophy, bar-chart.
//
// Both glyphs are stacked and crossfade (`quick`, settle) so the outline →
// filled change is part of S2's micro-animation rather than a hard swap;
// ShellTabBar adds the one-shot scale bump. Reduce Motion: instant swap.

export type TabIconName = 'home' | 'matchup' | 'league' | 'portfolio';

const GLYPHS: Record<TabIconName, { filled: keyof typeof Ionicons.glyphMap; outline: keyof typeof Ionicons.glyphMap }> = {
  home: { filled: 'home', outline: 'home-outline' },
  matchup: { filled: 'trending-up', outline: 'trending-up-outline' },
  league: { filled: 'trophy', outline: 'trophy-outline' },
  portfolio: { filled: 'bar-chart', outline: 'bar-chart-outline' },
};

export interface TabIconProps {
  name: TabIconName;
  color: string;
  focused: boolean;
  size?: number;
}

export function TabIcon({ name, color, focused, size = 24 }: TabIconProps) {
  const { reduced, duration, easing } = useMotion();
  const filled = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    const target = focused ? 1 : 0;
    filled.value = reduced ? target : withTiming(target, { duration: duration.quick, easing: easing.settle });
  }, [focused, reduced, duration.quick, easing.settle, filled]);

  const filledStyle = useAnimatedStyle(() => ({ opacity: filled.value }));
  const outlineStyle = useAnimatedStyle(() => ({ opacity: 1 - filled.value }));
  const glyph = GLYPHS[name];

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, outlineStyle]}>
        <Ionicons name={glyph.outline} size={size} color={color} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, filledStyle]}>
        <Ionicons name={glyph.filled} size={size} color={color} />
      </Animated.View>
    </View>
  );
}
