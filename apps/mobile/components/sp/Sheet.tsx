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
  /** False locks every dismiss path (swipe, backdrop, Android back): used while a trade submit is in flight. */
  dismissible?: boolean;
  /** Renders on top of the backdrop AND the sheet, inside the same Modal (a
   * separate overlay outside this Modal would render in the wrong native
   * window and never visually align). M1's flying row->header tile uses this. */
  overlay?: ReactNode;
  /** The sheet's own rendered height, reported once laid out (content-driven,
   * so it isn't known up front) -- M1 uses it to compute the header's resting
   * screen position without waiting for the rise animation to finish. */
  onSheetLayout?: (height: number) => void;
}

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.8;
/** The grab-handle row's rendered height (paddingVertical * 2 + the handle's own
 * height) — every sheet's content starts this far below the sheet's own top edge.
 * M1 uses it to place the header's resting rect without an extra measurement. */
export const SHEET_HANDLE_AREA_HEIGHT = space[3] * 2 + 4;

export function Sheet({ visible, onClose, children, dismissible = true, overlay, onSheetLayout }: SheetProps) {
  const { colors, elevation } = useTheme();
  const [mounted, setMounted] = useState(visible);
  const screenHeight = Dimensions.get('window').height;
  const translateY = useSharedValue(screenHeight);
  const backdropOpacity = useSharedValue(0);
  const { spring, duration, easing, withSpring, withTiming, reduced } = useMotion();
  // Reduce Motion (M1's spec): the sheet fades in place instead of sliding up.
  const sheetOpacity = useSharedValue(reduced ? 0 : 1);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (reduced) {
        translateY.value = 0;
        sheetOpacity.value = withTiming(1, { duration: duration.base });
      } else {
        translateY.value = withSpring(0, spring.snappy);
      }
      backdropOpacity.value = withTiming(1, { duration: duration.base, reduceMotion: ReduceMotion.System });
    } else if (mounted) {
      if (reduced) {
        sheetOpacity.value = withTiming(0, { duration: duration.quick }, (finished) => {
          if (finished) runOnJS(setMounted)(false);
        });
      } else {
        // §4's exit rule: dismiss is FASTER than open — `quick` + `ease.exit`,
        // not the same rise spring played backwards.
        translateY.value = withTiming(screenHeight, { duration: duration.quick, easing: easing.exit }, (finished) => {
          if (finished) runOnJS(setMounted)(false);
        });
      }
      backdropOpacity.value = withTiming(0, { duration: duration.quick, reduceMotion: ReduceMotion.System });
    }
    // mounted deliberately excluded: it's the effect's OWN state, re-running
    // on it would fight the close animation it just started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // The pan responder is created once, so it reads the latest value through a ref.
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  const dismiss = () => {
    if (dismissibleRef.current) onClose();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dy > 0) translateY.value = gesture.dy;
      },
      onPanResponderRelease: (_evt, gesture) => {
        if ((gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) && dismissibleRef.current) {
          onClose();
        } else {
          translateY.value = withSpring(0, spring.snappy);
        }
      },
    })
  ).current;

  const sheetAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }], opacity: sheetOpacity.value }));
  const backdropAnimatedStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  if (!mounted) return null;

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <View style={styles.container}>
        <Animated.View style={[styles.backdrop, { backgroundColor: colors.scrim }, backdropAnimatedStyle]} onTouchEnd={dismiss} />
        <Animated.View
          style={[styles.sheet, { backgroundColor: colors.surface }, elevation.sheet, sheetAnimatedStyle]}
          onLayout={onSheetLayout ? (e) => onSheetLayout(e.nativeEvent.layout.height) : undefined}
        >
          <View {...panResponder.panHandlers} style={styles.handleArea}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>
          {children}
        </Animated.View>
        {overlay}
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
