/**
 * Unit tests for ./price-batch.ts. Hermetic: no DB, no Alpaca, no Deno
 * runtime APIs — `fetchPricesBisecting` takes an injected fake fetcher.
 * Run from repo root with
 *   deno test supabase/functions/enrich-symbols/price-batch.test.ts
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import {
  ALPACA_TICKER_RE,
  computePriceStatus,
  fetchPricesBisecting,
  mergeBatchSelection,
  partitionForAlpaca,
  priorityCapFor,
  type BatchFetchResult,
} from './price-batch.ts';

// ── partitionForAlpaca / ALPACA_TICKER_RE ──────────────────────────────────

Deno.test('partitionForAlpaca: plain tickers are eligible', () => {
  const { eligible, unsupported } = partitionForAlpaca(['AAPL', 'MSFT', 'F', 'BAC']);
  assertEquals(eligible, ['AAPL', 'MSFT', 'F', 'BAC']);
  assertEquals(unsupported, []);
});

Deno.test('partitionForAlpaca: dot-suffixed class shares pass through unchanged (no translation)', () => {
  // Alpaca accepts NASDAQ Trader's own dot notation as-is (e.g. BRK.B) — no
  // translation step exists in this module on purpose.
  const { eligible, unsupported } = partitionForAlpaca(['BRK.B', 'BF.B']);
  assertEquals(eligible, ['BRK.B', 'BF.B']);
  assertEquals(unsupported, []);
});

Deno.test('partitionForAlpaca: preferred/warrant/unit/rights forms are unsupported', () => {
  const { eligible, unsupported } = partitionForAlpaca([
    'ABC$', 'ABC$A', 'ABC-A', 'ABC=', 'ABC^', 'GME1', 'abc',
  ]);
  assertEquals(eligible, []);
  assertEquals(unsupported, ['ABC$', 'ABC$A', 'ABC-A', 'ABC=', 'ABC^', 'GME1', 'abc']);
});

Deno.test('partitionForAlpaca: mixed batch splits correctly (regex sanity)', () => {
  const { eligible, unsupported } = partitionForAlpaca(['AAPL', 'ABC$A', 'BRK.B', 'GME1']);
  assertEquals(eligible, ['AAPL', 'BRK.B']);
  assertEquals(unsupported, ['ABC$A', 'GME1']);
});

Deno.test('ALPACA_TICKER_RE: rejects more than one dot', () => {
  assert(!ALPACA_TICKER_RE.test('A.B.C'));
});

// ── fetchPricesBisecting ────────────────────────────────────────────────────

/** Builds a fake fetcher: any symbol in `badSymbols` makes the WHOLE chunk
 * 400, mirroring Alpaca's real all-or-nothing behavior. */
function fakeFetcher(
  goodPrices: Record<string, number>,
  badSymbols: Set<string>,
  callLog: string[][] = [],
) {
  return (symbols: string[]): Promise<BatchFetchResult> => {
    callLog.push([...symbols]);
    if (symbols.some((s) => badSymbols.has(s))) {
      return Promise.resolve({ ok: false, status: 400 });
    }
    const prices = new Map<string, number>();
    for (const s of symbols) {
      if (goodPrices[s] !== undefined) prices.set(s, goodPrices[s]);
    }
    return Promise.resolve({ ok: true, prices });
  };
}

Deno.test('fetchPricesBisecting: all valid -> one request', async () => {
  const symbols = Array.from({ length: 50 }, (_, i) => `S${i}`);
  const goodPrices: Record<string, number> = {};
  for (const s of symbols) goodPrices[s] = 100;
  const callLog: string[][] = [];
  const result = await fetchPricesBisecting(symbols, fakeFetcher(goodPrices, new Set(), callLog));
  assertEquals(result.requestCount, 1);
  assertEquals(callLog.length, 1);
  assertEquals(result.prices.size, 50);
  assertEquals(result.failed, []);
  assertEquals(result.capHit, false);
});

Deno.test('fetchPricesBisecting: one invalid symbol in 50 -> 49 priced, 1 failed', async () => {
  const symbols = Array.from({ length: 50 }, (_, i) => `S${i}`);
  const goodPrices: Record<string, number> = {};
  for (const s of symbols) goodPrices[s] = 100;
  const bad = new Set(['S37']);
  const result = await fetchPricesBisecting(symbols, fakeFetcher(goodPrices, bad));
  assertEquals(result.prices.size, 49);
  assert(!result.prices.has('S37'));
  assertEquals(result.failed, ['S37']);
  assertEquals(result.capHit, false);
  // Worst-case request count for isolating 1 bad symbol in 50: 1 initial +
  // 6 halving levels x 2 = 13 (see MAX_ALPACA_REQUESTS comment in price-batch.ts).
  assert(result.requestCount <= 13, `expected <= 13 requests, got ${result.requestCount}`);
});

Deno.test('fetchPricesBisecting: 400 on a single symbol -> marked failed, not silently "no data"', async () => {
  const bad = new Set(['ONLY']);
  const result = await fetchPricesBisecting(['ONLY'], fakeFetcher({}, bad));
  assertEquals(result.requestCount, 1);
  assertEquals(result.failed, ['ONLY']);
  assertEquals(result.prices.size, 0);
});

Deno.test('fetchPricesBisecting: 200 with no data for a symbol is NOT a failure', async () => {
  // Alpaca returns ok:true but the symbol has no trade/bar/quote (e.g. halted).
  const result = await fetchPricesBisecting(['QUIET'], fakeFetcher({}, new Set()));
  assertEquals(result.requestCount, 1);
  assertEquals(result.failed, []); // absent from prices, but not "failed"
  assertEquals(result.prices.size, 0);
});

