// supabase/functions/historical-bars/index.ts
// Fetches historical daily bars for multiple symbols.
//
// Pagination/merge/symbol-cap decisions live in ./paginate.ts (pure, unit
// tested in paginate.test.ts) — this file is just wiring: parse+validate the
// request, drive Alpaca with a per-page timeout, shape the response.
//
// A call can make up to MAX_PAGES Alpaca requests on the budget shared with
// quote/ticker-quotes/enrich-symbols, so (ruling 2026-10-08, nothing
// scrapable) it requires a real signed-in user -- verify_jwt alone passes the
// PUBLIC anon JWT -- then a FAIL-CLOSED per-user limit, and the start date is
// held to MAX_LOOKBACK_DAYS (_shared/market-guard.ts; paginate.ts clampStart).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkRateLimits, refusalFor, REFUSAL, resolveUser } from '../_shared/market-guard.ts';
import { buildBarsUrl, capSymbols, clampStart, fetchAllBars, type PageResult } from './paginate.ts';

let requestOrigin = '';

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (origin.endsWith('.vercel.app') && origin.startsWith('https://')) return true;
  if (origin.startsWith('http://localhost:')) return true;
  return false;
}

function getCorsHeaders() {
  const allowedOrigin = isAllowedOrigin(requestOrigin) ? requestOrigin : 'https://fantasy-stock-app.vercel.app';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...getCorsHeaders() } });

function env(k: string) { return Deno.env.get(k) ?? ''; }

const BASE = 'https://data.alpaca.markets/v2';

// Alpaca's per-page max for /v2/stocks/bars.
const PAGE_LIMIT = 10000;
// Hard cap on pages per call: the worst case is 5 Alpaca requests per call,
// and the per-user limit below bounds the calls.
const MAX_PAGES = 5;
// Per-page network timeout.
const PAGE_TIMEOUT_MS = 10000;
// Total budget across all pages of one call.
const TOTAL_DEADLINE_MS = 20000;
// Symbol cap, raised from the old 20 (which silently dropped overflow with
// no signal to the caller) to 50, now WITH an explicit truncatedSymbols
// field reporting anything still dropped.
// Callers send one user's or one matchup's symbols (Home: two teams; the
// Money tab: one portfolio; the stock sheet: one symbol), well under 50.
const MAX_SYMBOLS = 50;
// Start-date floor. The longest real request is the stock sheet's 1Y chart,
// today - 400 days (apps/mobile/lib/money/useStockChartData.ts LOOKBACK_DAYS);
// +7 days of slack for client clock and timezone. Older starts are clamped
// and reported (startClamped, complete:false), never silently served.
export const MAX_LOOKBACK_DAYS = 407;
// Per-user calls per minute. Home polls once per 30 s while live; each stock
// sheet open is one call; the Money tab one more. 60 is far above a player
// and far below a bulk exporter.
export const BARS_LIMIT_PER_MIN = 60;

async function alpacaGet(url: string, key: string, secret: string, timeoutMs: number): Promise<PageResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, status: 599, preview: e instanceof Error ? e.message : 'fetch failed' };
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return { ok: false, status: res.status, preview: text.slice(0, 400) };
  }
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = {}; }
  return { ok: true, status: res.status, bars: body?.bars ?? {}, nextPageToken: body?.next_page_token ?? null };
}

