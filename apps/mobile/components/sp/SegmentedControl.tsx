/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { radius, space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { segmentHitSlop, segmentWidthFor } from './logic/segmentedHit';

// Stockpile — <SegmentedControl> (Phase 2 foundation). Used for "All
// matchups this week" (Matchup tab) and similar in-screen filters. The
// sliding indicator is a `base`-duration `settle` move (§4: "Small state
// changes" -> `quick`; this is a position change on press, so it uses
// `quick` to feel immediate).

export interface SegmentedOption {
  label: string;
  value: string;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  /** 'pill' (money screens, W4 Portfolio DL gate): the track and the indicator are pills
   * (radius 999), the selected segment stays neutral (`surface` on `sunken`, never an accent
   * fill). The default keeps the §9A rounded rectangle the game screens use. */
  shape?: 'rounded' | 'pill';
}

export function SegmentedControl({ options, value, onChange, shape = 'rounded' }: SegmentedControlProps) {
  const { colors } = useTheme();
  const { duration, easing, withTiming } = useMotion();

  // The track's measured width; each segment's width is derived from the CURRENT option
  // count on every render (segmentWidthFor), so a change in the number of options moves
  // the indicator correctly even though the track's width (and layout) didn't change.
  const [trackWidth, setTrackWidth] = useState(0);
  const segmentWidth = segmentWidthFor(trackWidth, TRACK_PADDING, options.length);
  const translateX = useSharedValue(0);

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    translateX.value = withTiming(selectedIndex * segmentWidth, { duration: duration.quick, easing: easing.settle });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- withTiming/easing are stable per render from useMotion(); re-running on identity would restart the animation every render.
  }, [selectedIndex, segmentWidth]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    width: segmentWidth,
  }));

  const trackColor = colors.sunken;
  const indicatorColor = colors.surface;
  const activeTextColor = colors.text;
  const idleTextColor = colors.text2;

  const [trackHeight, setTrackHeight] = useState(0);
  const hit = segmentHitSlop(trackHeight);

  function handleLayout(event: LayoutChangeEvent) {
    setTrackWidth(event.nativeEvent.layout.width);
    setTrackHeight(event.nativeEvent.layout.height);
  }

  function choose(next: string) {
    if (next === value) return;
    // A light selection haptic when the choice actually changes (§9B).
    void Haptics.selectionAsync().catch(() => {});
    onChange(next);
  }

  return (
    // 8 pt clear above and below, so each segment's hit slop never overlaps
    // another target (§9B). The visual height is unchanged.
    <View accessibilityRole="tablist" style={styles.wrap}>
    <View style={[styles.track, shape === 'pill' ? styles.pill : null, { backgroundColor: trackColor }]} onLayout={handleLayout}>
      {segmentWidth > 0 ? (
        <Animated.View style={[styles.indicator, shape === 'pill' ? styles.pill : null, { backgroundColor: indicatorColor }, indicatorStyle]} />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            hitSlop={hit}
            style={styles.segment}
            onPress={() => choose(option.value)}
          >
            <Text
              variant="callout"
              color={selected ? activeTextColor : idleTextColor}
              numberOfLines={1}
              maxFontSizeMultiplier={LABEL_MAX_SCALE}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
    </View>
  );
}

/** The labels' Dynamic Type ceiling, the tab bar's (ShellTabBar LABEL_MAX_SCALE). Uncapped,
 * every control truncated at XL ("Stan… / Sche…", game-screens gate GS-3), so the League
 * tabs couldn't be told apart at the size that most needs them. adjustsFontSizeToFit is
 * only the safety net for a narrow phone: a label shrinks a little rather than truncate. */
const LABEL_MAX_SCALE = 1.3;

/** The track's inner padding (§9B). The indicator and the segment widths both respect it. */
const TRACK_PADDING = 2;

const styles = StyleSheet.create({
  wrap: { marginVertical: space[2] },
  pill: { borderRadius: radius.pill },
  track: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: TRACK_PADDING,
    position: 'relative',
  },
  segment: {
    flex: 1,
    minWidth: 0,
    paddingVertical: space[3],
    paddingHorizontal: space[1],
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: TRACK_PADDING,
    borderRadius: radius.sm,
  },
});
