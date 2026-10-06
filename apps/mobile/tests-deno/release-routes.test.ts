/**
 * 3f cleanup: dev and template routes in a RELEASE build. The route table is
 * expo-router's, so these are structural checks over the two files that decide
 * it (the behavioural proof is the --no-dev bundle check in
 * docs/design/1.2.0-release-route-check.md):
 *   - app/modal.tsx (the Expo template) is gone, and so is its Stack.Screen;
 *   - design-gallery's Stack.Screen exists ONLY inside `<Stack.Protected guard={__DEV__}>`,
 *     so a release navigator never registers it;
 *   - design-gallery itself still redirects Home when !__DEV__ (second layer).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import layout from '../app/_layout.tsx' with { type: 'text' };
import gallery from '../app/design-gallery.tsx' with { type: 'text' };

Deno.test('the Expo template modal route is not declared', () => {
  assertEquals(/name="modal"/.test(layout), false);
  assertEquals(layout.includes('WITH_HEADER_MODAL'), false);
});

Deno.test('design-gallery has exactly one Stack.Screen, directly inside a __DEV__ guard', () => {
  assertEquals((layout.match(/name="design-gallery"/g) ?? []).length, 1);
  // The screen's nearest enclosing element is the guard, with nothing between.
  assertEquals(
    /<Stack\.Protected guard=\{__DEV__\}>\s*<Stack\.Screen name="design-gallery"[^>]*\/>\s*<\/Stack\.Protected>/.test(layout),
    true,
  );
});

Deno.test('design-gallery still redirects Home outside __DEV__', () => {
  assertEquals(/if \(!__DEV__\) \{\s*return <Redirect href="\/" \/>;\s*\}/.test(gallery), true);
});
