/**
 * Giorgio, 2026-10-12, on 1.2.0: "section bubbles are touching". HomeBody returns a
 * fragment, so Home's sections are children of HomeLeagueTransition's Animated.View,
 * not of the scroll container. A gap on BarsRefresh's contentContainerStyle spaced
 * only that one wrapper; the sections sat flush. The wrapper must carry the gap.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

const home = SOURCES['app/(tabs)/index.tsx'];
const wrapper = SOURCES['components/home/HomeLeagueTransition.tsx'];

Deno.test('Home passes its section gap to the wrapper that actually holds the sections', () => {
  // A calm Home (2026-10-12): 24pt between blocks (space[7]; was space[6], 20pt).
  assertEquals(/<HomeLeagueTransition key=\{activeLeagueId \?\? 'none'\} style=\{\{ gap: space\[7\] \}\}>/.test(home), true);
});

Deno.test('the block gap is 24pt', async () => {
  const { space } = await import('../constants/tokens/space.ts');
  assertEquals(space[7], 24);
});

Deno.test('the wrapper applies the caller style to the Animated.View that contains the sections', () => {
  assertEquals(wrapper.includes('style: containerStyle'), true);
  assertEquals(wrapper.includes('<Animated.View style={[containerStyle, style]}>'), true);
});
