import { useEffect, type ReactNode } from 'react';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { useMotion } from '@/components/sp/motion';

// Stockpile — <PhaseTransition> (Phase 3b-2, H6). Wraps whichever card
// Home is showing for the current phase; the CALLER re-mounts this by
// keying it with `phase.kind` (React remounts on a key change), so this
// component's own mount-triggered fade+rise runs again on every phase
// change — "a phase change swaps the card in with a crossfade and 8px
// rise." Reduce Motion: a plain crossfade, no rise.

export function PhaseTransition({ children }: { children: ReactNode }) {
  const { reduced, duration, easing, withTiming } = useMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: reduced ? duration.quick : duration.base, easing: easing.settle });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; the caller re-mounts this via `key` on a phase change.
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduced ? [] : [{ translateY: (1 - progress.value) * 8 }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}
