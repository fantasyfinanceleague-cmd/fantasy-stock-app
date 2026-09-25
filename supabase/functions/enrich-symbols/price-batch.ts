/**
 * enrich-symbols price-batch — pure symbol filtering + Alpaca batch-bisection
 * logic, plus the batch-selection merge. Extracted for hermetic testing, same
 * pattern as ../snapshot-week-start/plan.ts: no DB, no Alpaca, no Deno
 * runtime APIs. Run from repo root with
 *   deno test supabase/functions/enrich-symbols/price-batch.test.ts
 *
 * WHY THIS EXISTS (found 2026-09-25 by the live test draft; see
 * docs/STATUS.md §4 and CLAUDE.md "success signals are unreliable" #7):
 * Alpaca's `/v2/stocks/snapshots` multi-symbol endpoint is all-or-nothing —
 * Alpaca staff confirm it "returns either an error (e.g. if a symbol is
 * invalid) or the requested data... never both." One malformed symbol
 * anywhere in a 50-symbol batch 400s the WHOLE request, so up to 49 good
 * prices were silently dropped alongside 1 bad one, and the batch still
 * reported `ok:true, priced:0` — a false success, the exact shape CLAUDE.md
 * warns about.
 *
 * TWO INDEPENDENT DEFENSES, both needed:
 *   1. partitionForAlpaca — a pure PRE-FILTER that keeps symbols Alpaca's
 *      us_equity universe structurally does not list (preferred stock /
 *      warrant / unit / rights / when-issued forms from NASDAQ Trader's
 *      otherlisted/nasdaqlisted feeds, e.g. `$`/`-`/`=`/`^`/digit suffixes)
 *      out of the request entirely. Class shares (NASDAQ Trader's own dot
 *      notation, e.g. BRK.B) pass through unchanged — Alpaca accepts that
 *      form as-is, so no translation step exists here on purpose.
 *   2. fetchPricesBisecting — CONTAINMENT for anything that slips past the
 *      filter and still 400s (e.g. a symbol quietly delisted from Alpaca's
 *      universe but still well-formed and `active=true` in ours): halve the
 *      chunk and retry, down to singles, so one bad symbol costs only
 *      itself. Bounded by MAX_ALPACA_REQUESTS so a pathological
 *      multi-bad-symbol batch cannot burn Alpaca's whole 200-req/min
 *      Basic-plan budget, which quote/ticker-quotes/historical-bars also
 *      share.
 */

// KEEP IN SYNC with the identical regex in the backfill UPDATE in
// supabase/migrations/20260928000000_symbols_price_unsupported_column.sql —
// both must classify a symbol identically, or the migration's one-time seed
// and this runtime filter will disagree about which symbols are
// "unsupported" and the price-priority queue (see mergeBatchSelection below)
// will misbehave.
export const ALPACA_TICKER_RE = /^[A-Z]{1,6}(\.[A-Z]{1,2})?$/;

export interface PartitionResult {
  eligible: string[];
  unsupported: string[];
}

/**
 * Pure. Plain tickers and one dot-suffixed class share (e.g. BRK.B) pass as
 * `eligible`. Anything else — `$ - = ^`, digits, lowercase, more than one
 * dot — is a NASDAQ Trader preferred/warrant/unit/rights/when-issued form
 * that Alpaca's us_equity universe does not list, returned as `unsupported`
 * so the caller never sends it to Alpaca at all.
 */
export function partitionForAlpaca(symbols: string[]): PartitionResult {
  const eligible: string[] = [];
  const unsupported: string[] = [];
  for (const s of symbols) {
    (ALPACA_TICKER_RE.test(s) ? eligible : unsupported).push(s);
  }
  return { eligible, unsupported };
}

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
  /** True if MAX_ALPACA_REQUESTS was exhausted before every symbol was
   * isolated — remaining unresolved symbols land in `failed` without being
   * bisected further. */
  capHit: boolean;
}

