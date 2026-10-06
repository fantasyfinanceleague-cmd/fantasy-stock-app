/**
 * 3f cleanup: dev and template routes in a RELEASE build. The route table is
 * expo-router's, so these are structural checks over the two files that decide
 * it (the behavioural proof is the no-dev bundle check in
 * docs/design/1.2.0-release-route-check.md):
 *   - app/modal.tsx (the Expo template) is gone, and so is its Stack.Screen;
 *   - design-gallery's Stack.Screen exists ONLY inside a `__DEV__ ?` branch;
 *   - design-gallery itself still redirects Home when !__DEV__.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import layout from '../app/_layout.tsx' with { type: 'text' };
import gallery from '../app/design-gallery.tsx' with { type: 'text' };

Deno.test('the Expo template modal route is not declared', () => {
  assertEquals(/name="modal"/.test(layout), false);
  assertEquals(layout.includes('WITH_HEADER_MODAL'), false);
});

Deno.test('design-gallery has exactly one Stack.Screen, inside the __DEV__-only array', () => {
  const decl = layout.match(/name="design-gallery"/g) ?? [];
  assertEquals(decl.length, 1);
  const at = layout.indexOf('name="design-gallery"');
  const devArray = layout.indexOf('const DEV_ONLY_SCREENS = __DEV__');
  assertEquals(devArray > -1 && devArray < at, true);
  // ...and it is the array (empty in a release) that the Stack renders, not a bare child.
  assertEquals(layout.includes('{DEV_ONLY_SCREENS}'), true);
  assertEquals(/<Stack\.Screen[^>]*name="design-gallery"[^>]*\/>\s*\n\s*<Stack\.Screen/.test(layout), false);
});

Deno.test('design-gallery still redirects Home outside __DEV__', () => {
  assertEquals(/if \(!__DEV__\) \{\s*return <Redirect href="\/" \/>;\s*\}/.test(gallery), true);
});
