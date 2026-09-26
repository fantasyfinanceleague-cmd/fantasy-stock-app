/**
 * Unit tests for ./paginate.ts. Hermetic: no network, no secrets, no Deno
 * runtime APIs beyond the test framework itself — fetchAllBars takes an
 * injected fake fetchPage and an injected clock. Run from repo root with
 *   deno test supabase/functions/historical-bars/paginate.test.ts
 */

import { assertEquals } from 'jsr:@std/assert';
import {
  buildBarsUrl,
  capSymbols,
  fetchAllBars,
  type FetchPage,
  type PageResult,
} from './paginate.ts';

function bar(t: string, price = 1): Record<string, unknown> {
  return { t, o: price, h: price, l: price, c: price, v: 100 };
}

/** Builds a fetchPage that serves pre-baked pages in order, one call each. */
function fakeFetcher(pages: PageResult[]): FetchPage {
  let i = 0;
  return async (_pageToken: string | null) => {
    const page = pages[i];
    i += 1;
    return page;
  };
}

const FAR_FUTURE = 10_000_000_000_000; // never hits the deadline in these tests

// ── capSymbols ───────────────────────────────────────────────────────────────

Deno.test('capSymbols: passes through when under the cap', () => {
  const { requested, truncated } = capSymbols(['aapl', 'MSFT'], 50);
  assertEquals(requested, ['AAPL', 'MSFT']);
  assertEquals(truncated, []);
});

Deno.test('capSymbols: dedupes case-insensitively before capping', () => {
  // 'aapl' and 'AAPL' must collapse to ONE slot, not eat two of the cap.
  const { requested, truncated } = capSymbols(['aapl', 'AAPL', 'msft'], 2);
  assertEquals(requested, ['AAPL', 'MSFT']);
  assertEquals(truncated, []);
});

Deno.test('capSymbols: overflow beyond max is reported, not silently dropped', () => {
  const { requested, truncated } = capSymbols(['A', 'B', 'C', 'D'], 2);
  assertEquals(requested, ['A', 'B']);
  assertEquals(truncated, ['C', 'D']);
});

Deno.test('capSymbols: blank/whitespace entries are dropped, not counted', () => {
  const { requested } = capSymbols(['AAPL', '', '  ', 'MSFT'], 50);
  assertEquals(requested, ['AAPL', 'MSFT']);
});

// ── buildBarsUrl ─────────────────────────────────────────────────────────────

Deno.test('buildBarsUrl: encodes dates and symbols', () => {
  const url = buildBarsUrl('https://data.alpaca.markets/v2', {
    symbols: ['AAPL', 'MSFT'],
    start: '2026-01-01',
    limit: 10000,
  });
  assertEquals(
    url,
    'https://data.alpaca.markets/v2/stocks/bars?symbols=AAPL%2CMSFT&timeframe=1Day&start=2026-01-01&feed=iex&limit=10000',
  );
});

Deno.test('buildBarsUrl: page_token is present and URL-encoded (base64 can contain + / =)', () => {
  const url = buildBarsUrl('https://data.alpaca.markets/v2', {
    symbols: ['AAPL'],
    start: '2026-01-01',
    limit: 10000,
    pageToken: 'abc+def/ghi==',
  });
  assertEquals(url.includes('page_token=abc%2Bdef%2Fghi%3D%3D'), true);
});

Deno.test('buildBarsUrl: omits page_token when absent', () => {
  const url = buildBarsUrl('https://data.alpaca.markets/v2', {
    symbols: ['AAPL'],
    start: '2026-01-01',
    limit: 10000,
  });
  assertEquals(url.includes('page_token'), false);
});

Deno.test('buildBarsUrl: includes end when provided', () => {
  const url = buildBarsUrl('https://data.alpaca.markets/v2', {
    symbols: ['AAPL'],
    start: '2026-01-01',
    end: '2026-02-01',
    limit: 10000,
  });
  assertEquals(url.includes('&end=2026-02-01'), true);
});

