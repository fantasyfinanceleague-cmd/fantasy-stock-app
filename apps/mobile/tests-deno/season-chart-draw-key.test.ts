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
  const chart = SOURCES['components/home/SeasonChart.tsx'];
  assert(chart.includes('key: drawKey,'));
  assert(!chart.includes("key: series.join(',')"));
  assert(SOURCES['components/home/SeasonCard.tsx'].includes('drawKey={window}'));
  // Why the key matters: useDrawIn restarts from 0 whenever its key changes.
  const hook = SOURCES['lib/chart/useDrawIn.ts'];
  assert(hook.includes('setProgress(0);'));
  assert(hook.includes('}, [key, reduced, lineLength > 0]);'));
  // Once drawn, the path is the full line for whatever the values are now.
  assert(chart.includes('d={drawProgress >= 1 ? geometry.linePath : partialLinePath(geometry.points, drawProgress, lineLength)}'));
  // The league switch still remounts (and skips the entrance), as Home's H5 ruled.
  assert(SOURCES['app/(tabs)/index.tsx'].includes("<HomeLeagueTransition key={activeLeagueId ?? 'none'}>"));
});
