// supabase/functions/quote/index.ts
// Normalized latest-price endpoint for in-app quotes (single or batch).
// Uses Stockpile's own server-side Alpaca keys (ALPACA_API_KEY / ALPACA_API_SECRET) —
// the same app-wide data-vendor path as ticker-quotes. No per-user broker credentials.
// Gateway verify_jwt=true is NOT a sign-in check (the public anon JWT passes
// it), so the handler requires a real user via getUser, then a FAIL-CLOSED
// per-user rate limit (_shared/market-guard.ts). Ruling 2026-10-08: nothing
// scrapable.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { capSymbolList, checkRateLimits, refusalFor, REFUSAL, resolveUser } from '../_shared/market-guard.ts';

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  // Allow any vercel.app subdomain (production and previews)
  if (origin.endsWith('.vercel.app') && origin.startsWith('https://')) return true;
  // Allow localhost for development
  if (origin.startsWith('http://localhost:')) return true;
  return false;
}

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowedOrigin = isAllowedOrigin(origin) ? origin : 'https://fantasy-stock-app.vercel.app';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

const DEFAULT_CORS = {
  'Access-Control-Allow-Origin': 'https://fantasy-stock-app.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const json = (b: unknown, s = 200, req?: Request) => {
  const headers = req ? getCorsHeaders(req) : DEFAULT_CORS;
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...headers } });
};

const BASE = 'https://data.alpaca.markets/v2';

// Per-user calls per minute. The heaviest real caller is web PriceContext,
// which prices one symbol per call (3 concurrent, 5-minute poll): a first
// Dashboard load is about one call per held symbol across the user's leagues.
// Mobile batches (Home polls one batch every 30 s). 120/min covers a player in
// five full leagues with room to spare; a scraper gets 120 calls, not unlimited.
export const QUOTE_LIMIT_PER_MIN = 120;
// Batch cap. The largest real batch is useAllMatchups: every symbol held in one
// league-week. leagues_num_participants_range caps a league at 16 teams and
// Create offers at most 12 rounds, so 16 x 12 = 192 drafted symbols, plus the
// week's traded-in symbols. 250 covers that; ~50 would silently drop prices on
// the all-matchups screen of any league bigger than about 4 teams x 12 rounds.
// Overflow is reported in truncatedSymbols, never silently dropped.
export const MAX_BATCH_SYMBOLS = 250;

// Simple in-memory cache for quotes (survives across requests in the same worker)
const quoteCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

function getCachedQuote(symbol: string): any | null {
  const cached = quoteCache.get(symbol.toUpperCase());
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return cached.data;
  }
  return null;
}

function setCachedQuote(symbol: string, data: any): void {
  quoteCache.set(symbol.toUpperCase(), { data, timestamp: Date.now() });
  // Clean up old entries periodically (keep cache size reasonable)
  if (quoteCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of quoteCache.entries()) {
      if (now - value.timestamp > CACHE_TTL_MS) {
        quoteCache.delete(key);
      }
    }
  }
}

function env(k: string) { return Deno.env.get(k) ?? ''; }

async function alpacaGet(url: string, key: string, secret: string) {
  const res = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret,
      'Accept': 'application/json',
    },
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return { ok: false as const, status: res.status, preview: text.slice(0, 400) };
  }
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = {}; }
  return { ok: true as const, status: res.status, body };
}

