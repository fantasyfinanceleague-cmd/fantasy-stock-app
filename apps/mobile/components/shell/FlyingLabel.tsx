/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/sp/Text';
import { useMotion } from '@/components/sp/motion';

// Phase 3b-1 — S3's flying league name (see ShellOverlay for the whole
// choreography). Starts exactly over the sheet row's label and springs
// (spring.snappy, no overshoot) onto the header pill's label, scaling from
// the row's text height to the pill's. Only ever mounted with full motion:
// ShellOverlay swaps the label in place instead under Reduce Motion.

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlyingLabelProps {
  label: string;
  from: Frame;
  to: Frame;
  /** Called when the spring settles on the pill (the pill label fades back in). */
  onLanded: () => void;
  /** Called once the flyer has faded out and can unmount. */
  onDone: () => void;
}

export function FlyingLabel({ label, from, to, onLanded, onDone }: FlyingLabelProps) {
  const { spring, duration, withSpring } = useMotion();
  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    progress.value = withSpring(1, spring.snappy, (finished) => {
      if (!finished) return;
      runOnJS(onLanded)();
      opacity.value = withTiming(0, { duration: duration.quick }, (done) => {
        if (done) runOnJS(onDone)();
      });
    });
    // One flight per mount (ShellOverlay keys each flight).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scaleTo = from.height > 0 ? to.height / from.height : 1;

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: opacity.value,
      transform: [
        { translateX: (to.x - from.x) * p },
        { translateY: (to.y - from.y) * p },
        { scale: 1 + (scaleTo - 1) * p },
      ],
    };
  });

  return (
    <Animated.View
      style={[styles.flyer, { left: from.x, top: from.y, width: Math.max(from.width, to.width) }, style]}
    >
      <Text variant="headline" numberOfLines={1}>
        {label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flyer: {
    position: 'absolute',
    transformOrigin: 'left top',
  },
});
