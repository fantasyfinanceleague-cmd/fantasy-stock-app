/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
/**
 * MagicMoveTile: M1's flying row->header shared element. A temporary,
 * absolutely-positioned copy of the row's ticker + name, traveling from the
 * row's measured rect to the sheet header's rect on the SAME spring
 * (spring.snappy) the sheet itself rises on, so the two feel like one
 * motion. It hands off to the real header on arrival (onArrived) and
 * unmounts — rendered via Sheet's `overlay` slot, inside the same Modal, or
 * a sibling overlay outside it would paint in the wrong native window.
 *
 * Reduce Motion: no flight. The sheet fades in place (Sheet.tsx); this tile
 * hands off immediately rather than animating a move.
 */
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { interpolateRect, type Rect } from '@/lib/motion/magicMove';

export interface MagicMoveTileProps {
  symbol: string;
  name: string | null;
  fromRect: Rect;
  /** Null until the sheet header has reported its own layout. */
  toRect: Rect | null;
  onArrived: () => void;
}

export function MagicMoveTile({ symbol, name, fromRect, toRect, onArrived }: MagicMoveTileProps) {
  const { colors } = useTheme();
  const { reduced, spring, withSpring } = useMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!toRect) return;
    if (reduced) {
      progress.value = 1;
      onArrived();
      return;
    }
    progress.value = withSpring(1, spring.snappy, (finished) => {
      if (finished) runOnJS(onArrived)();
    });
    // Fires once, the moment the header's rect becomes known -- a single flight per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toRect]);

  const style = useAnimatedStyle(() => {
    const rect = interpolateRect(fromRect, toRect ?? fromRect, progress.value);
    return {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });

  return (
    <Animated.View style={[styles.tile, style, { backgroundColor: colors.surface }]} pointerEvents="none">
      <Text variant="headline" numberOfLines={1}>{symbol}</Text>
      {name ? <Text variant="caption" tone="secondary" numberOfLines={1}>{name}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tile: {
    position: 'absolute',
    justifyContent: 'center',
  },
});
