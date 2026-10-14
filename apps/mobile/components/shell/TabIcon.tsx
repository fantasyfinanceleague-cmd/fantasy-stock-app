import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { ThemeColors } from '@/constants/tokens/color';
import { Icon } from '@/components/sp/Icon';
import { useMotion } from '@/components/sp/motion';
import type { IconName } from '@/components/sp/logic/icon';

// Phase 3b-1 — the four tab icons (spec row 15; Design Lead ruling
// 2026-09-29): a filled glyph when active, its outline when not —
// home, trending-up (line chart), trophy, bar-chart. gn-sweep: drawn through
// sp/Icon's set (the `tab*` names, the `tab` role: 24pt, no Dynamic Type growth).
//
// Both glyphs are stacked and crossfade (`quick`, settle) so the outline →
// filled change is part of S2's micro-animation rather than a hard swap;
// ShellTabBar adds the one-shot scale bump. Reduce Motion: instant swap.

export type TabIconName = 'home' | 'matchup' | 'league' | 'portfolio';

const GLYPHS: Record<TabIconName, { filled: IconName; outline: IconName }> = {
  home: { filled: 'tabHomeSelected', outline: 'tabHome' },
  matchup: { filled: 'tabMatchupSelected', outline: 'tabMatchup' },
  league: { filled: 'tabLeagueSelected', outline: 'tabLeague' },
  portfolio: { filled: 'tabPortfolioSelected', outline: 'tabPortfolio' },
};

/** The tab icon's box: the `tab` role's 24pt (it never scales). */
const SIZE = 24;

export interface TabIconProps {
  name: TabIconName;
  /** The theme token the tab's label reads (accent when selected, text2 when not). */
  tone: keyof ThemeColors;
  focused: boolean;
}

export function TabIcon({ name, tone, focused }: TabIconProps) {
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
    <View style={{ width: SIZE, height: SIZE }}>
      <Animated.View style={[StyleSheet.absoluteFill, outlineStyle]}>
        <Icon name={glyph.outline} size="tab" tone={tone} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, filledStyle]}>
        <Icon name={glyph.filled} size="tab" tone={tone} />
      </Animated.View>
    </View>
  );
}
