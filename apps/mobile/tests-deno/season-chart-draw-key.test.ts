/**
 * UX final sweep S-5 (§4: charts update in place). Home's season chart drew in keyed on
 * series.join(','), and useDrawIn restarts from 0 on every key change, so any change to
 * any value redrew the line from nothing. In market hours the 30 s poll moves today's
 * point, so the chart blanked and redrew every 30 s. It now draws in once per league
 * (Home remounts per league) and per window; a value change updates the path in place.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('the draw-in is keyed on the window, never on the series values (source guards)', () => {
  // W4: Home's line is the gn <Chart>, which keys useDrawIn on its `drawKey` prop.
  const chart = SOURCES['components/home/SeasonChart.tsx'];
  const gn = SOURCES['components/sp/gn/Chart.tsx'];
  assert(gn.includes('useDrawIn({ key: drawKey, lineLength: geometry.length, reduced, durationMs: duration.feature, skipFirst: skipEntrance })'));
  assert(chart.includes('drawKey={drawKey}') && chart.includes('skipEntrance={skipEntrance}'));
  assert(!chart.includes("series.join(',')") && !gn.includes(".join(',')"));
  // A calm Home: the chart lives in the hero block (HomeSeason), not the old Season card.
  assert(SOURCES['components/home/HomeSeason.tsx'].includes('drawKey={window}'));
  // Why the key matters: useDrawIn restarts from 0 whenever its key changes.
  const hook = SOURCES['lib/chart/useDrawIn.ts'];
  assert(hook.includes('setProgress(0);'));
  assert(hook.includes('}, [key, reduced, lineLength > 0]);'));
  // Once drawn, the path is the full line for whatever the values are now.
  assert(gn.includes('const path = progress >= 1 || geometry.length === 0 ? geometry.path : partialLinePath(geometry.points, progress, geometry.length);'));
  // The league switch still remounts (and skips the entrance), as Home's H5 ruled.
  assert(SOURCES['app/(tabs)/index.tsx'].includes("<HomeLeagueTransition key={activeLeagueId ?? 'none'}"));
});
