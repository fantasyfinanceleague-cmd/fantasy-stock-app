/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { RefObject, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInDown,
  ReduceMotion,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { radius, space } from '@/constants/tokens';
import { Button, FULL_WIDTH_FONT_SCALE } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { LeagueSheetRow } from '@/components/shell/LeagueSheetRow';
import { useLeagueContext } from '@/lib/LeagueContext';
import { groupLeagues } from '@/lib/shell/leagueSheet';

// Phase 3b-1 — the league sheet (spec row 9, board "League sheet").
//
// Leagues grouped Live this week / Upcoming / Finished (lib/shell/leagueSheet
// .ts), each row rank · record + PhaseChip, a check on the active league,
// and [Create league] [Join with code] ALWAYS at the bottom — the sheet is
// the one entry point to both that exists in every state, including zero
// leagues (the CLAUDE.md reachability lesson).
//
// Motion: opens on spring.snappy with the scrim fading `base`; rows spring
// in staggered 30 ms, at most 8 (S3). Reduce Motion: the sheet fades in
// place and rows appear together. Drag down anywhere on the sheet to
// dismiss; while the list is scrolled, the drag scrolls it instead
// (react-native-gesture-handler, so the two gestures interleave).

const STAGGER_MS = 30;
const STAGGER_MAX = 8;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

export interface LeagueSheetProps {
  open: boolean;
  onClose: () => void;
  onPick: (id: string, name: string, rowLabel: RefObject<View | null>) => void;
  onCreate: () => void;
  onJoin: () => void;
}

export function LeagueSheet({ open, onClose, onPick, onCreate, onJoin }: LeagueSheetProps) {
  const { colors, elevation } = useTheme();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { reduced, spring, duration, easing } = useMotion();
  const { sheetLeagues, activeLeagueId } = useLeagueContext();
  const [mounted, setMounted] = useState(open);

  const offset = useSharedValue(windowHeight); // 0 = fully open
  const drag = useSharedValue(0);
  const fade = useSharedValue(0); // scrim, and the whole sheet under Reduce Motion
  const scrollY = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setMounted(true);
      drag.value = 0;
      if (reduced) {
        offset.value = 0;
        fade.value = withTiming(1, { duration: duration.quick });
      } else {
        offset.value = windowHeight;
        offset.value = withSpring(0, spring.snappy);
        fade.value = withTiming(1, { duration: duration.base, easing: easing.settle });
      }
    } else if (mounted) {
      const unmount = (finished?: boolean) => {
        'worklet';
        if (finished) runOnJS(setMounted)(false);
      };
      if (reduced) {
        fade.value = withTiming(0, { duration: duration.quick }, unmount);
      } else {
        fade.value = withTiming(0, { duration: duration.base, easing: easing.exit });
        offset.value = withSpring(windowHeight, spring.snappy, unmount);
      }
    }
    // Shared values are stable; `mounted` is this effect's own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const native = Gesture.Native();
  const pan = Gesture.Pan()
    .simultaneousWithExternalGesture(native)
    .onUpdate((e) => {
      drag.value = scrollY.value <= 0 && e.translationY > 0 ? e.translationY : 0;
    })
    .onEnd((e) => {
      if (drag.value > DISMISS_DISTANCE || (drag.value > 0 && e.velocityY > DISMISS_VELOCITY)) {
        runOnJS(onClose)();
      } else {
        drag.value = withSpring(0, spring.snappy);
      }
    });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const sheetStyle = useAnimatedStyle(() =>
    reduced
      ? { opacity: fade.value, transform: [{ translateY: drag.value }] }
      : { transform: [{ translateY: offset.value + drag.value }] }
  );

  if (!mounted) return null;

  const groups = groupLeagues(sheetLeagues);
  const stacked = fontScale >= FULL_WIDTH_FONT_SCALE;
  let rowIndex = 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, maxHeight: windowHeight * 0.85, paddingBottom: Math.max(insets.bottom, space[5]) },
            elevation.sheet,
            sheetStyle,
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={styles.header}>
            <Text variant="title" accessibilityRole="header">
              Your leagues
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={11} style={styles.close}>
              <Ionicons name="close" size={22} color={colors.text2} />
            </Pressable>
          </View>

          <GestureDetector gesture={native}>
            <Animated.ScrollView
              onScroll={onScroll}
              scrollEventThrottle={16}
              bounces={false}
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
            >
              {groups.map((group) => (
                <View key={group.key} style={styles.group}>
                  <Text variant="tag" tone="secondary" accessibilityRole="header">
                    {group.title}
                  </Text>
                  {group.leagues.map((league, i) => {
                    const index = rowIndex++;
                    const entering = reduced
                      ? undefined
                      : FadeInDown.delay(Math.min(index, STAGGER_MAX) * STAGGER_MS)
                          .springify()
                          .damping(spring.snappy.damping ?? 26)
                          .stiffness(spring.snappy.stiffness ?? 320)
                          .reduceMotion(ReduceMotion.System);
                    return (
                      <Animated.View key={league.id} entering={entering}>
                        <LeagueSheetRow
                          league={league}
                          selected={league.id === activeLeagueId}
                          first={i === 0}
                          onPick={onPick}
                        />
                      </Animated.View>
                    );
                  })}
                </View>
              ))}
            </Animated.ScrollView>
          </GestureDetector>

          <View style={[styles.actions, stacked ? styles.actionsStacked : null]}>
            <View style={stacked ? null : styles.action}>
              <Button label="Create league" onPress={onCreate} fullWidth />
            </View>
            <View style={stacked ? null : styles.action}>
              <Button label="Join with code" variant="secondary" onPress={onJoin} fullWidth />
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: radius.pill,
    marginTop: space[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[6],
    paddingTop: space[4],
    paddingBottom: space[3],
  },
  close: {
    minWidth: 22,
    minHeight: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: space[6],
    gap: space[5],
    paddingBottom: space[5],
  },
  group: {
    gap: space[1],
  },
  actions: {
    flexDirection: 'row',
    gap: space[4],
    paddingHorizontal: space[6],
    paddingTop: space[3],
  },
  actionsStacked: {
    flexDirection: 'column',
  },
  action: {
    flex: 1,
  },
});