// One stray bad symbol costs ~13 requests to isolate in a 50-symbol chunk
// (1 initial full-batch request + 6 halving levels x 2 requests/level, since
// only the half still containing the bad symbol recurses further: sizes
// 50->25->13->7->4->2->1). 30 leaves room for roughly two such symbols per
// invocation while staying well under Alpaca's 200-req/min Basic-plan
// budget, which quote/ticker-quotes/historical-bars also share — a full
// 4x-batch-size cap (200) would BE that whole per-minute budget in one call.
export const MAX_ALPACA_REQUESTS = 30;

/**
 * Fetch prices for `symbols` (already filtered by partitionForAlpaca — this
 * function assumes every symbol is Alpaca-format-eligible), bisecting on a
 * 400 so one bad symbol costs only itself. `fetchFn` is injected so this is
 * testable with a fake that simulates per-symbol 400s — no real network.
 */
export async function fetchPricesBisecting(
  symbols: string[],
  fetchFn: FetchPricesFn,
  maxRequests: number = MAX_ALPACA_REQUESTS,
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

export type PriceStatus = 'complete' | 'partial' | 'failed' | 'none_attempted';

/**
 * `ok` in the response means "the run completed" — it must NOT also carry
 * price-outcome meaning (CLAUDE.md's verdict-scope lesson: a run with
 * priced:20, price_errors:30 reporting ok:true is honest about the RUN,
 * dishonest if a caller reads ok as "pricing succeeded"). price_status is
 * the explicit, separately-scoped verdict for the pricing attempt only:
 *   - 'none_attempted': nothing Alpaca-eligible was in this batch (e.g. an
 *     all-ETF or all-format-unsupported batch) — not a failure.
 *   - 'complete': every request-level attempt succeeded (no price_errors).
 *     Some symbols may still be unpriced via the benign "no data" miss —
 *     that is orthogonal to this status, which is about errors, not coverage.
 *   - 'partial': at least one symbol priced AND at least one price_error.
 *   - 'failed': at least one price_error and NOTHING priced — the exact
 *     prod failure mode this fix targets (whole-batch 400 -> priced:0).
 */
export function computePriceStatus(
  eligibleAttempted: number,
  priced: number,
  errors: number,
): PriceStatus {
  if (eligibleAttempted === 0) return 'none_attempted';
  if (errors === 0) return 'complete';
  if (priced === 0) return 'failed';
  return 'partial';
}

/** At most half of every batch is drawn from the unpriced-and-supported
 * priority tier — see mergeBatchSelection. */
export function priorityCapFor(batchSize: number): number {
  return Math.floor(batchSize / 2);
}

/**
 * Pure merge of the two batch-selection queries (see enrich-symbols/index.ts):
 *   - priorityRows: unpriced (last_price IS NULL) AND NOT price_unsupported,
 *     stalest-first, capped at priorityCapFor(batchSize).
 *   - stalestRows: the normal stalest-first pool (all active rows), used to
 *     fill out the rest of the batch.
 *
 * STARVATION FIX: without a cap, once the initial unpriced backlog drains,
 * the priority tier would hold only symbols that keep failing Alpaca's price
 * lookup individually (chronic single-symbol 400s — see fetchPricesBisecting
 * `failed`). If those ever number >= batchSize, every future batch would be
 * 100% chronic failures and the other ~14k symbols would stop refreshing
 * (profile data, is_draftable) permanently. Capping the priority tier at
 * half the batch guarantees the normal stalest-first sweep always makes
 * progress regardless of how many symbols are chronically unpriceable.
 *
 * Dedupes by symbol (priority rows win) and truncates to batchSize.
 */
export function mergeBatchSelection<T extends { symbol: string }>(
  priorityRows: T[],
  stalestRows: T[],
  batchSize: number,
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const r of priorityRows) {
    if (merged.length >= batchSize) break;
    if (seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    merged.push(r);
  }
  for (const r of stalestRows) {
    if (merged.length >= batchSize) break;
    if (seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    merged.push(r);
  }
  return merged;
}