Deno.test('fetchPricesBisecting: all invalid -> bounded retries, all land in failed', async () => {
  const symbols = Array.from({ length: 10 }, (_, i) => `B${i}`);
  const bad = new Set(symbols); // every symbol 400s
  const result = await fetchPricesBisecting(symbols, fakeFetcher({}, bad));
  assertEquals(result.prices.size, 0);
  assertEquals(result.failed.sort(), [...symbols].sort());
  // Bounded: bisecting 10 all-bad symbols down to singles takes far fewer
  // than MAX_ALPACA_REQUESTS (10 leaves + internal splits), never unbounded.
  assert(result.requestCount < 30, `expected bounded request count, got ${result.requestCount}`);
});

Deno.test('fetchPricesBisecting: request cap stops bisection and marks the rest failed', async () => {
  // Pathological: many bad symbols force the cap to trip before every
  // symbol is isolated to a single request. goodPrices covers every
  // non-bad symbol so a chunk that DOES succeed is actually priced, not
  // just silently absorbed as a benign "no data" miss — isolating the
  // assertion to what the cap itself does to unresolved symbols.
  const symbols = Array.from({ length: 50 }, (_, i) => `P${i}`);
  const bad = new Set(symbols.filter((_, i) => i % 2 === 0)); // 25 bad, interleaved
  const goodPrices: Record<string, number> = {};
  for (const s of symbols) if (!bad.has(s)) goodPrices[s] = 1;
  const result = await fetchPricesBisecting(symbols, fakeFetcher(goodPrices, bad), 10);
  assertEquals(result.capHit, true);
  assertEquals(result.requestCount, 10);
  // Every symbol lands somewhere — priced, or explicitly failed at the cap.
  // Never silently dropped, never left in an ambiguous "no data" state.
  assertEquals(result.prices.size + result.failed.length, 50);
});

// ── computePriceStatus ──────────────────────────────────────────────────────

Deno.test('computePriceStatus: none_attempted when nothing was eligible', () => {
  assertEquals(computePriceStatus(0, 0, 0), 'none_attempted');
});

Deno.test('computePriceStatus: complete when no errors', () => {
  assertEquals(computePriceStatus(50, 50, 0), 'complete');
  // Complete is about errors, not full coverage — benign "no data" misses
  // don't count against it.
  assertEquals(computePriceStatus(50, 40, 0), 'complete');
});

Deno.test('computePriceStatus: failed when nothing priced and errors exist (the prod bug)', () => {
  assertEquals(computePriceStatus(50, 0, 50), 'failed');
});

Deno.test('computePriceStatus: partial when some priced and some errored', () => {
  assertEquals(computePriceStatus(50, 20, 30), 'partial');
});

// ── priorityCapFor / mergeBatchSelection ────────────────────────────────────

Deno.test('priorityCapFor: half the batch, rounded down', () => {
  assertEquals(priorityCapFor(50), 25);
  assertEquals(priorityCapFor(80), 40);
  assertEquals(priorityCapFor(1), 0);
});

Deno.test('mergeBatchSelection: priority rows first, then stalest, truncated to batchSize', () => {
  const priority = [{ symbol: 'P1' }, { symbol: 'P2' }];
  const stalest = [{ symbol: 'S1' }, { symbol: 'S2' }, { symbol: 'S3' }];
  const merged = mergeBatchSelection(priority, stalest, 4);
  assertEquals(merged.map((r) => r.symbol), ['P1', 'P2', 'S1', 'S2']);
});

Deno.test('mergeBatchSelection: dedupes by symbol, priority wins', () => {
  const priority = [{ symbol: 'X', tag: 'priority' }];
  const stalest = [{ symbol: 'X', tag: 'stalest' }, { symbol: 'Y', tag: 'stalest' }];
  const merged = mergeBatchSelection(priority, stalest, 10);
  assertEquals(merged.length, 2);
  assertEquals(merged[0], { symbol: 'X', tag: 'priority' });
  assertEquals(merged[1], { symbol: 'Y', tag: 'stalest' });
});

Deno.test('mergeBatchSelection: starvation fix — chronic-failure priority tier cannot crowd out the whole batch', () => {
  // Simulates the scenario the cap prevents: 100 chronically-failing
  // symbols in the priority pool, but only half the batch is ever drawn
  // from it, so stalest-first sweeping of the other ~14k symbols always
  // makes progress.
  const chronicFailures = Array.from({ length: 100 }, (_, i) => ({ symbol: `CF${i}` }));
  const cap = priorityCapFor(50);
  const priorityRows = chronicFailures.slice(0, cap); // caller enforces the cap via LIMIT
  const stalest = Array.from({ length: 50 }, (_, i) => ({ symbol: `N${i}` }));
  const merged = mergeBatchSelection(priorityRows, stalest, 50);
  const fromPriority = merged.filter((r) => r.symbol.startsWith('CF')).length;
  const fromStalest = merged.filter((r) => r.symbol.startsWith('N')).length;
  assertEquals(fromPriority, 25);
  assertEquals(fromStalest, 25);
});

Deno.test('mergeBatchSelection: empty priority tier — stalest fills the whole batch', () => {
  const stalest = Array.from({ length: 5 }, (_, i) => ({ symbol: `N${i}` }));
  const merged = mergeBatchSelection([], stalest, 5);
  assertEquals(merged.length, 5);
});
