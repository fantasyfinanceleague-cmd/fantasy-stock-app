/**
 * The P0 stress fixture for the money screens (3e, the Design Lead's standard
 * set): a 20-character username, a 40-character league name, values of $1M and
 * more, 16 managers, 1,000+ activity rows, two unpriced holdings (the offline
 * or slow case) and feed-suffixed company names. Deterministic: no random
 * numbers, so every figure reproduces. The ledger goes through the same parser
 * the app uses, so the fixture can't drift from the real response shape.
 */
import type { LedgerActivityRow, LedgerMember, PortfolioLedger } from './portfolioLedger';
import { shapeSearchResults, type ShapedSearchResult } from '../symbolSearch';

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

export interface StressSearchItem {
  symbol: string;
  name: string;
  price: number | null;
  is_draftable: boolean;
}

/** Every stress-drafted symbol (S001..S096), for the stock-search fixture seam. */
const STRESS_SEARCH_CATALOG: StressSearchItem[] = (() => {
  const items: StressSearchItem[] = [];
  for (let pick = 1; pick <= STRESS_MANAGERS * STRESS_ROUNDS; pick++) {
    const sym = symbolFor(pick);
    items.push({
      symbol: sym,
      name: companyName(pick),
      price: STRESS_UNPRICED.includes(sym) ? null : Math.round(entryPrice(pick) * 1.05 * 100) / 100,
      is_draftable: true,
    });
  }
  return items;
})();

/**
 * Stock search (3e, STEP 2): the fixture's offline replacement for the
 * symbols-search edge function. Ranked the same order CLAUDE.md records for
 * the live function (exact symbol, symbol starts-with, name starts-with,
 * name contains), so the fixture can't drift from the real ordering. Every
 * match is selectable here: ownership is never checked at search time (the
 * sheet derives held/owned-by-other/free from the ledger, and the server's
 * symbol_owned refusal, not a client-side filter, is what blocks a buy).
 */
export function filterStressSearchCatalog(query: string, limit = 8): ShapedSearchResult[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const rank = (item: StressSearchItem): number => {
    const sym = item.symbol.toUpperCase();
    const name = item.name.toUpperCase();
    if (sym === q) return 0;
    if (sym.startsWith(q)) return 1;
    if (name.startsWith(q)) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };
  const matches = STRESS_SEARCH_CATALOG.map((item) => ({ item, r: rank(item) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.item.symbol.localeCompare(b.item.symbol))
    .slice(0, limit)
    .map((x) => x.item);
  return shapeSearchResults(matches, {});
}

/**
 * Stock chart (3e, M2): a deterministic ~400-trading-day history per symbol,
 * ending the last weekday before `now` -- weekends skipped, so a range
 * filtered against a real calendar (stockChartSeries.barsForRange) finds
 * real trading days, same as production. No randomness: the same symbol and
 * `now` always reproduce the same bars (golden captures stay stable within
 * a day).
 */
function stressDailyBars(pick: number, now: Date): { date: string; close: number }[] {
  const anchor = entryPrice(pick);
  const bars: { date: string; close: number }[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let i = 0;
  while (bars.length < 400) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const day = cursor.getUTCDay();
    if (day === 0 || day === 6) continue; // weekend: no bar
    i += 1;
    // A smooth, symbol-distinct oscillation plus a slight long-run drift -- organic-looking,
    // fully deterministic.
    const close = Math.round(anchor * (1 + 0.15 * Math.sin((pick + i) * 0.17) + 0.0003 * i) * 100) / 100;
    bars.push({ date: cursor.toISOString().slice(0, 10), close });
  }
  return bars.reverse(); // oldest first
}

/** The stress fixture's bars for one symbol, keyed the same way the catalog is. */
export function stressChartBars(symbol: string, now: Date = new Date()): { date: string; close: number }[] {
  const pick = Number(symbol.replace(/^S/, ''));
  if (!Number.isFinite(pick) || pick < 1 || pick > STRESS_MANAGERS * STRESS_ROUNDS) return [];
  return stressDailyBars(pick, now);
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
