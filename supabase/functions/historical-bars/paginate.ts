/**
 * Pure pagination + symbol-cap logic for historical-bars. Extracted from the
 * Deno.serve handler so the merge/stop decisions can be unit-tested with no
 * network, no secrets, and no Deno runtime APIs — the same hermetic pattern
 * as ../process-week-results/grouping.ts. See paginate.test.ts.
 *
 * RISK CARRIED BY THIS CHANGE (state this plainly, don't bury it): before
 * this fix, every historical-bars call made exactly ONE Alpaca request.
 * After it, a call can make up to MAX_PAGES (5) requests. This function has
 * no per-user or per-IP rate limit (see supabase/config.toml's note on
 * ticker-quotes for the one function on this Alpaca key that does), and it
 * shares Alpaca's Basic-plan 200-req/min budget with quote, ticker-quotes
 * and enrich-symbols. A 5x-worse-case caller here is now a bigger neighbor
 * to those functions than it used to be. A follow-up should add a per-user
 * limiter (the record-trade / join-league check_and_bump_rate_limit
 * pattern) — deliberately NOT added in this branch, to keep this change to
 * the bug it fixes. DONE 2026-10-08 (security/market-data-guards): index.ts now
 * requires a signed-in user, a fail-closed per-user limit, and clampStart.
 *
 * THE BUG THIS FIXES: the old handler made ONE request with limit=1000.
 * Alpaca's `limit` on /v2/stocks/bars caps the TOTAL bar count across ALL
 * requested symbols, not per symbol, and a real multi-symbol account got
 * back 5 symbols' full series plus one symbol (BA) cut mid-series at the
 * 1000-bar boundary, with every symbol after that getting NOTHING. See
 * CLAUDE.md "Success signals in this codebase are unreliable" and
 * docs/STATUS.md for the incident.
 *
 * SYMBOL-MAJOR ASSUMPTION: incompleteSymbols below assumes Alpaca streams
 * bars symbol-major — i.e. it emits ALL bars for one symbol (in time order)
 * before starting the next symbol, rather than interleaving symbols by
 * date. This is an OBSERVED behavior, not a documented Alpaca contract: the
 * evidence is the 2026-09-26 real-account cut (5 symbols x 197 bars, then
 * BA x 15 bars, then nothing — a clean per-symbol boundary, not bars from
 * every symbol thinned proportionally). If Alpaca ever interleaves symbols
 * across a page boundary instead, incompleteSymbols would under- or
 * over-report which symbols got a partial series — but `bars` itself is
 * still exactly what Alpaca returned, so no returned data is ever wrong or
 * silently dropped. Only the PRECISION of the "which symbols might be
 * incomplete" hint would degrade, never data correctness.
 */

export interface BarRow {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type BarsBySymbol = Record<string, BarRow[]>;

// ── Symbol cap ──────────────────────────────────────────────────────────────

export interface CapSymbolsResult {
  requested: string[];
  truncated: string[];
}

/**
 * Pure. Normalizes (trim + uppercase), dedupes, then caps at `max`. Dedupe
 * happens BEFORE capping so duplicate symbols can't eat cap slots that a
 * distinct symbol would otherwise get.
 */
export function capSymbols(symbols: string[], max: number): CapSymbolsResult {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const raw of symbols) {
    const s = String(raw ?? '').trim().toUpperCase();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    deduped.push(s);
  }
  return { requested: deduped.slice(0, max), truncated: deduped.slice(max) };
}

// ── URL building ─────────────────────────────────────────────────────────────

// ── Date-range cap ─────────────────────────────────────────────────────────

export interface ClampStartResult {
  start: string;
  clamped: boolean;
}

/**
 * Pure. Holds `start` (YYYY-MM-DD, already validated) to no earlier than
 * `maxDays` calendar days before `todayIso` (YYYY-MM-DD, UTC). An over-long
 * request is CLAMPED and reported (clamped: true), not refused: the caller
 * still gets a correct series, just shorter, and says so.
 */
export function clampStart(start: string, todayIso: string, maxDays: number): ClampStartResult {
  const floor = new Date(`${todayIso}T00:00:00Z`);
  floor.setUTCDate(floor.getUTCDate() - maxDays);
  const floorIso = floor.toISOString().slice(0, 10);
  return start < floorIso ? { start: floorIso, clamped: true } : { start, clamped: false };
}

export interface BuildBarsUrlParams {
  symbols: string[];
  start: string;
  end?: string;
  limit: number;
  pageToken?: string | null;
}

/**
 * Pure. Mirrors the original handler's defense-in-depth encoding: every
 * value that lands in the query string is encodeURIComponent'd, including
 * the Alpaca-issued page_token, which is base64 and can contain '+' / '/' /
 * '=' — unencoded, a '+' would decode as a space and break the next request.
 */
