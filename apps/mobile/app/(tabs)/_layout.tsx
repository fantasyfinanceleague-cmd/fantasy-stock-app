import React from 'react';
import { Easing } from 'react-native';
import { Tabs } from 'expo-router';

import { motion } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ShellTabBar } from '@/components/shell/ShellTabBar';

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

export default function TabLayout() {
  const { colors } = useTheme();

  return (
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
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}
