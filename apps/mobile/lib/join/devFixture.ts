/**
 * DEV-ONLY fixture for the Join a league screen (3f). Same safety model as
 * lib/shell/devFixture.ts and lib/home/devFixture.ts: read only under
 * `__DEV__` AND the EXPO_PUBLIC_JOIN_FIXTURE flag, so a release bundle (which
 * compiles `__DEV__` to false) never consults the env var and the fixture
 * code path is dead there. The gate itself is the pure
 * resolveJoinFixture(), tested in tests-deno/join-fixture.test.ts.
 */
import { resolveJoinFixture } from './joinFixtureGate';

export const JOIN_FIXTURE = resolveJoinFixture(__DEV__, process.env.EXPO_PUBLIC_JOIN_FIXTURE);

if (JOIN_FIXTURE) {
  console.warn(`[dev] JOIN FIXTURE "${JOIN_FIXTURE}" — fake preview-league / join-league, nothing is joined.`);
}