Deno.serve(async (req) => {
  requestOrigin = req.headers.get('Origin') || '';

  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders() });

  // A real signed-in user, then the per-user limit, before any Alpaca call.
  const SUPABASE_URL = env('SUPABASE_URL');
  const user = await resolveUser(SUPABASE_URL, env('SB_PUBLISHABLE_KEY'), req.headers.get('Authorization'));
  if (!user) return json(REFUSAL.not_authenticated.body, REFUSAL.not_authenticated.status);
  const verdict = await checkRateLimits(createClient(SUPABASE_URL, env('SB_SECRET_KEY_INTERNAL')), 'historical-bars', [
    { subject: `user:${user.id}`, limit: BARS_LIMIT_PER_MIN },
  ]);
  if (verdict !== 'ok') {
    const r = refusalFor(verdict);
    return json(r.body, r.status);
  }

  const ALPACA_KEY = env('ALPACA_API_KEY');
  const ALPACA_SECRET = env('ALPACA_API_SECRET');

  if (!ALPACA_KEY || !ALPACA_SECRET) {
    return json({ error: 'server_config_error', message: 'Server missing Alpaca keys' }, 500);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const symbols: string[] = body?.symbols || [];
    let startDate: string = body?.start || ''; // YYYY-MM-DD
    const endDate: string = body?.end || ''; // YYYY-MM-DD (optional, defaults to today)

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return json({ error: 'missing_symbols', message: 'symbols array is required' }, 400);
    }

    if (!startDate) {
      return json({ error: 'missing_start', message: 'start date is required (YYYY-MM-DD)' }, 400);
    }

    // Reject anything that is not a plain YYYY-MM-DD date. The legitimate client
    // sends dates as `new Date(...).toISOString().split('T')[0]` (plain YYYY-MM-DD),
    // so this format is exactly what valid callers already send. Strict validation
    // stops query-metacharacters ('&', '=', '#', spaces, etc.) from being spliced
    // into the server-credentialed Alpaca request URL as extra query params.
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE_RE.test(startDate)) {
      return json({ error: 'invalid_start', message: 'start must be a date in YYYY-MM-DD format' }, 400);
    }
    if (endDate && !DATE_RE.test(endDate)) {
      return json({ error: 'invalid_end', message: 'end must be a date in YYYY-MM-DD format' }, 400);
    }

    // Hold the range to MAX_LOOKBACK_DAYS (clamped + reported, not refused).
    const clampedRange = clampStart(startDate, new Date().toISOString().slice(0, 10), MAX_LOOKBACK_DAYS);
    startDate = clampedRange.start;

    // Limit symbols to prevent abuse. Overflow is reported (truncatedSymbols)
    // instead of silently dropped.
    const { requested: limitedSymbols, truncated: truncatedSymbols } = capSymbols(symbols, MAX_SYMBOLS);

    const deadlineAt = Date.now() + TOTAL_DEADLINE_MS;

    const result = await fetchAllBars({
      requestedSymbols: limitedSymbols,
      maxPages: MAX_PAGES,
      deadlineAt,
      now: () => Date.now(),
      fetchPage: (pageToken) => {
        // Encode the date values as defense in depth: even if validation were ever
        // bypassed, encodeURIComponent prevents introducing new '&'-delimited params.
        const url = buildBarsUrl(BASE, {
          symbols: limitedSymbols,
          start: startDate,
          end: endDate || undefined,
          limit: PAGE_LIMIT,
          pageToken,
        });
        return alpacaGet(url, ALPACA_KEY, ALPACA_SECRET, PAGE_TIMEOUT_MS);
      },
    });

    if (!result.ok) {
      console.error(JSON.stringify({
        fn: 'historical-bars', level: 'error', status: result.status, preview: result.preview,
        symbols: limitedSymbols,
      }));
      // Vendor text stays in the log above; the caller gets the status only.
      return json({ error: 'alpaca_error', status: result.status }, 500);
    }

    const complete = result.stopReason === 'exhausted' && truncatedSymbols.length === 0 && !clampedRange.clamped;

    // Structured log line per call — never logs tokens or keys, only
    // symbols and outcome shape — so a page_cap/deadline hit is visible in
    // function logs even when the caller doesn't inspect the new fields.
    console.log(JSON.stringify({
      fn: 'historical-bars',
      pages: result.pages,
      stopReason: result.stopReason,
      complete,
      symbolsRequested: limitedSymbols.length,
      barCount: Object.values(result.bars).reduce((n, arr) => n + arr.length, 0),
      truncatedSymbolsCount: truncatedSymbols.length,
      incompleteSymbolsCount: result.incompleteSymbols.length,
      symbols: limitedSymbols,
    }));

    return json({
      bars: result.bars,
      complete,
      truncatedSymbols,
      incompleteSymbols: result.incompleteSymbols,
      pages: result.pages,
      stopReason: result.stopReason,
      startClamped: clampedRange.clamped,
    });
  } catch (e) {
    console.error('historical-bars error:', e);
    return json({ error: 'unhandled', message: 'An unexpected error occurred.' }, 500);
  }
});
