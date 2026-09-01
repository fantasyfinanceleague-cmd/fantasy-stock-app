/**
 * Draftable-universe eligibility (DR-001: "default-on eligibility filter
 * (market-cap / price / exchange floor) excluding penny stocks and junk
 * listings"). Pure module, same hermetic pattern as draft-validation.ts —
 * consumed by enrich-symbols, tested with no DB/network in
 * symbol-eligibility.test.ts.
 */

/** Primary US exchanges as named by refresh-symbols' NASDAQ Trader feed
 * (EX_MAP in refresh-symbols/index.ts). The universe feed only lists these
 * venues, so an unrecognized or NULL exchange means the row predates the
 * exchange column or the feed changed — treated as NOT draftable
 * (fail-closed, per the spec's null-exchange handling requirement). */
export const PRIMARY_US_EXCHANGES = new Set([
  'NASDAQ',
  'NYSE',
  'NYSE American',
  'NYSE Arca',
  'Cboe BZX',
]);

export const MIN_PRICE = 1; // dollars — inclusive floor (>= $1 per spec)
export const MIN_MARKET_CAP = 250_000_000; // dollars — small-cap floor, inclusive

export interface EligibilityInputs {
  active: boolean | null;
  exchange: string | null;
  is_etf: boolean | null;
  last_price: number | null;
  market_cap: number | null;
}

/**
 * ETFs: Finnhub profile2 returns no market capitalization for funds, so the
 * cap floor cannot apply — an ETF is draftable on the price + exchange +
 * active tests alone. Funds also carry no industry, so they are Misc/flex-only
 * (or category-eligible via a curated override, e.g. QQQ -> tech) — that is
 * the category layer's job, not eligibility's.
 */
export function computeIsDraftable(i: EligibilityInputs): boolean {
  if (i.active !== true) return false;
  if (!i.exchange || !PRIMARY_US_EXCHANGES.has(i.exchange)) return false;
  const price = Number(i.last_price);
  if (!Number.isFinite(price) || price < MIN_PRICE) return false;
  if (i.is_etf === true) return true;
  const cap = Number(i.market_cap);
  if (!Number.isFinite(cap) || cap < MIN_MARKET_CAP) return false;
  return true;
}
