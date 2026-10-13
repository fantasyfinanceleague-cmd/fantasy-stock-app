/**
 * fetchPricesBisecting: Alpaca's multi-symbol snapshots endpoint is
 * all-or-nothing (one symbol it does not list 400s the whole request), so a 400
 * is bisected down to single symbols and one bad symbol costs only itself.
 * PURE (the fetch is injected), bounded by `maxRequests`.
 *
 * Lives in _shared since 2026-10-13 because two callers depend on it:
 * enrich-symbols (the catalog price refresh, which re-exports it with its own
 * default bound from ./price-batch.ts) and the draft auto-pick's live-price
 * screen (draft-write.ts). An edit for one caller is an edit for both: run
 * enrich-symbols/price-batch.test.ts AND _shared/draft-write.test.ts.
 */

export interface BatchFetchResult {
  ok: boolean;
  /** Present when ok. May omit symbols Alpaca had no trade/bar/quote data
   * for — that is a benign "no data" miss, not a request-level failure. */
  prices?: Map<string, number>;
  status?: number;
}

export type FetchPricesFn = (symbols: string[]) => Promise<BatchFetchResult>;

export interface BisectResult {
  prices: Map<string, number>;
  /** Genuine price_error symbols — the REQUEST for this symbol failed
   * (isolated down to a single-symbol 400, or unresolved when the request
   * cap was hit). Distinct from a symbol simply absent from `prices` because
   * Alpaca returned 200 with no data for it. */
  failed: string[];
  requestCount: number;
  /** True if maxRequests was exhausted before every symbol was
   * isolated — remaining unresolved symbols land in `failed` without being
   * bisected further. */
  capHit: boolean;
}

/**
 * Fetch prices for `symbols` (already filtered by partitionForAlpaca — this
 * function assumes every symbol is Alpaca-format-eligible), bisecting on a
 * 400 so one bad symbol costs only itself. `fetchFn` is injected so this is
 * testable with a fake that simulates per-symbol 400s — no real network.
 */
export async function fetchPricesBisecting(
  symbols: string[],
  fetchFn: FetchPricesFn,
  maxRequests: number,
): Promise<BisectResult> {
  const prices = new Map<string, number>();
  const failed: string[] = [];
  const budget = { used: 0 };
  let capHit = false;

  async function bisect(chunk: string[]): Promise<void> {
    if (chunk.length === 0) return;
    if (budget.used >= maxRequests) {
      capHit = true;
      failed.push(...chunk);
      return;
    }
    budget.used++;
    const res = await fetchFn(chunk);
    if (res.ok) {
      for (const s of chunk) {
        const p = res.prices?.get(s);
        if (p !== undefined) prices.set(s, p);
        // else: requested ok, Alpaca had no data for this one symbol —
        // benign "no data" miss, not a failure. Caller's existing fallback
        // (keep the prior stored last_price) applies; not added to `failed`.
      }
      return;
    }
    if (chunk.length === 1) {
      failed.push(chunk[0]);
      return;
    }
    const mid = Math.ceil(chunk.length / 2);
    await bisect(chunk.slice(0, mid));
    await bisect(chunk.slice(mid));
  }

  await bisect(symbols);
  return { prices, failed, requestCount: budget.used, capHit };
}
