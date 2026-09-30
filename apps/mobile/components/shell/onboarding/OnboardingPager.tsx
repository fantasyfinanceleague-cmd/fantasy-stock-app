/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ComponentType, useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  interpolateColor,
  runOnJS,
  scrollTo,
  SharedValue,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { ONBOARDING_CARDS } from '@/components/shell/onboarding/sampleData';
import { FinalVignette, RosterVignette, VersusVignette, type VignetteProps } from '@/components/shell/onboarding/Vignettes';

// Phase 3b-1 — Onboarding ×3 (spec row 6, S1). Giorgio's three lines,
// verbatim; skippable; shown once (the caller stores that).
//
// Full motion: a paging scroll. Cards slide + fade (`slow`, settle, for
// [Next]); decorative backdrop shapes move at 0.2× and 0.6× of the card —
// parallax on decoration only, never on data (§4); the dots stretch with
// the scroll. Each vignette plays once when its card settles.
// Reduce Motion: one card at a time that crossfades (`quick`) on [Next] or
// a swipe; no parallax; vignettes show their final frame.

const VIGNETTES: ComponentType<VignetteProps>[] = [RosterVignette, VersusVignette, FinalVignette];
const LAST = ONBOARDING_CARDS.length - 1;
const ART_HEIGHT = 340;

export interface OnboardingPagerProps {
  /** [Get started] on the last card. */
  onFinish: () => void;
  /** "Skip" — jumps to the same destination. */
  onSkip: () => void;
}

export function OnboardingPager({ onFinish, onSkip }: OnboardingPagerProps) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, space[5]) }]}>
      <View style={styles.header}>
        <Pressable onPress={onSkip} accessibilityRole="button" hitSlop={10} style={styles.skip}>
          <Text variant="body" tone="secondary">
            Skip
          </Text>
        </Pressable>
      </View>
      {reduced ? (
        <CrossfadePager index={index} setIndex={setIndex} onFinish={onFinish} />
      ) : (
        <SlidingPager index={index} setIndex={setIndex} onFinish={onFinish} />
      )}
    </View>
  );
}

interface PagerProps {
  index: number;
  setIndex: (i: number) => void;
  onFinish: () => void;
}

// ── Full motion ──────────────────────────────────────────────────────────

