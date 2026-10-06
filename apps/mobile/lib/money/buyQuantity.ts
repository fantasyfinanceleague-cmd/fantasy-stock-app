/**
 * buyQuantity: how many shares a buy fills, mirroring record-trade exactly
 * (supabase/functions/_shared/draft-validation.ts validateTradeAdd and
 * fillQuantity). The client never chooses a quantity; it only shows the one
 * the server will size.
 *
 *   fixed_notional  price rounded to cents FIRST (trades.price is NUMERIC(10,2)),
 *                   then quantity = round(amount / price, 6 dp), where amount
 *                   is the sale's proceeds or an unfilled slot's notional.
 *   budget_cap / price_tiers / unconstrained  exactly one share.
 *
 * tests-deno/server-parity.test.ts asserts this against the server's own
 * validator, so the review's numbers can't drift from the recorded trade.
 */
export type BuySource =
  | { kind: 'one_share' }
  | { kind: 'budget'; budget: number; spent: number; left: number }
  | { kind: 'tier'; tierLabel: string }
  | { kind: 'proceeds'; amount: number; price: number }
  | { kind: 'unfilled_slot'; amount: number; price: number };

/** Cents price and 6-dp quantity for a fixed_notional fill, or null when the
 * inputs can't produce a real fill (never a zero or NaN share count). */
export function fixedNotionalShares(amount: number, rawPrice: number): { price: number; quantity: number } | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const price = Math.round(rawPrice * 100) / 100;
  if (!(price > 0)) return null;
  const quantity = Math.round((amount / price) * 1e6) / 1e6;
  if (!(quantity > 0)) return null;
  return { price, quantity };
}

export function buyQuantity(source: BuySource): number | null {
  switch (source.kind) {
    case 'one_share':
    case 'budget':
    case 'tier':
      return 1;
    case 'proceeds':
    case 'unfilled_slot':
      return fixedNotionalShares(source.amount, source.price)?.quantity ?? null;
  }
}