// ── fetchAllBars ─────────────────────────────────────────────────────────────

Deno.test('fetchAllBars: single page, no next_page_token -> exhausted, complete', async () => {
  const pages: PageResult[] = [
    { ok: true, bars: { AAPL: [bar('2026-01-01'), bar('2026-01-02')] }, nextPageToken: null },
  ];
  const result = await fetchAllBars({
    requestedSymbols: ['AAPL'],
    fetchPage: fakeFetcher(pages),
    maxPages: 5,
    deadlineAt: FAR_FUTURE,
    now: () => 0,
  });
  assertEquals(result.ok, true);
  assertEquals(result.stopReason, 'exhausted');
  assertEquals(result.pages, 1);
  assertEquals(result.incompleteSymbols, []);
  assertEquals(result.bars.AAPL.length, 2);
});

Deno.test('fetchAllBars: multi-page merge concatenates bars per symbol in page order', async () => {
  const pages: PageResult[] = [
    { ok: true, bars: { AAPL: [bar('2026-01-01')], MSFT: [bar('2026-01-01')] }, nextPageToken: 'tok1' },
    { ok: true, bars: { AAPL: [bar('2026-01-02')], MSFT: [bar('2026-01-02')] }, nextPageToken: null },
  ];
  const result = await fetchAllBars({
    requestedSymbols: ['AAPL', 'MSFT'],
    fetchPage: fakeFetcher(pages),
    maxPages: 5,
    deadlineAt: FAR_FUTURE,
    now: () => 0,
  });
  assertEquals(result.stopReason, 'exhausted');
  assertEquals(result.pages, 2);
  assertEquals(result.bars.AAPL.map((b) => b.t), ['2026-01-01', '2026-01-02']);
  assertEquals(result.bars.MSFT.map((b) => b.t), ['2026-01-01', '2026-01-02']);
  assertEquals(result.incompleteSymbols, []);
});

Deno.test('fetchAllBars: page cap reached -> stopReason page_cap, flags remaining symbols incomplete', async () => {
  // 5 requested symbols, but every page only ever returns the fixed pair
  // below with a token that never runs out -> forces the cap to fire.
  const infinitePages: PageResult = {
    ok: true,
    bars: { AAPL: [bar('2026-01-01')], MSFT: [bar('2026-01-01')] },
    nextPageToken: 'always-more',
  };
  let calls = 0;
  const fetchPage: FetchPage = async () => {
    calls += 1;
    return infinitePages;
  };
  const result = await fetchAllBars({
    requestedSymbols: ['AAPL', 'MSFT', 'GOOG'],
    fetchPage,
    maxPages: 3,
    deadlineAt: FAR_FUTURE,
    now: () => 0,
  });
  assertEquals(result.stopReason, 'page_cap');
  assertEquals(result.pages, 3);
  assertEquals(calls, 3);
  // GOOG was never seen in any page; AAPL/MSFT were seen in the LAST page too.
  assertEquals(new Set(result.incompleteSymbols), new Set(['AAPL', 'MSFT', 'GOOG']));
});

Deno.test('fetchAllBars: mid-series cut across a page boundary (the BA case)', async () => {
  // Mirrors the real incident: symbol-major streaming means page 1 finishes
  // several symbols outright and cuts one (BA) partway through; everything
  // requested after BA never appears in any page.
  const pages: PageResult[] = [
    {
      ok: true,
      bars: {
        AAA: [bar('2026-01-01'), bar('2026-01-02')],
        BBB: [bar('2026-01-01'), bar('2026-01-02')],
        BA: [bar('2026-01-01')], // cut mid-series
      },
      nextPageToken: 'tok1', // Alpaca has more, but our page cap fires first
    },
  ];
  // maxPages:1 forces the cap to fire right after page 1, so BA (cut
  // mid-series) is recognized as possibly-incomplete.
  const result = await fetchAllBars({
    requestedSymbols: ['AAA', 'BBB', 'BA', 'ZZZ'],
    fetchPage: fakeFetcher(pages),
    maxPages: 1,
    deadlineAt: FAR_FUTURE,
    now: () => 0,
  });
  assertEquals(result.stopReason, 'page_cap');
  assertEquals(result.pages, 1);
  assertEquals(result.bars.BA.length, 1);
  assertEquals(result.bars.AAA.length, 2);
  // BA and ZZZ are flagged incomplete: BA appeared only in the last (only)
  // page fetched, and ZZZ was never seen at all. AAA/BBB are ALSO in the
  // last page, so per the conservative rule they're flagged too — this
  // over-reports rather than risk missing the real cut (BA).
  assertEquals(new Set(result.incompleteSymbols), new Set(['AAA', 'BBB', 'BA', 'ZZZ']));
});

