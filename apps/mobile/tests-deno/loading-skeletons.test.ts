/**
 * Loading states (3c-2, UX rule 9): the draft room and Home show their shape
 * while loading instead of an empty body; the skeleton is themed and holds still
 * under Reduce Motion. Source guards (RN components). Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('the draft room: a skeleton while loading; a loaded room with no order still draws nothing', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assertEquals(room.includes("if (room.status === 'loading') return <DraftRoomSkeleton />;"), true);
  assertEquals(room.includes("if (m === 0) return null;"), true);
  assertEquals(room.includes("if (room.status === 'loading' || m === 0) return null;"), false);
});

Deno.test('Home: a skeleton while loading, not null', () => {
  const home = SOURCES['app/(tabs)/index.tsx'];
  assertEquals(home.includes('return <HomeSkeleton />;'), true);
});

Deno.test('the skeletons are placeholders only, one busy "Loading" element each', () => {
  const s = SOURCES['components/game/LoadingSkeletons.tsx'];
  assertEquals((s.match(/accessibilityLabel=\{LOADING\} accessibilityState=\{\{ busy: true \}\}/g) ?? []).length, 2);
  assertEquals(/\$\d|\d+\.\d\d/.test(s.replace(/height=\{\d+\}|width=\{\d+\}/g, '')), false); // no numbers shown
});

Deno.test('the Skeleton block reads the theme and holds still under Reduce Motion', () => {
  const s = SOURCES['components/Skeleton.tsx'];
  assertEquals(s.includes('backgroundColor: colors.border'), true);
  assertEquals(s.includes('if (reduced) {'), true);
});
