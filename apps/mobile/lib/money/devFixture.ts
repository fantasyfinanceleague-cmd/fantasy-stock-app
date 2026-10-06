import { resolveMoneyFixture } from './fixtureMode';
/**
 * DEV-ONLY money fixtures (3e), for the simulator captures of the P0 stress
 * set. Same safety model as lib/home/devFixture.ts: read only under __DEV__,
 * gated by an env var, and never imported by a deno test (the RN global __DEV__
 * can't resolve under deno). Production never sees a fixture.
 */
export const MONEY_FIXTURE_CONFIG = resolveMoneyFixture(__DEV__, {
  stress: process.env.EXPO_PUBLIC_MONEY_FIXTURE,
  scenario: process.env.EXPO_PUBLIC_MONEY_SCENARIO,
  stake: process.env.EXPO_PUBLIC_MONEY_STAKE,
});

export const MONEY_FIXTURE: 'stress' | null = MONEY_FIXTURE_CONFIG ? 'stress' : null;

if (MONEY_FIXTURE_CONFIG) {
  console.warn(`[dev] MONEY FIXTURE stress (${MONEY_FIXTURE_CONFIG.scenario}, ${MONEY_FIXTURE_CONFIG.stake}): no ledger, price, preview or trade network calls.`);
}
