/**
 * The Supabase client libraries are pinned EXACTLY in apps/mobile (hygiene pre-1.3; onboarding W2's review).
 * Why: the PKCE recovery-marker spelling changed between auth-js 2.89 ('PASSWORD_RECOVERY') and 2.108 ('recovery'), and the
 * password-reset and confirmation email links rely on it (lib/auth/recoverySession.ts, authLinkHandlers.ts). A caret range
 * lets an `npm install` move the client to a version whose behaviour the links were never checked against.
 * `@supabase/auth-js` is not a direct dependency: supabase-js depends on it at an EXACT version, so pinning supabase-js
 * pins it; if it ever becomes a direct dependency it must be exact too.
 * Run: `cd apps/mobile/tests-deno && deno test --allow-read .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';

const read = (rel: string) => JSON.parse(Deno.readTextFileSync(new URL(rel, import.meta.url)));
const pkg = read('../package.json');
const lock = read('../package-lock.json');

/** An exact version: major.minor.patch (optionally a prerelease/build), no range operator, wildcard or tag. */
function isExactVersion(spec: unknown): boolean {
  return typeof spec === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(spec);
}

Deno.test('isExactVersion: the spellings that float are refused', () => {
  for (const ok of ['2.89.0', '10.0.1', '2.89.0-beta.1']) assert(isExactVersion(ok), ok);
  for (const bad of ['^2.89.0', '~2.89.0', '>=2.89.0', '2.89.x', '2.x', '2', '*', 'latest', '2.89.0 || 2.90.0', '2.89.0 - 2.99.0', '', undefined, null]) {
    assert(!isExactVersion(bad), String(bad));
  }
});

Deno.test('apps/mobile pins @supabase/supabase-js exactly (no caret)', () => {
  const spec = pkg.dependencies?.['@supabase/supabase-js'];
  assert(isExactVersion(spec), `@supabase/supabase-js is "${spec}": pin it exactly (a caret lets a bump change the PKCE recovery marker)`);
});

Deno.test('@supabase/auth-js, if it is a direct dependency, is pinned exactly too', () => {
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const spec = pkg[section]?.['@supabase/auth-js'];
    if (spec !== undefined) assert(isExactVersion(spec), `@supabase/auth-js is "${spec}" in ${section}`);
  }
});

Deno.test('the lockfile agrees: its root spec is the same exact string, and it resolves exactly that version (auth-js too)', () => {
  const spec = pkg.dependencies['@supabase/supabase-js'];
  assertEquals(lock.packages['']?.dependencies?.['@supabase/supabase-js'], spec, 'package-lock.json root spec differs from package.json');
  const resolved = lock.packages['node_modules/@supabase/supabase-js']?.version;
  assertEquals(resolved, spec, 'the lockfile resolves another supabase-js than the pin');
  // supabase-js depends on auth-js at an exact version: the client and auth-js move together, 2.89.0 at the time of the pin
  const authSpec = lock.packages['node_modules/@supabase/supabase-js']?.dependencies?.['@supabase/auth-js'];
  assert(isExactVersion(authSpec), `supabase-js asks auth-js for "${authSpec}"`);
  assertEquals(lock.packages['node_modules/@supabase/auth-js']?.version, authSpec, 'the lockfile resolves another auth-js than supabase-js asks for');
});