Deno.test('fetchAllBars: deadline hit before exhausting pages', async () => {
  const pages: PageResult[] = [
    { ok: true, bars: { AAPL: [bar('2026-01-01')] }, nextPageToken: 'tok1' },
  ];
  let calls = 0;
  const clock = { t: 0 };
  const fetchPage: FetchPage = async () => {
    calls += 1;
    clock.t = 999_999; // simulate time passing during the request
    return pages[0];
  };
  const result = await fetchAllBars({
    requestedSymbols: ['AAPL', 'MSFT'],
    fetchPage,
    maxPages: 5,
    deadlineAt: 500_000,
    now: () => clock.t,
  });
  assertEquals(calls, 1);
  assertEquals(result.stopReason, 'deadline');
  assertEquals(result.pages, 1);
  assertEquals(new Set(result.incompleteSymbols), new Set(['AAPL', 'MSFT']));
});

Deno.test('fetchAllBars: empty response (no bars for any symbol) -> exhausted, empty bars, no error', async () => {
  const pages: PageResult[] = [
    { ok: true, bars: {}, nextPageToken: null },
  ];
  const result = await fetchAllBars({
    requestedSymbols: ['AAPL'],
    fetchPage: fakeFetcher(pages),
    maxPages: 5,
    deadlineAt: FAR_FUTURE,
    now: () => 0,
  });
  assertEquals(result.ok, true);
  assertEquals(result.stopReason, 'exhausted');
  assertEquals(result.bars, {});
  assertEquals(result.incompleteSymbols, []);
});

Deno.test('fetchAllBars: page 1 fetch error -> ok:false, caller should 500, nothing salvaged', async () => {
  const pages: PageResult[] = [
    { ok: false, status: 500, preview: 'alpaca down' },
  ];
  const result = await fetchAllBars({
    requestedSymbols: ['AAPL', 'MSFT'],
    fetchPage: fakeFetcher(pages),
    maxPages: 5,
    deadlineAt: FAR_FUTURE,
    now: () => 0,
  });
  assertEquals(result.ok, false);
  assertEquals(result.status, 500);
  assertEquals(result.preview, 'alpaca down');
  assertEquals(result.bars, {});
  assertEquals(result.pages, 0);
});

Deno.test('fetchAllBars: page 2+ fetch error -> ok:true with partial bars salvaged, not a 500', async () => {
  const pages: PageResult[] = [
    { ok: true, bars: { AAPL: [bar('2026-01-01')] }, nextPageToken: 'tok1' },
    { ok: false, status: 502, preview: 'timeout' },
  ];
  const result = await fetchAllBars({
    requestedSymbols: ['AAPL', 'MSFT'],
    fetchPage: fakeFetcher(pages),
    maxPages: 5,
    deadlineAt: FAR_FUTURE,
    now: () => 0,
  });
  assertEquals(result.ok, true);
  assertEquals(result.stopReason, 'page_error');
  assertEquals(result.pages, 1);
  assertEquals(result.bars.AAPL.length, 1);
  assertEquals(new Set(result.incompleteSymbols), new Set(['AAPL', 'MSFT']));
});