export function buildBarsUrl(base: string, params: BuildBarsUrlParams): string {
  let url = `${base}/stocks/bars?symbols=${encodeURIComponent(params.symbols.join(','))}` +
    `&timeframe=1Day&start=${encodeURIComponent(params.start)}&feed=iex`;
  if (params.end) {
    url += `&end=${encodeURIComponent(params.end)}`;
  }
  url += `&limit=${params.limit}`;
  if (params.pageToken) {
    url += `&page_token=${encodeURIComponent(params.pageToken)}`;
  }
  return url;
}

// ── Pagination / merge ──────────────────────────────────────────────────────

export interface PageResult {
  ok: boolean;
  status?: number;
  preview?: string;
  /** Raw Alpaca `bars` map for this page: symbol -> array of raw bar objects. */
  bars?: Record<string, Array<Record<string, unknown>>>;
  nextPageToken?: string | null;
}

export type FetchPage = (pageToken: string | null) => Promise<PageResult>;

export type StopReason = 'exhausted' | 'page_cap' | 'deadline' | 'page_error';

export interface FetchAllBarsOptions {
  /** Symbols actually sent to Alpaca (post-cap). Used to compute incompleteSymbols. */
  requestedSymbols: string[];
  fetchPage: FetchPage;
  maxPages: number;
  /** Absolute epoch-ms deadline for the whole multi-page run. */
  deadlineAt: number;
  /** Injected clock so tests don't depend on wall time. */
  now: () => number;
}

export interface FetchAllBarsResult {
  /** false only when the FIRST page fetch itself failed (caller should 500). */
  ok: boolean;
  status?: number;
  preview?: string;
  bars: BarsBySymbol;
  pages: number;
  stopReason: StopReason;
  /**
   * Symbols whose series may be incomplete: every symbol seen only in the
   * last page fetched (may have been cut mid-series) plus every requested
   * symbol never seen in any page (never reached before the run stopped).
   * Always [] when stopReason === 'exhausted'.
   */
  incompleteSymbols: string[];
}

function toBarRow(raw: Record<string, unknown>): BarRow {
  return {
    t: String(raw.t),
    o: Number(raw.o),
    h: Number(raw.h),
    l: Number(raw.l),
    c: Number(raw.c),
    v: Number(raw.v),
  };
}

/**
 * Pure orchestration: follows next_page_token up to maxPages or deadlineAt,
 * merging each page's bars per symbol in page order. No network, no timers
 * — `fetchPage` and `now` are both injected so this is fully hermetic.
 */
export async function fetchAllBars(options: FetchAllBarsOptions): Promise<FetchAllBarsResult> {
  const { requestedSymbols, fetchPage, maxPages, deadlineAt, now } = options;

  const bars: BarsBySymbol = {};
  const seenSymbols = new Set<string>();
  let lastPageSymbols: string[] = [];
  let pages = 0;
  let pageToken: string | null = null;
  let stopReason: StopReason = 'exhausted';

  while (true) {
    if (pages >= maxPages) {
      stopReason = 'page_cap';
      break;
    }
    if (now() >= deadlineAt) {
      stopReason = 'deadline';
      break;
    }

    const page = await fetchPage(pageToken);

    if (!page.ok) {
      if (pages === 0) {
        // First page failed outright: nothing to salvage, caller returns 500.
        return {
          ok: false,
          status: page.status,
          preview: page.preview,
          bars: {},
          pages: 0,
          stopReason: 'page_error',
          incompleteSymbols: [...requestedSymbols],
        };
      }
      stopReason = 'page_error';
      break;
    }

    pages += 1;
    const pageSymbols: string[] = [];
    const rawBars = page.bars ?? {};
    for (const symbol of requestedSymbols) {
      const symbolBars = rawBars[symbol];
      if (Array.isArray(symbolBars) && symbolBars.length > 0) {
        const mapped = symbolBars.map(toBarRow);
        bars[symbol] = bars[symbol] ? bars[symbol].concat(mapped) : mapped;
        pageSymbols.push(symbol);
        seenSymbols.add(symbol);
      }
    }
    lastPageSymbols = pageSymbols;

    if (!page.nextPageToken) {
      stopReason = 'exhausted';
      break;
    }
    pageToken = page.nextPageToken;
  }

  const incompleteSymbols = stopReason === 'exhausted'
    ? []
    : dedupeInOrder([
      ...lastPageSymbols,
      ...requestedSymbols.filter((s) => !seenSymbols.has(s)),
    ]);

  return { ok: true, bars, pages, stopReason, incompleteSymbols };
}

function dedupeInOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
