import React, { useEffect, useRef } from 'react';
import { Easing, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Tabs } from 'expo-router';

import { motion } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ShellTabBar } from '@/components/shell/ShellTabBar';
import { useMotion } from '@/components/sp/motion';
import { consumeSignInEntrance } from '@/lib/shell/signInTransition';

// Phase 3b-1 — the four tabs (spec row 15): Home · Matchup · League ·
// Portfolio, drawn by ShellTabBar from useTheme() tokens (this file used to
// hard-code the legacy white palette). Profile left the tab bar (the Home avatar opens
// it); `draft` stays a hidden route, reached from the League tab while a
// league is drafting and from draft notifications.
//
// No auth check here: the root Stack.Protected guard (app/_layout.tsx)
// removes (tabs) from the navigator entirely while signed out.
//
// Screens crossfade at `quick` (settle) when switching tabs. A fade has no
// translation, so it is already the Reduce Motion row as well.

const renderTabBar = (props: React.ComponentProps<typeof ShellTabBar>) => <ShellTabBar {...props} />;

const SETTLE = Easing.bezier(...motion.ease.settle);

// Declared above its use (not the RN styles-at-bottom idiom), so
// no-use-before-define stays live for this file's logic.
const styles = StyleSheet.create({
  fill: { flex: 1 },
});

// S4: right after an intentional sign-in, the app scales in 0.96 → 1 at
// `feature` while the root Stack crossfades it in (app/_layout.tsx). Plays
// once; a cold start or a tab switch never triggers it. Reduce Motion: no
// scale (the root's crossfade drops to `base`).
const ENTRANCE_SCALE = 0.96;

export default function TabLayout() {
  const { colors } = useTheme();
  const { reduced, duration, easing } = useMotion();
  const entrance = useRef(consumeSignInEntrance()).current;
  const progress = useSharedValue(entrance && !reduced ? 0 : 1);

  useEffect(() => {
    if (!entrance || reduced) return;
    progress.value = withTiming(1, { duration: duration.feature, easing: easing.settle });
    // Mount-only: the entrance plays once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entranceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ENTRANCE_SCALE + (1 - ENTRANCE_SCALE) * progress.value }],
  }));

  return (
    <Animated.View style={[styles.fill, { backgroundColor: colors.bg }, entranceStyle]}>
      <Tabs
        tabBar={renderTabBar}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.bg },
          animation: 'fade',
          transitionSpec: { animation: 'timing', config: { duration: motion.duration.quick, easing: SETTLE } },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="matchup" options={{ title: 'Matchup' }} />
        <Tabs.Screen name="league" options={{ title: 'League' }} />
        <Tabs.Screen name="portfolio" options={{ title: 'Portfolio' }} />
        <Tabs.Screen name="draft" options={{ href: null }} />
      </Tabs>
    </Animated.View>
  );
}