// Fetch price for a single symbol (shared logic)
async function fetchSinglePrice(
  symbol: string,
  key: string,
  secret: string
): Promise<{ price: number | null; source: string; error?: any }> {
  const feedQS = `?feed=iex`;
  let price: number | null = null;
  let source = '';
  let lastErr: any = null;

  // 1) latest trade - most reliable source in IEX feed
  {
    const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/trades/latest${feedQS}`;
    const r = await alpacaGet(url, key, secret);
    if (r.ok) {
      const p = Number(r.body?.trade?.p);
      if (Number.isFinite(p) && p > 0) { price = p; source = 'trade.p'; }
    } else {
      lastErr = { step: 'trade', status: r.status };
    }
  }

  // 2) latest bar close
  if (price == null) {
    const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/bars/latest${feedQS}`;
    const r = await alpacaGet(url, key, secret);
    if (r.ok) {
      const c = Number(r.body?.bar?.c);
      if (Number.isFinite(c) && c > 0) { price = c; source = 'bar.c'; }
    } else {
      lastErr = { step: 'bar', status: r.status };
    }
  }

  // 3) latest quote (bid/ask) - only as fallback since IEX quotes can be stale
  if (price == null) {
    const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/quotes/latest${feedQS}`;
    const r = await alpacaGet(url, key, secret);
    if (r.ok) {
      const ap = Number(r.body?.quote?.ap);
      const bp = Number(r.body?.quote?.bp);
      // Use bid price as it's typically more reliable than ask in IEX
      if (Number.isFinite(bp) && bp > 0) { price = bp; source = 'quote.bp'; }
      else if (Number.isFinite(ap) && ap > 0) { price = ap; source = 'quote.ap'; }
    } else {
      lastErr = { step: 'quote', status: r.status };
    }
  }

  return { price, source, error: lastErr };
}

// Handle request for multiple symbols - returns { prices: { SYMBOL: price, ... } }
async function handleMultipleSymbols(
  symbols: string[],
  truncatedSymbols: string[],
  key: string,
  secret: string,
  respond: (b: unknown, s?: number) => Response
): Promise<Response> {
  const prices: Record<string, number> = {};
  const errors: Record<string, any> = {};

  // Check cache and fetch missing prices
  const uncachedSymbols: string[] = [];
  for (const sym of symbols) {
    const cached = getCachedQuote(sym);
    if (cached?.price != null) {
      prices[sym] = cached.price;
    } else {
      uncachedSymbols.push(sym);
    }
  }

  // Fetch uncached symbols in parallel (limit concurrency to avoid rate limits)
  const BATCH_SIZE = 5;
  for (let i = 0; i < uncachedSymbols.length; i += BATCH_SIZE) {
    const batch = uncachedSymbols.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(sym => fetchSinglePrice(sym, key, secret).then(r => ({ sym, ...r })))
    );

    for (const { sym, price, source, error } of results) {
      if (price != null) {
        prices[sym] = price;
        setCachedQuote(sym, { symbol: sym, price, source });
      } else if (error) {
        errors[sym] = error;
      }
    }
  }

  return respond({
    prices,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
    truncatedSymbols: truncatedSymbols.length > 0 ? truncatedSymbols : undefined,
  });
}

Deno.serve(async (req) => {
  // Helper to return JSON with proper CORS headers for this request
  const respond = (b: unknown, s = 200) => json(b, s, req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  // A real signed-in user, then the per-user limit -- before any cache read or
  // Alpaca call, so a refused caller learns nothing and spends nothing.
  const SUPABASE_URL = env('SUPABASE_URL');
  const user = await resolveUser(SUPABASE_URL, env('SB_PUBLISHABLE_KEY'), req.headers.get('Authorization'));
  if (!user) return respond(REFUSAL.not_authenticated.body, REFUSAL.not_authenticated.status);
  const admin = createClient(SUPABASE_URL, env('SB_SECRET_KEY_INTERNAL'));
  const verdict = await checkRateLimits(admin, 'quote', [{ subject: `user:${user.id}`, limit: QUOTE_LIMIT_PER_MIN }]);
  if (verdict !== 'ok') {
    const r = refusalFor(verdict);
    return respond(r.body, r.status);
  }

  // Server-side Alpaca keys (app-wide read-only market data — no per-user credentials)
  const ALPACA_KEY = env('ALPACA_API_KEY');
  const ALPACA_SECRET = env('ALPACA_API_SECRET');

  if (!ALPACA_KEY || !ALPACA_SECRET) {
    return respond({ error: 'server_config_error', message: 'Server missing Alpaca keys' }, 500);
  }

  try {
    // GET ?symbol= or POST {symbol} or POST {symbols: [...]}
    let symbol = '';
    let symbols: string[] = [];
    let truncatedSymbols: string[] = [];
    if (req.method === 'GET') {
      const u = new URL(req.url);
      symbol = (u.searchParams.get('symbol') || '').trim().toUpperCase();
    } else if (req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      // Support both single symbol and array of symbols
      if (Array.isArray(b?.symbols)) {
        ({ symbols, truncated: truncatedSymbols } = capSymbolList(b.symbols, MAX_BATCH_SYMBOLS));
      } else {
        symbol = String(b?.symbol || '').trim().toUpperCase();
      }
    } else {
      return respond({ error: 'method_not_allowed' }, 405);
    }

    // Handle multi-symbol request
    if (symbols.length > 0) {
      return await handleMultipleSymbols(symbols, truncatedSymbols, ALPACA_KEY, ALPACA_SECRET, respond);
    }

    if (!symbol) return respond({ error: 'missing_symbol' }, 400);

    // Check cache first
    const cached = getCachedQuote(symbol);
    if (cached) {
      return respond({ ...cached, cached: true });
    }

    const key = ALPACA_KEY;
    const secret = ALPACA_SECRET;

    // Always request the free IEX feed
    const feedQS = `?feed=iex`;

    let price: number | null = null;
    let source = '';
    let lastErr: any = null;

    // 1) latest trade - most reliable source in IEX feed
    {
      const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/trades/latest${feedQS}`;
      const r = await alpacaGet(url, key, secret);
      if (r.ok) {
        const p = Number(r.body?.trade?.p);
        if (Number.isFinite(p) && p > 0) { price = p; source = 'trade.p'; }
      } else {
        lastErr = { step: 'trade', status: r.status };
      }
    }

    // 2) latest bar close
    if (price == null) {
      const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/bars/latest${feedQS}`;
      const r = await alpacaGet(url, key, secret);
      if (r.ok) {
        const c = Number(r.body?.bar?.c);
        if (Number.isFinite(c) && c > 0) { price = c; source = 'bar.c'; }
      } else {
        lastErr = { step: 'bar', status: r.status };
      }
    }

    // 3) latest quote (bid/ask) - only as fallback since IEX quotes can be stale
    if (price == null) {
      const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/quotes/latest${feedQS}`;
      const r = await alpacaGet(url, key, secret);
      if (r.ok) {
        const ap = Number(r.body?.quote?.ap);
        const bp = Number(r.body?.quote?.bp);
        // Use bid price as it's typically more reliable than ask in IEX
        if (Number.isFinite(bp) && bp > 0) { price = bp; source = 'quote.bp'; }
        else if (Number.isFinite(ap) && ap > 0) { price = ap; source = 'quote.ap'; }
      } else {
        lastErr = { step: 'quote', status: r.status };
      }
    }

    if (price == null) return respond({ error: 'no_price', symbol, lastErr }, 404);

    // 4) Fetch previous day's close for percent change calculation
    let prevClose: number | null = null;
    let todayOpen: number | null = null;
    {
      // Try snapshot endpoint first - it directly gives us prevDailyBar
      const snapshotUrl = `${BASE}/stocks/${encodeURIComponent(symbol)}/snapshot${feedQS}`;
      const snapR = await alpacaGet(snapshotUrl, key, secret);

      if (snapR.ok && snapR.body) {
        // Snapshot provides prevDailyBar with previous trading day's OHLC
        const prevBar = snapR.body?.prevDailyBar;
        const dailyBar = snapR.body?.dailyBar;

        if (prevBar) {
          const c = Number(prevBar?.c);
          if (Number.isFinite(c) && c > 0) prevClose = c;
        }

        // Also get today's open for intraday change calculation
        if (dailyBar) {
          const o = Number(dailyBar?.o);
          if (Number.isFinite(o) && o > 0) todayOpen = o;
        }
      }

      // Fallback: fetch last 5 daily bars if snapshot didn't give us prevClose
      if (prevClose == null) {
        const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Day&limit=5${feedQS.replace('?', '&')}`;
        const r = await alpacaGet(url, key, secret);

        let barsArray: any[] = [];
        if (r.ok && r.body?.bars) {
          if (Array.isArray(r.body.bars)) {
            barsArray = r.body.bars;
          } else if (r.body.bars[symbol] && Array.isArray(r.body.bars[symbol])) {
            barsArray = r.body.bars[symbol];
          }
        }

        // Bars are sorted ascending by time
        // If we have at least 2 bars, use second-to-last (previous completed day)
        if (barsArray.length >= 2) {
          const prevBar = barsArray[barsArray.length - 2];
          const c = Number(prevBar?.c);
          if (Number.isFinite(c) && c > 0) prevClose = c;

          // Get today's open from the last bar
          if (todayOpen == null) {
            const todayBar = barsArray[barsArray.length - 1];
            const o = Number(todayBar?.o);
            if (Number.isFinite(o) && o > 0) todayOpen = o;
          }
        }
      }
    }

    // Calculate percent change
    // Prefer: (current price - previous close) / previous close
    // This is the standard "daily change" shown on financial sites
    let changePercent: number | null = null;
    if (prevClose != null && price != null && prevClose > 0) {
      changePercent = ((price - prevClose) / prevClose) * 100;
    } else if (todayOpen != null && price != null && todayOpen > 0) {
      // Fallback: calculate from today's open
      changePercent = ((price - todayOpen) / todayOpen) * 100;
    }

    // Cache the successful result
    const result = { symbol, price, source, prevClose, todayOpen, changePercent };
    setCachedQuote(symbol, result);

    return respond(result);
  } catch (e) {
    return respond({ error: 'unhandled', message: 'An unexpected error occurred. Please try again.' }, 500);
  }
});
