import { useEffect } from 'react';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';

import { useMotion } from '@/components/sp/motion';

// Phase 3b-1 — the four tab icons, ported path-for-path from the board
// (docs/design/screens/screens.jsx ICON.home/matchup/league/portfolio).
// The board's "filled" active state is a heavier stroke on the same outline
// (1.8 → 2.4), not a second glyph, so the change can animate instead of
// swapping — that stroke tween is half of S2's icon micro-animation (the
// other half, the scale bump, lives in ShellTabBar).

export type TabIconName = 'home' | 'matchup' | 'league' | 'portfolio';

const PATHS: Record<TabIconName, string> = {
  home: 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  matchup: 'M4 17 9 11l4 4 7-8M15 7h5v5',
  league: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  portfolio: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
};

const STROKE_IDLE = 1.8;
const STROKE_ACTIVE = 2.4;

const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface TabIconProps {
  name: TabIconName;
  color: string;
  focused: boolean;
  size?: number;
}

export function TabIcon({ name, color, focused, size = 26 }: TabIconProps) {
  const { reduced, duration, easing } = useMotion();
  const stroke = useSharedValue(focused ? STROKE_ACTIVE : STROKE_IDLE);

  useEffect(() => {
    const target = focused ? STROKE_ACTIVE : STROKE_IDLE;
    stroke.value = reduced ? target : withTiming(target, { duration: duration.quick, easing: easing.settle });
  }, [focused, reduced, duration.quick, easing.settle, stroke]);

  const animatedProps = useAnimatedProps(() => ({ strokeWidth: stroke.value }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedPath
        d={PATHS[name]}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
