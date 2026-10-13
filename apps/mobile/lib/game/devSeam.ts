/**
 * The capture seam, wired to the app's globals (3c). `SEAM_ON` is the dev build AND
 * EXPO_PUBLIC_GAME_SEAM='1'. Production never sees a fixture response. The gate
 * itself lives in devSeamGate.ts, where it is tested.
 */
import { seamActive } from './devSeamGate';
import { parseMatchupFixture, type MatchupFixtureVariant } from './matchupFixture';
import { parseLeagueFixture, type LeagueFixture } from './leagueFixture';

export const SEAM_ON: boolean = seamActive(typeof __DEV__ !== 'undefined' ? __DEV__ : false, process.env.EXPO_PUBLIC_GAME_SEAM);

/** The Matchup capture fixture's variant (EXPO_PUBLIC_MATCHUP_FIXTURE; matchupFixture.ts). Read
 * here, beside SEAM_ON, so matchupFixture.ts stays pure for tests-deno. */
export const MATCHUP_FIXTURE_VARIANT: MatchupFixtureVariant = parseMatchupFixture(process.env.EXPO_PUBLIC_MATCHUP_FIXTURE);

/** The League tab's capture fixture (EXPO_PUBLIC_LEAGUE_FIXTURE; leagueFixture.ts), seam only. */
export const LEAGUE_FIXTURE_VARIANT: LeagueFixture | null = SEAM_ON ? parseLeagueFixture(process.env.EXPO_PUBLIC_LEAGUE_FIXTURE) : null;

/** The Portfolio capture's stake mode (EXPO_PUBLIC_PORTFOLIO_STAKE: budget_cap, price_tiers;
 * anything else = fixed_notional, the Matchup fixture's own league). Capture only. */
export const PORTFOLIO_STAKE_VARIANT: 'fixed_notional' | 'budget_cap' | 'price_tiers' =
  process.env.EXPO_PUBLIC_PORTFOLIO_STAKE === 'budget_cap' || process.env.EXPO_PUBLIC_PORTFOLIO_STAKE === 'price_tiers'
    ? process.env.EXPO_PUBLIC_PORTFOLIO_STAKE
    : 'fixed_notional';
