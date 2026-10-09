/**
 * S-15: every route file must be DECLARED in app/_layout.tsx. expo-router
 * auto-adds an undeclared route file as an unguarded screen -- outside both
 * Stack.Protected guards -- so it is reachable signed out (a deep link). That
 * is how app/stock-search.tsx sat open. This test enumerates the route files
 * from the generated source manifest, so a NEW route file fails here until it
 * is declared (regenerate the manifest after adding one).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import layout from '../app/_layout.tsx' with { type: 'text' };
import { SOURCES } from './sourceManifest.generated.ts';

/** Special files that are not routes. */
const NOT_ROUTES = new Set(['_layout', '+html', '+not-found', '+native-intent']);

function routeNames(): string[] {
  const names = new Set<string>();
  for (const path of Object.keys(SOURCES)) {
    const top = /^app\/([^/]+)\.tsx$/.exec(path);
    if (top && !NOT_ROUTES.has(top[1])) names.add(top[1]);
    const group = /^app\/(\([^)]+\))\//.exec(path);
    if (group) names.add(group[1]);
  }
  return [...names].sort();
}

Deno.test('every route file in app/ has a Stack.Screen in app/_layout.tsx', () => {
  const routes = routeNames();
  assert(routes.includes('stock-search') && routes.includes('(tabs)') && routes.includes('login'), 'manifest enumeration broke');
  const undeclared = routes.filter((r) => !layout.includes(`<Stack.Screen name="${r}"`));
  assertEquals(undeclared, [], 'undeclared routes are auto-added OUTSIDE the sign-in guards');
});

Deno.test('stock-search is declared inside the signed-in, username-set guard', () => {
  const signedIn = layout.indexOf('<Stack.Protected guard={signedIn}>');
  const hasUsername = layout.indexOf('<Stack.Protected guard={!needsUsername}>', signedIn);
  const at = layout.indexOf('<Stack.Screen name="stock-search"');
  const outsideBoth = layout.indexOf('<Stack.Screen name="reset-password"');
  assert(signedIn > 0 && hasUsername > signedIn && outsideBoth > 0);
  assert(at > hasUsername && at < outsideBoth, 'stock-search must sit inside guard={signedIn} > guard={!needsUsername}');
  assertEquals((layout.match(/name="stock-search"/g) ?? []).length, 1);
});
