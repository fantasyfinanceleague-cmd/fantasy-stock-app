/**
 * Pure per-user weekly scorer for process-week-results.
 *
 * calculateUserScore and its row types were moved here VERBATIM from index.ts
 * (only `export` added) so the scorer can be exercised by hermetic tests — index.ts
 * cannot be imported by a test because it calls Deno.serve at top level. Same
 * hermetic pattern as ./grouping.ts, ./scoring-eligibility.ts and
 * ./playoff-progression.ts. The console.log lines are kept byte-identical so the
 * operational log surface does not change; they are the scorer's only side effect.
 *
 * scoreCashOnlyUser is the one addition: the scorer for a user whose ledger proves
 * they held NOTHING at week_start AND NOTHING at week_end (scorer kind 'cash_only'
 * in ./scoring-eligibility.ts). See that module for why both boundaries matter.
 */

export interface WeekSnapshot {
  symbol: string;
  quantity: number;
  weekStartPrice: number | null;  // legacy rows only; see enteredMidWeek
  weekEndPrice: number | null;    // Friday close price
  /**
   * True when the position was opened DURING the week. Such a row's
   * week_start_price is a purchase entry price, NOT a Monday open — and the same
   * buy is already carried in midWeekTrades, so treating it as a week-start
   * holding would count it twice. This flag replaces the old convention of
   * signalling "mid-week purchase" with a NULL week_start_price, which could
   * never actually be stored (the column is NOT NULL).
   */
  enteredMidWeek: boolean;
}

export interface MidWeekTrade {
  symbol: string;
  action: 'buy' | 'sell';
  quantity: number;
  price: number;
  createdAt: Date;
}

export interface UserScore {
  dollarGain: number;
  percentGain: number;
  hasPositions: boolean;
}

/**
 * Calculate user's score for the week using snapshots and mid-week trades.
 *
 * Score calculation (by individual trade):
 * - Stocks held all week: quantity × (week_end_price - week_start_price)
 * - Stocks sold mid-week: sold_qty × (sale_price - week_start_price)
 * - Partial holds: remaining_qty × (week_end_price - week_start_price)
 * - Stocks bought mid-week: quantity × (week_end_price - purchase_price)
 * - Stocks bought then sold same week: quantity × (sale_price - purchase_price)
 *
 * Returns dollar gain, percent gain, and whether user had any positions.
 */
