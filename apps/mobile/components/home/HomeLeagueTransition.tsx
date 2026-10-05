import { useEffect, type ReactNode } from 'react';
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

export function HomeLeagueTransition({ children }: { children: ReactNode }) {
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

  return <Animated.View style={style}>{children}</Animated.View>;
}
