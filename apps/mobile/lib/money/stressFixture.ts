/**
 * The P0 stress fixture for the money screens (3e, the Design Lead's standard
 * set): a 20-character username, a 40-character league name, values of $1M and
 * more, 16 managers, 1,000+ activity rows, two unpriced holdings (the offline
 * or slow case) and feed-suffixed company names. Deterministic: no random
 * numbers, so every figure reproduces. The ledger goes through the same parser
 * the app uses, so the fixture can't drift from the real response shape.
 */
import type { LedgerActivityRow, LedgerMember, PortfolioLedger } from './portfolioLedger';

export const STRESS_USERNAME = 'Maximilian Rodriguez'; // 20 characters
export const STRESS_LEAGUE_NAME = 'The Extraordinarily Long Stock Contest 2'; // 40 characters
export const STRESS_CALLER = 'm01';
export const STRESS_MANAGERS = 16;
export const STRESS_ROUNDS = 6;
/** The caller's two holdings with no live price (the offline or slow case). */
export const STRESS_UNPRICED = ['S001', 'S081'];

const SHARES = 10_000;
const PAIRS_PER_MANAGER = 29; // 16 x 29 x 2 = 928 trade rows, plus 96 draft rows = 1,024

const uid = (m: number) => `m${String(m + 1).padStart(2, '0')}`;
const symbolFor = (pick: number) => `S${String(pick).padStart(3, '0')}`;
const entryPrice = (pick: number) => 100 + ((pick * 13) % 400);

function companyName(pick: number): string {
  const base = `Company ${pick} Holdings Corporation`;
  // Every other company carries a feed suffix, which the cleaner must strip.
  return pick % 2 === 0 ? `${base} - Common Stock` : base;
}

export interface StressMarket {
  ledger: PortfolioLedger;
  /** Live prices, keyed by symbol. The two unpriced holdings are absent. */
  prices: Record<string, number>;
  /** Previous closes, keyed by symbol. */
  prevCloses: Record<string, number>;
}

export function buildStressMarket(): StressMarket {
  const activity: LedgerActivityRow[] = [];
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 13, 14, 0) + minute * 60_000).toISOString();
  let minute = 0;

  // 96 draft picks: 16 managers, 6 rounds, a snake order is irrelevant to the fixture.
  for (let round = 1; round <= STRESS_ROUNDS; round++) {
    for (let m = 0; m < STRESS_MANAGERS; m++) {
      const pick = (round - 1) * STRESS_MANAGERS + m + 1;
      const price = entryPrice(pick);
      activity.push({
        kind: 'draft',
        user_id: uid(m),
        symbol: symbolFor(pick),
        action: 'buy',
        quantity: SHARES,
        round,
        pick_number: pick,
        occurred_at: at(minute++),
        total_value: Math.round(price * SHARES * 100) / 100,
        price,
      });
    }
  }

  // 928 trade rows: each manager sells one share of an own stock and buys it back,
  // many times. Net holdings don't move, but the history is 1,000+ rows deep.
  for (let m = 0; m < STRESS_MANAGERS; m++) {
    const own = [0, 1, 2, 3, 4, 5].map((r) => r * STRESS_MANAGERS + m + 1);
    for (let k = 0; k < PAIRS_PER_MANAGER; k++) {
      const pick = own[k % own.length];
      const price = entryPrice(pick) + (k % 7);
      for (const action of ['sell', 'buy'] as const) {
        activity.push({
          kind: 'trade',
          user_id: uid(m),
          symbol: symbolFor(pick),
          action,
          quantity: 1,
          round: null,
          pick_number: null,
          occurred_at: at(minute++),
          total_value: price,
          price,
        });
      }
    }
  }

  const symbol_names: Record<string, string> = {};
  for (let pick = 1; pick <= STRESS_MANAGERS * STRESS_ROUNDS; pick++) {
    symbol_names[symbolFor(pick)] = companyName(pick);
  }

  const members: LedgerMember[] = [];
  for (let m = 0; m < STRESS_MANAGERS; m++) {
    members.push({
      user_id: uid(m),
      display_name: m === 0 ? STRESS_USERNAME : `Manager Number ${String(m + 1).padStart(2, '0')}`,
      is_bot: m >= STRESS_MANAGERS - 2,
    });
  }

  const prices: Record<string, number> = {};
  const prevCloses: Record<string, number> = {};
  for (let pick = 1; pick <= STRESS_MANAGERS * STRESS_ROUNDS; pick++) {
    const sym = symbolFor(pick);
    prevCloses[sym] = Math.round(entryPrice(pick) * 1.02 * 100) / 100;
    if (!STRESS_UNPRICED.includes(sym)) prices[sym] = Math.round(entryPrice(pick) * 1.05 * 100) / 100;
  }

  return { ledger: { activity, symbol_names, members }, prices, prevCloses };
}
