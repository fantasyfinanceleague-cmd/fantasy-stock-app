/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { radius, space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';

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
}

export function SegmentedControl({ options, value, onChange }: SegmentedControlProps) {
  const { colors } = useTheme();
  const { duration, easing, withTiming } = useMotion();

  const [segmentWidth, setSegmentWidth] = useState(0);
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

  function handleLayout(event: LayoutChangeEvent) {
    setSegmentWidth(event.nativeEvent.layout.width / options.length);
  }

  return (
    <View style={[styles.track, { backgroundColor: trackColor }]} onLayout={handleLayout}>
      {segmentWidth > 0 ? (
        <Animated.View style={[styles.indicator, { backgroundColor: indicatorColor }, indicatorStyle]} />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={styles.segment}
            onPress={() => onChange(option.value)}
          >
            <Text variant="callout" color={selected ? activeTextColor : idleTextColor} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: 2,
    position: 'relative',
  },
  segment: {
    flex: 1,
    paddingVertical: space[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 0,
    borderRadius: radius.sm,
  },
});
