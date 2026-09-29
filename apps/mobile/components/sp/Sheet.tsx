/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Dimensions, Modal, PanResponder, StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { radius, space } from '@/constants/tokens';
import { useMotion } from '@/components/sp/motion';
import { useTheme } from '@/components/sp/ThemeProvider';

// Stockpile — <Sheet> (Phase 2 foundation). SOURCE OF TRUTH: §4 ("Sheets:
// spring up, dim behind — spring.snappy") and the Phase 2 brief's explicit
// constraint: built on RN's own Modal + Reanimated + the built-in
// PanResponder — NOT react-native-gesture-handler or any other native
// module, since it isn't installed and a new native module would force a
// new app binary instead of shipping over-the-air.

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.8;

export function Sheet({ visible, onClose, children }: SheetProps) {
  const { colors, elevation } = useTheme();
  const [mounted, setMounted] = useState(visible);
  const screenHeight = Dimensions.get('window').height;
  const translateY = useSharedValue(screenHeight);
  const backdropOpacity = useSharedValue(0);
  const { spring, duration, withSpring, withTiming } = useMotion();

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = withSpring(0, spring.snappy);
      backdropOpacity.value = withTiming(1, { duration: duration.base, reduceMotion: ReduceMotion.System });
    } else if (mounted) {
      translateY.value = withSpring(screenHeight, spring.snappy, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
      backdropOpacity.value = withTiming(0, { duration: duration.quick, reduceMotion: ReduceMotion.System });
    }
    // mounted deliberately excluded: it's the effect's OWN state, re-running
    // on it would fight the close animation it just started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dy > 0) translateY.value = gesture.dy;
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
          onClose();
        } else {
          translateY.value = withSpring(0, spring.snappy);
        }
      },
    })
  ).current;

  const sheetAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropAnimatedStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  if (!mounted) return null;

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        <Animated.View style={[styles.backdrop, { backgroundColor: colors.scrim }, backdropAnimatedStyle]} onTouchEnd={onClose} />
        <Animated.View style={[styles.sheet, { backgroundColor: colors.surface }, elevation.sheet, sheetAnimatedStyle]}>
          <View {...panResponder.panHandlers} style={styles.handleArea}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: space[8],
    maxHeight: '90%',
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: space[3],
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
});
