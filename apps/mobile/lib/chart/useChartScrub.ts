/**
 * useChartScrub: the scrub gesture, shared by Home's SeasonChart and 3e's
 * stock chart (M2) — a long-press-then-drag Pan that hit-tests the nearest
 * point (chartGeometry.nearestPointIndex) and fires one light haptic per
 * index change, never under Reduce Motion. "Real bars only" (M2's spec) is
 * guaranteed by construction: a scrub can only land on an index the caller's
 * own `points` array has — nothing here interpolates between bars.
 */
import { useRef, useState } from 'react';
import { runOnJS } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';

import { nearestPointIndex, type ChartGeometry } from './chartGeometry';

export interface UseChartScrubResult {
  scrubIndex: number | null;
  pan: ReturnType<typeof Gesture.Pan>;
  /** Sets the scrub index directly — VoiceOver's adjustable action (M2's
   * accessibility requirement) moves it this way, one point at a time,
   * rather than via the drag gesture. */
  setScrubIndex: (index: number | null) => void;
}

export function useChartScrub(
  geometry: ChartGeometry | null,
  reduced: boolean,
  onIndexChange?: (index: number | null) => void,
): UseChartScrubResult {
  const [scrubIndex, setScrubIndexState] = useState<number | null>(null);
  const lastHapticIndex = useRef<number | null>(null);

  function updateScrub(x: number) {
    if (!geometry) return;
    const idx = nearestPointIndex(geometry.points, x);
    if (idx !== scrubIndex) {
      setScrubIndexState(idx);
      onIndexChange?.(idx);
      if (!reduced && idx !== lastHapticIndex.current) {
        Haptics.selectionAsync().catch(() => {});
      }
      lastHapticIndex.current = idx;
    }
  }

  function endScrub() {
    setScrubIndexState(null);
    onIndexChange?.(null);
    lastHapticIndex.current = null;
  }

  // Reanimated auto-workletizes these callbacks and runs them on the UI
  // thread; updateScrub/endScrub call setState and Haptics, plain JS that
  // must run on the JS thread (found in code review, 2026-09-29, as a likely
  // crash on the first long-press). runOnJS is what LeagueSheet.tsx /
  // OnboardingPager.tsx already use for the same reason.
  const pan = Gesture.Pan()
    .activateAfterLongPress(120)
    .onUpdate((e) => runOnJS(updateScrub)(e.x))
    .onEnd(() => runOnJS(endScrub)())
    .onFinalize(() => runOnJS(endScrub)());

  function setScrubIndex(index: number | null) {
    setScrubIndexState(index);
    onIndexChange?.(index);
    lastHapticIndex.current = index;
  }

  return { scrubIndex, pan, setScrubIndex };
}
