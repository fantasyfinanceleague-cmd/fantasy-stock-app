/**
 * DEV-ONLY money fixtures (3e), for the simulator captures of the P0 stress
 * set. Same safety model as lib/home/devFixture.ts: read only under __DEV__,
 * gated by an env var, and never imported by a deno test (the RN global __DEV__
 * can't resolve under deno). Production never sees a fixture.
 */
export const MONEY_FIXTURE: 'stress' | null =
  __DEV__ && process.env.EXPO_PUBLIC_MONEY_FIXTURE === 'stress' ? 'stress' : null;

if (MONEY_FIXTURE) {
  console.warn(`[dev] MONEY FIXTURE "${MONEY_FIXTURE}": fake Portfolio data, no ledger or price reads.`);
}
