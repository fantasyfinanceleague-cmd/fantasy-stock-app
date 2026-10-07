/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { ScrollFoldContext, useScrollFoldSource } from './scrollFold';
import Animated, {
  cancelAnimation,
  runOnJS,
  SharedValue,
  useAnimatedScrollHandler,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { BrandBars, BRAND_BAR_STAGGER_MS } from '@/components/shell/BrandBars';

// Phase 3b-1 — S5, the custom pull-to-refresh.
//
// iOS: the three brand bars sit just above the content and are revealed by
// the overscroll; each rises with the pull distance (bar i starts a little
// after bar i−1). Past the threshold it arms, with one light haptic;
// releasing there starts the refresh, holds the bars in view, and they
// pulse ONLY while the refresh is actually in flight — a progress
// indicator, never a decorative loop. It follows the theme (accent + text2).
// Android: an accent-tinted RefreshControl (approved fallback — no bounce
// overscroll to reveal the bars).
// Reduce Motion: no rise and no pulse — a static bar icon with a
// "Refreshing…" label while it runs.

const THRESHOLD = 72;
const HEADER = 64;

export interface BarsRefreshProps {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function BarsRefresh({ onRefresh, children, contentContainerStyle }: BarsRefreshProps) {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  // 3c-2, UX rule 7: children can tell what's below the fold (StandingsTable pins your row).
  const fold = useScrollFoldSource();
  const measureRef = useRef<View>(null);
  const onViewLayout = () => {
    measureRef.current?.measureInWindow((_x, y, _w, h) => fold.setViewport({ top: y, bottom: y + h }));
  };

  const run = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  if (Platform.OS !== 'ios') {
    return (
      <View ref={measureRef} style={styles.fill} onLayout={onViewLayout}>
        <ScrollFoldContext.Provider value={fold.value}>
          <ScrollView
            contentContainerStyle={contentContainerStyle}
            keyboardShouldPersistTaps="handled"
            onScroll={fold.emit}
            scrollEventThrottle={16}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={run} colors={[colors.accent]} tintColor={colors.accent} />}
          >
            {children}
          </ScrollView>
        </ScrollFoldContext.Provider>
      </View>
    );
  }
  return (
    <View ref={measureRef} style={styles.fill} onLayout={onViewLayout}>
      <ScrollFoldContext.Provider value={fold.value}>
        <IosBarsRefresh refreshing={refreshing} run={run} contentContainerStyle={contentContainerStyle} onScrolled={fold.emit}>
          {children}
        </IosBarsRefresh>
      </ScrollFoldContext.Provider>
    </View>
  );
}

function IosBarsRefresh({
  refreshing,
  run,
  children,
  contentContainerStyle,
  onScrolled,
}: {
  refreshing: boolean;
  run: () => void;
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** The fold signal (throttled on the JS side). */
  onScrolled: () => void;
}) {
  const { reduced, duration, easing } = useMotion();
  const pull = useSharedValue(0);
  const armed = useSharedValue(false);
  const pulse = [useSharedValue(1), useSharedValue(1), useSharedValue(1)] as const;
  const scrollRef = useRef<Animated.ScrollView>(null);

  const armHaptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      runOnJS(onScrolled)();
      pull.value = Math.max(0, -e.contentOffset.y);
      const nowArmed = pull.value >= THRESHOLD;
      if (nowArmed && !armed.value) runOnJS(armHaptic)();
      armed.value = nowArmed;
    },
    onEndDrag: () => {
      if (armed.value) runOnJS(run)();
    },
  });

  // While in flight: hold the bars in view, and pulse them (full motion only).
  useEffect(() => {
    if (!refreshing) {
      pulse.forEach((p) => {
        cancelAnimation(p);
        p.value = 1;
      });
      return;
    }
    scrollRef.current?.scrollTo({ y: -HEADER, animated: !reduced });
    if (reduced) return;
    pulse.forEach((p, i) => {
      p.value = withDelay(
        i * BRAND_BAR_STAGGER_MS,
        withRepeat(
          withSequence(withTiming(0.45, { duration: duration.base, easing: easing.settle }), withTiming(1, { duration: duration.base, easing: easing.settle })),
          -1
        )
      );
    });
    // pulse values are stable refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing, reduced, duration.base, easing.settle]);

  // Bar i rises over its own slice of the pull; held full while refreshing.
  const rise0 = useRise(pull, 0, refreshing, reduced, pulse[0]);
  const rise1 = useRise(pull, 1, refreshing, reduced, pulse[1]);
  const rise2 = useRise(pull, 2, refreshing, reduced, pulse[2]);

  return (
    <Animated.ScrollView
      ref={scrollRef}
      onScroll={onScroll}
      scrollEventThrottle={16}
      // A field near the end of a tab (the draft queue's search) scrolls above the
      // keyboard, and a tap on a search result selects it rather than only
      // dismissing the keyboard. Both act only while the keyboard is up.
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      contentInset={{ top: refreshing ? HEADER : 0 }}
      contentContainerStyle={contentContainerStyle}
      accessibilityState={{ busy: refreshing }}
    >
      <View style={styles.header} accessibilityLiveRegion="polite">
        <BrandBars size={28} rise={[rise0, rise1, rise2]} />
        {reduced && refreshing ? (
          <Text variant="caption" tone="secondary">
            Refreshing…
          </Text>
        ) : null}
      </View>
      {children}
    </Animated.ScrollView>
  );
}

function useRise(pull: SharedValue<number>, i: number, refreshing: boolean, reduced: boolean, pulse: SharedValue<number>) {
  return useDerivedValue(() => {
    if (reduced) return 1; // a static bar icon
    if (refreshing) return pulse.value;
    const start = (i * THRESHOLD) / 4;
    return Math.min(1, Math.max(0, (pull.value - start) / (THRESHOLD / 2)));
    // `refreshing` / `reduced` are JS-side values captured by the worklet.
  }, [refreshing, reduced]);
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: -HEADER,
    left: 0,
    right: 0,
    height: HEADER,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
});
