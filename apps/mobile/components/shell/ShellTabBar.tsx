/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ComponentProps, useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import type { Tabs } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { radius, space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { TabIcon, type TabIconName } from '@/components/shell/TabIcon';

// Phase 3b-1 — the tab bar (spec row 15 + signature moment S2).
//
// Replaces the default bottom-tab bar, which read the legacy white palette regardless of
// theme. Everything here reads useTheme(): `tabbar` background, `accent` for
// the active tab, `text2` for inactive (both pairs are already in
// contrastPairs.ts: "Active tab label" / "Inactive tab labels").
//
// S2: a small accent pill under the active label springs between tabs
// (spring.snappy), and the newly selected icon does a one-shot 1 → 1.12 → 1
// bounce (quick) while its stroke thickens (TabIcon). Reduce Motion: the
// indicator jumps (fading in at `quick`), no bounce; the haptic stays.

// Derived from expo-router's own Tabs rather than imported from
// @react-navigation/bottom-tabs: that package isn't a direct dependency, and
// importing its types directly changed tsc's resolution of the global timer
// functions (setInterval began returning number, breaking matchup.tsx's
// NodeJS.Timeout ref) — observed, mechanism not investigated.
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const TABS: { name: string; label: string; icon: TabIconName }[] = [
  { name: 'index', label: 'Home', icon: 'home' },
  { name: 'matchup', label: 'Matchup', icon: 'matchup' },
  { name: 'league', label: 'League', icon: 'league' },
  { name: 'portfolio', label: 'Portfolio', icon: 'portfolio' },
];

const INDICATOR_WIDTH = 18;
const BOUNCE_SCALE = 1.12;
/** Tab labels scale with Dynamic Type, but only this far (spec: "tab labels scale within their cap"). */
const LABEL_MAX_SCALE = 1.3;

export function ShellTabBar({ state, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { reduced, spring, duration, withSpring } = useMotion();
  const [rowWidth, setRowWidth] = useState(0);

  const focusedName = state.routes[state.index]?.name;
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.name === focusedName));
  const tabWidth = rowWidth / TABS.length;

  const indicatorX = useSharedValue(0);
  const indicatorOpacity = useSharedValue(0);

  useEffect(() => {
    if (!tabWidth) return;
    const x = activeIndex * tabWidth + (tabWidth - INDICATOR_WIDTH) / 2;
    if (reduced || indicatorOpacity.value === 0) {
      // Reduce Motion (and the very first placement): jump, then fade in.
      indicatorX.value = x;
      indicatorOpacity.value = 0;
      indicatorOpacity.value = withTiming(1, { duration: duration.quick });
    } else {
      indicatorX.value = withSpring(x, spring.snappy);
    }
    // Shared values are stable refs; listing them would add nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, tabWidth, reduced]);

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: indicatorOpacity.value,
    transform: [{ translateX: indicatorX.value }],
  }));

  const onRowLayout = (e: LayoutChangeEvent) => setRowWidth(e.nativeEvent.layout.width);

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        { backgroundColor: colors.tabbar, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, space[3]) },
      ]}
    >
      <View style={styles.row} onLayout={onRowLayout}>
        {TABS.map((tab) => {
          const route = state.routes.find((r) => r.name === tab.name);
          if (!route) return null;
          const focused = route.name === focusedName;
          const onPress = () => {
            Haptics.selectionAsync().catch(() => {});
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });
          return (
            <TabItem
              key={tab.name}
              label={tab.label}
              icon={tab.icon}
              focused={focused}
              color={focused ? colors.accent : colors.text2}
              onPress={onPress}
              onLongPress={onLongPress}
            />
          );
        })}
        <Animated.View
          pointerEvents="none"
          style={[styles.indicator, { backgroundColor: colors.accent }, indicatorStyle]}
        />
      </View>
    </View>
  );
}

interface TabItemProps {
  label: string;
  icon: TabIconName;
  focused: boolean;
  color: string;
  onPress: () => void;
  onLongPress: () => void;
}

function TabItem({ label, icon, focused, color, onPress, onLongPress }: TabItemProps) {
  const { reduced, duration, easing } = useMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!focused || reduced) return;
    const half = { duration: duration.quick / 2, easing: easing.settle };
    scale.value = withSequence(withTiming(BOUNCE_SCALE, half), withTiming(1, half));
  }, [focused, reduced, duration.quick, easing.settle, scale]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.tab}
    >
      <Animated.View style={iconStyle}>
        <TabIcon name={icon} color={color} focused={focused} />
      </Animated.View>
      {/* Labels scale within their 3b-1 cap (LABEL_MAX_SCALE). Hiding them at
          large sizes was reverted (Design Lead, F1): the cap keeps every label
          on one line, and the tab keeps its accessibilityLabel either way. */}
      <Text variant="caption" color={color} numberOfLines={1} maxFontSizeMultiplier={LABEL_MAX_SCALE} style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space[3],
  },
  row: {
    flexDirection: 'row',
    paddingBottom: space[3],
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: space[1],
    minHeight: 44,
  },
  label: {
    textAlign: 'center',
  },
  indicator: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: INDICATOR_WIDTH,
    height: 3,
    borderRadius: radius.pill,
  },
});
