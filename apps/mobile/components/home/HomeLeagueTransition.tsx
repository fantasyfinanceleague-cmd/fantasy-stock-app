import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { useMotion } from '@/components/sp/motion';

// Stockpile — <HomeLeagueTransition> (Phase 3b-2, H5). Wraps the whole
// Home body (hero through standings); the CALLER re-mounts this by keying
// it with `leagueId` (React remounts on a key change), so a league switch
// destroys and recreates every child in one commit — RollingMoney's own
// diff-against-previous-text state, TugBar's ratio comparison, and
// SeasonChart's currentKey redraw all reset fresh, so a different
// league's numbers can never read as a "change" from the old league's.
// This component's OWN mount-triggered fade covers the resulting instant
// swap with a `quick` opacity crossfade instead of a hard cut. Reduce
// Motion: instant, no fade.
//
// Blocking 1 (Design Lead, code review 2026-09-29): without this, a
// switch between two LIVE leagues rolled league A's digits into league
// B's, sprang the tug from A's ratio to B's, and morphed A's chart path
// into B's — each presenting a different league's numbers as a live
// update. Children still need their OWN `skipEntrance` prop (see
// HomeHero/SeasonChart/StandingsCard) so their FIRST-open entrance
// animations don't replay on every switch this remount causes.

// The wrapper IS the container of Home's sections (HomeBody returns a fragment),
// so the caller's section spacing must be passed here via `style`. A gap set on
// the scroll container only spaces ITS children, and this wrapper is its only
// child: with the gap there, every section sat flush (1.2.0, Giorgio 2026-10-12).
export function HomeLeagueTransition({ children, style: containerStyle }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { reduced, duration, easing, withTiming } = useMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withTiming(1, { duration: duration.quick, easing: easing.settle });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; the caller re-mounts this via `key` on a league change.
  }, []);

  const style = useAnimatedStyle(() => ({ opacity: progress.value }));

  return <Animated.View style={[containerStyle, style]}>{children}</Animated.View>;
}
