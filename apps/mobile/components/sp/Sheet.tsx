/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Modal, PanResponder, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { radius, space } from '@/constants/tokens';
import { clearOf } from '@/constants/tokens/color';
import { scrollsFurther, type ScrollMetrics } from '@/components/sp/logic/sheetScroll';
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
  /** Called once the sheet has finished leaving and its Modal is gone. iOS can't present a
   * second Modal while one is still dismissing, so a sheet that hands off to another sheet
   * (the player card's Sell → the stock sheet) opens the next one from here. */
  onClosed?: () => void;
}

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.8;
/** The grab-handle row's rendered height (paddingVertical * 2 + the handle's own
 * height) — every sheet's content starts this far below the sheet's own top edge.
 * M1 uses it to place the header's resting rect without an extra measurement. */
/** A footer's text (a link such as Set later, an error line, a caption) never outgrows the footer's
 * Button label: the label is `headline`, capped at 1.6 (constants/tokens/type.ts), so footer text is capped at the same
 * multiplier. Callout, body and caption carry no cap of their own, so uncapped they grew past the button at XXXL. */
export const SHEET_FOOTER_MAX_SCALE = 1.6;
/** The soft bottom edge's height, and the pinned footer's own surface under it. */
export const SHEET_FADE_HEIGHT = 24;
export const SHEET_HANDLE_AREA_HEIGHT = space[3] * 2 + 4;

export interface SheetBodyProps {
  /** The content: it scrolls when the sheet would be taller than its 90% ceiling. */
  children: ReactNode;
  /** The primary action (and the reason line a disabled one carries): pinned under the scroll, on
   * the sheet's own surface. No rule line above it (§9C): the content just scrolls under it. */
  footer?: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  footerStyle?: StyleProp<ViewStyle>;
}

/** A sheet's layout: a scrolling body and a pinned footer. At Large the sheet is content-sized, so
 * the footer sits exactly where the action sat inline; at XXXL Dynamic Type the sheet reaches its
 * 90% ceiling and only the body scrolls, so the action can never fall below the fold. Put this as
 * the sheet's only child; the wrapper shrinks (flexShrink 1, minHeight 0) inside the sheet's maxHeight. */
export function SheetBody({ children, footer, contentContainerStyle, footerStyle }: SheetBodyProps) {
  const { colors } = useTheme();
  // The soft bottom edge: shown only while the content can still scroll further down. The metrics
  // live in a ref and state flips only when the answer changes, so scrolling does not re-render.
  const metrics = useRef<ScrollMetrics>({ content: 0, layout: 0, offset: 0 });
  const [fade, setFade] = useState(false);
  const refresh = useCallback(() => {
    const next = scrollsFurther(metrics.current);
    setFade((prev) => (prev === next ? prev : next));
  }, []);
  return (
    <View style={styles.bodyShell}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={contentContainerStyle}
        alwaysBounceVertical={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onLayout={(e: LayoutChangeEvent) => {
          metrics.current.layout = e.nativeEvent.layout.height;
          refresh();
        }}
        onContentSizeChange={(_w: number, h: number) => {
          metrics.current.content = h;
          refresh();
        }}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          metrics.current.offset = e.nativeEvent.contentOffset.y;
          refresh();
        }}
        testID="sheet-scroll"
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={footerStyle} testID="sheet-footer">
          {fade ? (
            // Sits just above the footer's top edge, over the scroll's last lines: the surface at alpha 0 into
            // the surface (never the `transparent` keyword, which is black at 0: a grey fade).
            <LinearGradient
              colors={[clearOf(colors.surface), colors.surface]}
              style={styles.fade}
              pointerEvents="none"
              testID="sheet-scroll-fade"
            />
          ) : null}
          {footer}
        </View>
      ) : null}
    </View>
  );
}

export function Sheet({ visible, onClose, children, dismissible = true, overlay, onSheetLayout, onClosed }: SheetProps) {
  const { colors, elevation } = useTheme();
  const [mounted, setMounted] = useState(visible);
  const screenHeight = Dimensions.get('window').height;
  const translateY = useSharedValue(screenHeight);
  const backdropOpacity = useSharedValue(0);
  const { spring, duration, easing, withSpring, withTiming, reduced } = useMotion();
  // Reduce Motion (M1's spec): the sheet fades in place instead of sliding up.
  const sheetOpacity = useSharedValue(reduced ? 0 : 1);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const finishClose = () => {
    setMounted(false);
    onClosedRef.current?.();
  };

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
          if (finished) runOnJS(finishClose)();
        });
      } else {
        // §4's exit rule: dismiss is FASTER than open — `quick` + `ease.exit`,
        // not the same rise spring played backwards.
        translateY.value = withTiming(screenHeight, { duration: duration.quick, easing: easing.exit }, (finished) => {
          if (finished) runOnJS(finishClose)();
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
  // The body shell shrinks inside the sheet's maxHeight; the footer (flexShrink 0) keeps its height.
  bodyShell: {
    flexShrink: 1,
    minHeight: 0,
  },
  scroll: {
    flexShrink: 1,
    flexGrow: 0,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    height: SHEET_FADE_HEIGHT,
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
