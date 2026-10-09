/**
 * Join a league (3f): the dev-only fixture seam is INERT outside a dev build.
 * The gate is the pure resolveJoinFixture(isDev, raw); the one file that reads
 * `__DEV__` and EXPO_PUBLIC_JOIN_FIXTURE (lib/join/devFixture.ts) does nothing
 * but call it. These tests pin both halves.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { JOIN_FIXTURES, resolveJoinFixture } from '../lib/join/joinFixtureGate.ts';
import devFixtureSource from '../lib/join/devFixture.ts' with { type: 'text' };
import joinScreenSource from '../app/join-league.tsx' with { type: 'text' };

Deno.test('outside dev, EVERY value resolves to null (a release build can never turn a fixture on)', () => {
  for (const f of JOIN_FIXTURES) assertEquals(resolveJoinFixture(false, f), null, f);
  assertEquals(resolveJoinFixture(false, undefined), null);
  assertEquals(resolveJoinFixture(false, ''), null);
  assertEquals(resolveJoinFixture(false, 'garbage'), null);
});

Deno.test('in dev, only a recognised flag value turns a fixture on', () => {
  for (const f of JOIN_FIXTURES) assertEquals(resolveJoinFixture(true, f), f);
  assertEquals(resolveJoinFixture(true, undefined), null);
  assertEquals(resolveJoinFixture(true, ''), null);
  assertEquals(resolveJoinFixture(true, 'garbage'), null);
  assertEquals(resolveJoinFixture(true, 'PREVIEW'), null); // case-sensitive: no near-misses
});

Deno.test('the one reader passes __DEV__ itself, so nothing else can enable the fixture', () => {
  assertEquals(
    /export const JOIN_FIXTURE = resolveJoinFixture\(__DEV__, process\.env\.EXPO_PUBLIC_JOIN_FIXTURE\);/.test(devFixtureSource),
    true,
  );
  // Nobody else reads the env var or fakes the gate.
  assertEquals(joinScreenSource.includes('EXPO_PUBLIC_JOIN_FIXTURE'), false);
  assertEquals(joinScreenSource.includes("from '@/lib/join/devFixture'"), true);
});

Deno.test('the screen takes the fixture path ONLY through JOIN_FIXTURE (null in a release)', () => {
  // Every branch that skips the network or the league refresh is keyed on it.
  const branches = joinScreenSource.match(/if \(JOIN_FIXTURE\b|JOIN_FIXTURE \?|JOIN_FIXTURE === /g) ?? [];
  assertEquals(branches.length >= 4, true);
  // The two real calls are still there for the non-fixture path.
  assertEquals(joinScreenSource.includes("invoke('preview-league'"), true);
  assertEquals(joinScreenSource.includes("invoke('join-league'"), true);
});