export function calculateUserScore(
  userId: string,
  snapshots: WeekSnapshot[],
  midWeekTrades: MidWeekTrade[]
): UserScore {
  let totalGain = 0;
  let totalStartValue = 0;

  // Build a map of week end prices by symbol (for looking up Friday close)
  const weekEndPrices = new Map<string, number>();
  for (const snap of snapshots) {
    if (snap.weekEndPrice !== null) {
      weekEndPrices.set(snap.symbol.toUpperCase(), snap.weekEndPrice);
    }
  }

  // Build a map of week start holdings by symbol
  // This represents what the user held at Monday open
  // Excludes mid-week entries explicitly. Filtering on `weekStartPrice !== null`
  // was the old marker, and it was never reachable — the column is NOT NULL, so
  // those rows could not be stored at all (DEFECT 3). Now they ARE stored, with a
  // real entry price, so the flag is what separates them; keying on the price
  // being non-null would silently double-count every mid-week buy.
  const weekStartHoldings = new Map<string, { quantity: number; price: number }>();
  for (const snap of snapshots.filter(s => !s.enteredMidWeek && s.weekStartPrice !== null)) {
    weekStartHoldings.set(snap.symbol.toUpperCase(), {
      quantity: snap.quantity,
      price: snap.weekStartPrice!,
    });
  }

  // Sort trades by time to process in order (FIFO for sells)
  const sortedTrades = [...midWeekTrades].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  // Track remaining quantities for week-start holdings (for partial sells)
  const remainingHoldings = new Map<string, number>();
  for (const [symbol, holding] of weekStartHoldings) {
    remainingHoldings.set(symbol, holding.quantity);
  }

  // Track mid-week buys that haven't been sold yet (for buy-then-sell same week)
  // Each entry: { quantity, price }
  const midWeekBuys = new Map<string, { quantity: number; price: number }[]>();

  // Process each trade in order
  for (const trade of sortedTrades) {
    const symbol = trade.symbol.toUpperCase();

    if (trade.action === 'sell') {
      let remainingToSell = trade.quantity;
      const salePrice = trade.price;

      // First, sell from week-start holdings (Monday open → Sale price)
      const weekStartQty = remainingHoldings.get(symbol) || 0;
      if (weekStartQty > 0 && remainingToSell > 0) {
        const sellFromStart = Math.min(weekStartQty, remainingToSell);
        const startPrice = weekStartHoldings.get(symbol)!.price;

        const gain = sellFromStart * (salePrice - startPrice);
        totalGain += gain;
        totalStartValue += sellFromStart * startPrice;

        console.log(`${symbol}: Sold ${sellFromStart} from week-start holdings. Monday: $${startPrice}, Sold: $${salePrice}, Gain: $${gain.toFixed(2)}`);

        remainingHoldings.set(symbol, weekStartQty - sellFromStart);
        remainingToSell -= sellFromStart;
      }

      // Then, sell from mid-week buys (FIFO: Purchase price → Sale price)
      if (remainingToSell > 0) {
        const buys = midWeekBuys.get(symbol) || [];
        while (remainingToSell > 0 && buys.length > 0) {
          const oldestBuy = buys[0];
          const sellFromBuy = Math.min(oldestBuy.quantity, remainingToSell);

          const gain = sellFromBuy * (salePrice - oldestBuy.price);
          totalGain += gain;
          totalStartValue += sellFromBuy * oldestBuy.price;

          console.log(`${symbol}: Sold ${sellFromBuy} from mid-week buy. Bought: $${oldestBuy.price}, Sold: $${salePrice}, Gain: $${gain.toFixed(2)}`);

          oldestBuy.quantity -= sellFromBuy;
          remainingToSell -= sellFromBuy;

          if (oldestBuy.quantity <= 0) {
            buys.shift(); // Remove exhausted buy lot
          }
        }
        midWeekBuys.set(symbol, buys);
      }
    } else if (trade.action === 'buy') {
      // Add to mid-week buys (will be processed at week end or if sold later)
      const buys = midWeekBuys.get(symbol) || [];
      buys.push({ quantity: trade.quantity, price: trade.price });
      midWeekBuys.set(symbol, buys);
      console.log(`${symbol}: Bought ${trade.quantity} mid-week at $${trade.price}`);
    }
  }

  // Process remaining week-start holdings (held all week: Monday open → Friday close)
  for (const [symbol, remaining] of remainingHoldings) {
    if (remaining <= 0) continue;

    const startPrice = weekStartHoldings.get(symbol)!.price;
    const endPrice = weekEndPrices.get(symbol);

    if (endPrice !== undefined) {
      const gain = remaining * (endPrice - startPrice);
      totalGain += gain;
      totalStartValue += remaining * startPrice;
      console.log(`${symbol}: Held ${remaining} all week. Monday: $${startPrice}, Friday: $${endPrice}, Gain: $${gain.toFixed(2)}`);
    }
  }

  // Process remaining mid-week buys (bought and held to Friday: Purchase price → Friday close)
  for (const [symbol, buys] of midWeekBuys) {
    const endPrice = weekEndPrices.get(symbol);
    if (endPrice === undefined) continue;

    for (const buy of buys) {
      if (buy.quantity <= 0) continue;

      const gain = buy.quantity * (endPrice - buy.price);
      totalGain += gain;
      totalStartValue += buy.quantity * buy.price;
      console.log(`${symbol}: Mid-week buy held to Friday. ${buy.quantity} shares @ $${buy.price} → $${endPrice}, Gain: $${gain.toFixed(2)}`);
    }
  }

  // Calculate percentage gain
  const percentGain = totalStartValue > 0
    ? (totalGain / totalStartValue) * 100
    : 0;

  // User has positions if they had week-start holdings OR any mid-week trades
  const hasPositions = weekStartHoldings.size > 0 || midWeekTrades.length > 0;

  console.log(`User ${userId} total: Gain=$${totalGain.toFixed(2)}, StartValue=$${totalStartValue.toFixed(2)}, Percent=${percentGain.toFixed(2)}%`);

  return { dollarGain: totalGain, percentGain, hasPositions };
}

/**
 * Score a user the ledger proves was ALL-CASH at both week boundaries (scorer kind
 * 'cash_only'). Only ever called for a user with NO week_snapshots row.
 *
 * WHY AN EMPTY SNAPSHOT LIST IS EXACT HERE, NOT AN APPROXIMATION: flat at
 * week_start means there is no Monday holding to price; flat at week_end means
 * every lot bought during the week was also sold during the week. So every
 * contribution is a closed round trip, priced purely from the trades
 * (sale - purchase), and calculateUserScore needs no snapshot price at all.
 *
 *   - No trades all week        -> $0 gain, 0% (totalStartValue 0 hits the
 *                                  existing zero-basis guard: no division by zero).
 *   - Bought then sold in-week  -> the existing buy-then-sell FIFO path.
 *
 * hasPositions is OVERRIDDEN with hasLedgerHistory rather than taken from
 * calculateUserScore (`weekStartHoldings.size > 0 || midWeekTrades.length > 0`,
 * which is false for an idle cash week). Holding cash is a legitimate position:
 * dollars decide matchups, so $0 must beat an opponent's -$50, not auto-lose to it.
 * decideMatchupOutcome (./playoff-progression.ts) is unchanged — only its input:
 *   - genuinely CASH  (drafted/traded at some point, flat now) -> hasPositions
 *     true  -> normal dollar / percent / seed resolution.
 *   - genuinely EMPTY (no non-SKIP ledger row ever)            -> hasPositions
 *     false -> the existing both_empty_tie / team*_empty_auto_loss rules.
 */
export function scoreCashOnlyUser(
  userId: string,
  midWeekTrades: MidWeekTrade[],
  hasLedgerHistory: boolean,
): UserScore {
  const score = calculateUserScore(userId, [], midWeekTrades);
  return { ...score, hasPositions: hasLedgerHistory };
}