function SlidingPager({ index, setIndex, onFinish }: PagerProps) {
  const { width } = useWindowDimensions();
  const { duration, easing } = useMotion();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollX = useSharedValue(0);
  const driven = useSharedValue(-1); // -1 = the user is in control

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  // [Next] drives the scroll on the UI thread so it runs at the `slow` token.
  useAnimatedReaction(
    () => driven.value,
    (x) => {
      if (x >= 0) scrollTo(scrollRef, x, 0, false);
    }
  );

  const settle = (i: number) => setIndex(i);

  const next = () => {
    if (index >= LAST) {
      onFinish();
      return;
    }
    const target = (index + 1) * width;
    driven.value = scrollX.value;
    driven.value = withTiming(target, { duration: duration.slow, easing: easing.settle }, (done) => {
      if (!done) return;
      driven.value = -1;
      runOnJS(settle)(index + 1);
    });
  };

  return (
    <>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => settle(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={styles.pager}
      >
        {ONBOARDING_CARDS.map((line, i) => (
          <SlidingCard key={line} index={i} width={width} scrollX={scrollX} line={line} active={i === index} />
        ))}
      </Animated.ScrollView>
      <Footer index={index} progress={scrollX} width={width} onNext={next} />
    </>
  );
}

function SlidingCard({ index, width, scrollX, line, active }: { index: number; width: number; scrollX: SharedValue<number>; line: string; active: boolean }) {
  const Vignette = VIGNETTES[index];
  const { colors } = useTheme();

  // Distance of this card from centre, in cards (−1 … 1).
  const fadeStyle = useAnimatedStyle(() => {
    const d = (scrollX.value - index * width) / width;
    return { opacity: interpolate(Math.abs(d), [0, 1], [1, 0.35], 'clamp') };
  });
  // Decorative layers lag the card: 0.2× and 0.6× of its movement.
  const far = useAnimatedStyle(() => ({ transform: [{ translateX: (scrollX.value - index * width) * 0.8 }] }));
  const near = useAnimatedStyle(() => ({ transform: [{ translateX: (scrollX.value - index * width) * 0.4 }] }));

  return (
    <Animated.View style={[styles.card, { width }, fadeStyle]} accessibilityLabel={`Card ${index + 1} of ${ONBOARDING_CARDS.length}`}>
      <View style={[styles.art, { backgroundColor: colors.inset }]}>
        <Animated.View pointerEvents="none" style={[styles.decoFar, { backgroundColor: colors.accentWash }, far]} />
        <Animated.View pointerEvents="none" style={[styles.decoNear, { borderColor: colors.line }, near]} />
        <Vignette active={active} />
      </View>
      <Text variant="score.lg" numberOfLines={3} style={styles.line}>
        {line}
      </Text>
    </Animated.View>
  );
}

// ── Reduce Motion ────────────────────────────────────────────────────────

function CrossfadePager({ index, setIndex, onFinish }: PagerProps) {
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const { duration } = useMotion();
  const opacity = useSharedValue(1);
  const dots = useSharedValue(index * width);
  useEffect(() => {
    dots.value = index * width; // the dots jump under Reduce Motion
  }, [index, width, dots]);

  const go = (i: number) => {
    if (i < 0) return;
    if (i > LAST) {
      onFinish();
      return;
    }
    opacity.value = 0;
    setIndex(i);
    opacity.value = withTiming(1, { duration: duration.quick });
  };

  const swipe = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .onEnd((e) => {
      if (e.translationX < -40) runOnJS(go)(index + 1);
      else if (e.translationX > 40) runOnJS(go)(index - 1);
    });

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const Vignette = VIGNETTES[index];

  return (
    <>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[styles.pager, styles.card, { width }, fade]} accessibilityLabel={`Card ${index + 1} of ${ONBOARDING_CARDS.length}`}>
          <View style={[styles.art, { backgroundColor: colors.inset }]}>
            <Vignette active />
          </View>
          <Text variant="score.lg" numberOfLines={3} style={styles.line}>
            {ONBOARDING_CARDS[index]}
          </Text>
        </Animated.View>
      </GestureDetector>
      <Footer index={index} progress={dots} width={width} onNext={() => go(index + 1)} />
    </>
  );
}

// ── Dots + primary action ────────────────────────────────────────────────

function Footer({ index, progress, width, onNext }: { index: number; progress: SharedValue<number>; width: number; onNext: () => void }) {
  return (
    <View style={styles.footer}>
      <View style={styles.dots} accessible accessibilityLabel={`Card ${index + 1} of ${ONBOARDING_CARDS.length}`}>
        {ONBOARDING_CARDS.map((line, i) => (
          <Dot key={line} index={i} progress={progress} width={width} />
        ))}
      </View>
      <Button label={index >= LAST ? 'Get started' : 'Next'} onPress={onNext} />
    </View>
  );
}

function Dot({ index, progress, width }: { index: number; progress: SharedValue<number>; width: number }) {
  const { colors } = useTheme();
  const style = useAnimatedStyle(() => {
    const closeness = Math.max(0, 1 - Math.abs(progress.value / width - index));
    return {
      width: 6 + 16 * closeness,
      backgroundColor: interpolateColor(closeness, [0, 1], [colors.line, colors.text]),
    };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: space[5],
    minHeight: 44,
    alignItems: 'center',
  },
  skip: {
    minHeight: 44,
    justifyContent: 'center',
  },
  pager: {
    flex: 1,
  },
  card: {
    paddingHorizontal: space[6],
    paddingTop: space[5],
    gap: space[7],
  },
  art: {
    height: ART_HEIGHT,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[6],
    overflow: 'hidden',
  },
  decoFar: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    top: -90,
    right: -120,
  },
  decoNear: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 18,
    bottom: -70,
    left: -60,
  },
  line: {
    lineHeight: 42,
  },
  footer: {
    paddingHorizontal: space[6],
    gap: space[6],
  },
  dots: {
    flexDirection: 'row',
    gap: space[2] + 2,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
});
