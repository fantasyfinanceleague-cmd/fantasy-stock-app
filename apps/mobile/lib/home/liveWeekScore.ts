/**
 * liveWeekScore: the ONE live-score algorithm, shared by Home (3b-2) and
 * Matchup (3c, per the spec: "Home and Matchup both call it, and 3c will
 * reuse it").
 *
 * This is a PORT of the server's calculateUserScore
 * (supabase/functions/process-week-results/user-score.ts), with the
 * persisted Friday close swapped for a live price. It is a manual port,
 * not an import: that server file is Deno-only (an extensionless-import-
 * free `../_shared/draft-validation.ts` specifier that Metro/tsc's
 * "bundler" module resolution cannot follow — see
 * apps/mobile/tests-deno/deno.json's header on why tests-deno needs its
 * own sloppy-imports override), so it can never be require()'d into the RN
 * bundle. tests-deno/live-week-score.test.ts cross-imports the real server
 * file (fine — that file only runs under `deno test`, never bundled) and
 * asserts this port agrees with it byte-for-byte when the live price
 * equals the eventual Friday close.
 *
 * THE BUG THIS REPLACES (CLAUDE.md "success signals are unreliable" /
 * "guards keyed on all-or-nothing state", instance found 2026-09-29 in the
 * pre-3b-1 app/(tabs)/matchup.tsx): the old client computed a holding's
 * live gain only when a Monday `week_snapshots` row existed for it
 * (`snapshot.weekStartPrice`); a holding bought DURING the week (no Monday
 * row) fell through to `gain = hasSnapshots ? 0 : ...` — i.e. exactly $0,
 * for every mid-week buy, whenever the user had ANY Monday holding at all.
 * A user with SOME Monday lots and one mid-week buy therefore had that
 * buy's live gain silently zeroed — the partial-state family again. This
 * port fixes it by using the server's own FIFO accounting (Monday lots,
 * then mid-week buys, `enteredMidWeek` as the discriminator — never a NULL
 * weekStartPrice, which the column forbids) for every position, live or
 * not.
 */

export interface LiveSnapshot {
  symbol: string;
  quantity: number;
  /** Always a real price (the column is NOT NULL): a Monday open for a
   * held-all-week lot, or the mid-week entry price when `enteredMidWeek`. */
  weekStartPrice: number;
  /** True when this row's `weekStartPrice` is a mid-week PURCHASE price,
   * not a Monday open — the same buy is also carried in `trades`, so
   * counting this row as a week-start holding would double it. */
  enteredMidWeek: boolean;
}

export interface LiveTrade {
  symbol: string;
  action: 'buy' | 'sell';
  quantity: number;
  price: number;
  createdAt: Date;
}

export interface LiveWeekScoreResult {
  gain: number;
  pct: number;
  startValue: number;
  /** Symbols with a remaining live position but no price available — that
   * position contributes $0 to BOTH gain and startValue (so the ratio
   * stays fair over what WAS priced), and the caller is told which symbols
   * were excluded rather than presenting a number that silently assumed
   * it saw everything. */
  unpriced: string[];
  hasPositions: boolean;
}

/**
 * Score one user's current week from their Monday-lot snapshots and this
 * week's trades, using `price(symbol)` in place of the not-yet-written
 * Friday close. `price` returning null means "no quote for this symbol
 * right now" — NOT "$0" (CLAUDE.md's "success signals" instance #7: never
 * treat a missing price as zero).
 */
export function liveWeekScore(
  snapshots: LiveSnapshot[],
  trades: LiveTrade[],
  price: (symbol: string) => number | null,
): LiveWeekScoreResult {
  let totalGain = 0;
  let totalStartValue = 0;
  const unpriced = new Set<string>();

  // Week-start holdings: Monday-open lots only (mid-week entries are
  // carried in `trades` and would double-count here — see LiveSnapshot's
  // enteredMidWeek doc).
  const weekStartHoldings = new Map<string, { quantity: number; price: number }>();
  for (const snap of snapshots.filter((s) => !s.enteredMidWeek)) {
    weekStartHoldings.set(snap.symbol.toUpperCase(), {
      quantity: snap.quantity,
      price: snap.weekStartPrice,
    });
  }

  const sortedTrades = [...trades].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const remainingHoldings = new Map<string, number>();
  for (const [symbol, holding] of weekStartHoldings) {
    remainingHoldings.set(symbol, holding.quantity);
  }

  // Mid-week buys not yet sold, FIFO per symbol.
  const midWeekBuys = new Map<string, { quantity: number; price: number }[]>();

  for (const trade of sortedTrades) {
    const symbol = trade.symbol.toUpperCase();

    if (trade.action === 'sell') {
      let remainingToSell = trade.quantity;
      const salePrice = trade.price;

      // First, sell from the week-start holding (Monday open -> sale price).
      const weekStartQty = remainingHoldings.get(symbol) || 0;
      if (weekStartQty > 0 && remainingToSell > 0) {
        const sellFromStart = Math.min(weekStartQty, remainingToSell);
        const startPrice = weekStartHoldings.get(symbol)!.price;

        const gain = sellFromStart * (salePrice - startPrice);
        totalGain += gain;
        totalStartValue += sellFromStart * startPrice;

        remainingHoldings.set(symbol, weekStartQty - sellFromStart);
        remainingToSell -= sellFromStart;
      }

      // Then, sell from mid-week buys, FIFO (purchase price -> sale price).
      if (remainingToSell > 0) {
        const buys = midWeekBuys.get(symbol) || [];
        while (remainingToSell > 0 && buys.length > 0) {
          const oldestBuy = buys[0];
          const sellFromBuy = Math.min(oldestBuy.quantity, remainingToSell);

          const gain = sellFromBuy * (salePrice - oldestBuy.price);
          totalGain += gain;
          totalStartValue += sellFromBuy * oldestBuy.price;

          oldestBuy.quantity -= sellFromBuy;
          remainingToSell -= sellFromBuy;
          if (oldestBuy.quantity <= 0) buys.shift();
        }
        midWeekBuys.set(symbol, buys);
      }
    } else if (trade.action === 'buy') {
      const buys = midWeekBuys.get(symbol) || [];
      buys.push({ quantity: trade.quantity, price: trade.price });
      midWeekBuys.set(symbol, buys);
    }
  }

  // Remaining week-start holdings (held all week: Monday open -> live).
  for (const [symbol, remaining] of remainingHoldings) {
    if (remaining <= 0) continue;
    const startPrice = weekStartHoldings.get(symbol)!.price;
    const live = price(symbol);
    if (live == null) {
      unpriced.add(symbol);
      continue;
    }
    const gain = remaining * (live - startPrice);
    totalGain += gain;
    totalStartValue += remaining * startPrice;
  }

  // Remaining mid-week buys (bought and still held: purchase price -> live).
  for (const [symbol, buys] of midWeekBuys) {
    const live = price(symbol);
    if (live == null) {
      if (buys.some((b) => b.quantity > 0)) unpriced.add(symbol);
      continue;
    }
    for (const buy of buys) {
      if (buy.quantity <= 0) continue;
      const gain = buy.quantity * (live - buy.price);
      totalGain += gain;
      totalStartValue += buy.quantity * buy.price;
    }
  }

  const pct = totalStartValue > 0 ? (totalGain / totalStartValue) * 100 : 0;
  const hasPositions = weekStartHoldings.size > 0 || trades.length > 0;

  return { gain: totalGain, pct, startValue: totalStartValue, unpriced: [...unpriced], hasPositions };
}
