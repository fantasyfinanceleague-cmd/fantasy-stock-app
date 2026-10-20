/**
 * The capture seam, wired to the app's globals (3c). `SEAM_ON` is the dev build AND
 * EXPO_PUBLIC_GAME_SEAM='1'. Production never sees a fixture response. The gate
 * itself lives in devSeamGate.ts, where it is tested.
 */
import { createFailOnce, seamActive } from './devSeamGate';
import { parseMatchupFixture, type MatchupFixtureVariant } from './matchupFixture';
import { parseLeagueFixture, type LeagueFixture } from './leagueFixture';

export const SEAM_ON: boolean = seamActive(typeof __DEV__ !== 'undefined' ? __DEV__ : false, process.env.EXPO_PUBLIC_GAME_SEAM);

/** The Matchup capture fixture's variant (EXPO_PUBLIC_MATCHUP_FIXTURE; matchupFixture.ts). Read
 * here, beside SEAM_ON, so matchupFixture.ts stays pure for tests-deno. */
export const MATCHUP_FIXTURE_VARIANT: MatchupFixtureVariant = parseMatchupFixture(process.env.EXPO_PUBLIC_MATCHUP_FIXTURE);

/** The League tab's capture fixture (EXPO_PUBLIC_LEAGUE_FIXTURE; leagueFixture.ts), seam only. */
export const LEAGUE_FIXTURE_VARIANT: LeagueFixture | null = SEAM_ON ? parseLeagueFixture(process.env.EXPO_PUBLIC_LEAGUE_FIXTURE) : null;

/** The Portfolio capture's stake mode (EXPO_PUBLIC_PORTFOLIO_STAKE: budget_cap, budget_null — a budget cap whose budget_amount is NULL, price_tiers;
 * anything else = fixed_notional, the Matchup fixture's own league). Capture only. */
export const PORTFOLIO_STAKE_VARIANT: 'fixed_notional' | 'budget_cap' | 'budget_null' | 'price_tiers' =
  process.env.EXPO_PUBLIC_PORTFOLIO_STAKE === 'budget_cap' || process.env.EXPO_PUBLIC_PORTFOLIO_STAKE === 'price_tiers'
    || process.env.EXPO_PUBLIC_PORTFOLIO_STAKE === 'budget_null'
    ? process.env.EXPO_PUBLIC_PORTFOLIO_STAKE
    : 'fixed_notional';

/** Capture only: hold Portfolio's seam ledger this long (its loading state) — EXPO_PUBLIC_CAPTURE_DELAY_MS. */
export const CAPTURE_DELAY_MS: number = SEAM_ON ? Number(process.env.EXPO_PUBLIC_CAPTURE_DELAY_MS) || 0 : 0;
/** Capture only: the seam ledger read fails (Portfolio's failed state) — EXPO_PUBLIC_CAPTURE_FAIL=1. */
export const CAPTURE_FAIL: boolean = SEAM_ON && process.env.EXPO_PUBLIC_CAPTURE_FAIL === '1';
/** Capture only: the named seam read fails on its FIRST call and answers after (EXPO_PUBLIC_CAPTURE_FAIL_ONCE=<read key>[,...];
 * devSeamGate.ts), so a load-failure card's Try again can be tapped and seen to recover. Seam only: inert in production. */
export const captureFailsOnce: (key: string) => boolean = createFailOnce(SEAM_ON, process.env.EXPO_PUBLIC_CAPTURE_FAIL_ONCE);
/** Capture only: record-trade's refusal for the review's refusal captures (EXPO_PUBLIC_CAPTURE_REFUSAL,
 * e.g. trade_conflict, market_closed). Unset: the seam's submit succeeds (and never writes). */
export const CAPTURE_REFUSAL: string | null = SEAM_ON ? process.env.EXPO_PUBLIC_CAPTURE_REFUSAL || null : null;
/** Capture only: your draft happened today (Thu 6 PM ET, after the close) — Portfolio's one-point
 * Season line (EXPO_PUBLIC_CAPTURE_DRAFT_TODAY=1). */
export const CAPTURE_DRAFT_TODAY: boolean = SEAM_ON && process.env.EXPO_PUBLIC_CAPTURE_DRAFT_TODAY === '1';
/** Capture only: the Home excerpt's other managers (Paolo M., Luca V.) hold Gianluigi's fixture roster too, so a tap on
 * their row opens a team that loads (EXPO_PUBLIC_CAPTURE_TEAMS=1; the leaguemate team view). */
export const CAPTURE_TEAMS: boolean = SEAM_ON && process.env.EXPO_PUBLIC_CAPTURE_TEAMS === '1';

/** Capture only: every price mirrored below its draft price — the loss stress (EXPO_PUBLIC_CAPTURE_LOSS=1). */
export const CAPTURE_LOSS: boolean = SEAM_ON && process.env.EXPO_PUBLIC_CAPTURE_LOSS === '1';
