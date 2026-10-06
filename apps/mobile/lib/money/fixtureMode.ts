/**
 * fixtureMode: the DEV-ONLY money fixture seam, as pure data (3e). Under the
 * stress fixture the app answers its money reads and writes from these
 * functions and never from the network: the quote and bars, the market status,
 * the record-trade preview and SUBMIT. resolveMoneyFixture is the single gate:
 * it returns null unless the dev flag is on AND EXPO_PUBLIC_MONEY_FIXTURE is
 * exactly "stress". devFixture.ts passes __DEV__ in; tests pass false.
 */
import type { RecordTradeOutcome } from './recordTradeOutcome';
import type { PreviewSlot, SlotShape } from './tierContract';
import type { MarketStatusRow } from './tradeGate';

export const MONEY_SCENARIOS = [
  'ok', 'conflict', 'no_eligible_slot', 'no_open_slots', 'market_closed', 'unconfirmed', 'load_fail',
] as const;
export type MoneyScenario = (typeof MONEY_SCENARIOS)[number];

export const MONEY_STAKES = ['price_tiers', 'budget_cap', 'fixed_notional'] as const;
export type MoneyStake = (typeof MONEY_STAKES)[number];

export interface MoneyFixture {
  scenario: MoneyScenario;
  stake: MoneyStake;
}

/** The fixture's league id, used when the signed-in user has no active league. */
export const FIXTURE_LEAGUE_ID = 'fixture-league';

/**
 * The single gate. Null unless `dev` is true AND the stress flag is exactly
 * "stress". Unknown scenario or stake values fall back to the defaults.
 */
export function resolveMoneyFixture(
  dev: boolean,
  env: { stress?: string | null; scenario?: string | null; stake?: string | null },
): MoneyFixture | null {
  if (!dev || env.stress !== 'stress') return null;
  const scenario = (MONEY_SCENARIOS as readonly string[]).includes(env.scenario ?? '')
    ? (env.scenario as MoneyScenario)
    : 'ok';
  const stake = (MONEY_STAKES as readonly string[]).includes(env.stake ?? '')
    ? (env.stake as MoneyStake)
    : 'price_tiers';
  return { scenario, stake };
}

/** The league settings the fixture plays under, per stake mode. */
export function fixtureLeague(stake: MoneyStake): {
  stake_mode: MoneyStake;
  notional_per_slot: number | null;
  budget_amount: number | null;
  num_rounds: number;
} {
  if (stake === 'budget_cap') return { stake_mode: 'budget_cap', notional_per_slot: null, budget_amount: 2500, num_rounds: 6 };
  if (stake === 'fixed_notional') return { stake_mode: 'fixed_notional', notional_per_slot: 2000, budget_amount: null, num_rounds: 6 };
  return { stake_mode: 'price_tiers', notional_per_slot: null, budget_amount: null, num_rounds: 6 };
}

/** The market the fixture reports: open for the session, or closed for the market_closed scenario. */
export function fixtureMarket(scenario: MoneyScenario, now: Date): MarketStatusRow {
  if (scenario === 'market_closed') {
    return { status: 'closed', session_open_at: null, session_close_at: null, next_open_at: '2026-10-06T13:30:00Z' };
  }
  const open = new Date(now.getTime() - 60 * 60_000).toISOString();
  const close = new Date(now.getTime() + 5 * 60 * 60_000).toISOString();
  return { status: 'open', session_open_at: open, session_close_at: close, next_open_at: null };
}

/** The preview's shape, as the fixture answers it (structurally the record-trade PreviewResult). */
export interface FixturePreviewResult {
  stakeMode: string | null;
  stake: number | null;
  unfilledSlots: number;
  sources: { trade_id: string; symbol: string; amount: number }[];
  slots: PreviewSlot[] | null;
  wouldFill?: SlotShape | null;
  openSlots?: SlotShape[];
}

const FIXTURE_SLOT: SlotShape = {
  slot_id: 'fixture-slot', slot_index: 0, slot_count: 1, price_min: 100, price_max: 200, category_id: null,
};

/**
 * The record-trade PREVIEW under the fixture: the sale proceeds a per-slot buy
 * would use, and the tier answer (would_fill) for a tier buy. No network.
 */
export function fixturePreview(fx: MoneyFixture, proceeds: { tradeId: string; symbol: string; amount: number }[]): FixturePreviewResult {
  const base: FixturePreviewResult = {
    stakeMode: fx.stake,
    stake: fx.stake === 'fixed_notional' ? 2000 : null,
    unfilledSlots: 0,
    sources: fx.stake === 'fixed_notional' ? proceeds.map((p) => ({ trade_id: p.tradeId, symbol: p.symbol, amount: p.amount })) : [],
    slots: [],
  };
  if (fx.stake !== 'price_tiers') return base;
  if (fx.scenario === 'no_eligible_slot') {
    return { ...base, wouldFill: null, openSlots: [FIXTURE_SLOT] };
  }
  if (fx.scenario === 'no_open_slots') {
    return { ...base, wouldFill: null, openSlots: [] };
  }
  return { ...base, wouldFill: FIXTURE_SLOT };
}

/**
 * The record-trade SUBMIT outcome under the fixture. It is produced here, with
 * no call to the function: the fixture can never write a trade.
 */
export function fixtureSubmitOutcome(fx: MoneyFixture, price: number): RecordTradeOutcome {
  switch (fx.scenario) {
    case 'conflict':
      return { kind: 'refused', reason: 'trade_conflict' };
    case 'unconfirmed':
      return { kind: 'network' };
    case 'market_closed':
      return { kind: 'refused', reason: 'market_closed', nextOpenAt: '2026-10-06T13:30:00Z' };
    case 'no_eligible_slot':
    case 'no_open_slots':
      return {
        kind: 'refused',
        reason: 'no_eligible_slot',
        tier: { price, openSlots: fx.scenario === 'no_open_slots' ? [] : [FIXTURE_SLOT] },
      };
    default:
      return { kind: 'ok', trade: { id: 'fixture-trade-not-written' } };
  }
}
