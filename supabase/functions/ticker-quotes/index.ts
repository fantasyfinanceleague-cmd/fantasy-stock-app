// supabase/functions/ticker-quotes/index.ts
// Quotes for the web ticker tape (anonymous) and for signed-in mobile screens
// (usePortfolio, the stock sheet), on the shared server-side Alpaca key.
//
// verify_jwt = false (config.toml explains why: the web ticker can render before
// <Protected> resolves), so THIS HANDLER is the whole boundary. Ruling
// 2026-10-08, nothing scrapable:
//   * a real signed-in user (getUser) may quote any symbol, under a fail-closed
//     per-user limit;
//   * an anonymous caller may quote ONLY the ticker tape's own symbols
//     (TICKER_SYMBOLS, pinned equal to apps/web/src/Ticker.jsx by a test), under
//     a fail-closed per-IP limit;
//   * anything else is 401, before any cache read or Alpaca call.
// Alpaca error text is never returned.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkRateLimits, clientIp, refusalFor, REFUSAL, resolveUser } from '../_shared/market-guard.ts';

/** EXACTLY the web ticker tape's SYMBOLS (apps/web/src/Ticker.jsx); a test
 * fails if the two drift. The only symbols an anonymous caller can quote. */
export const TICKER_SYMBOLS: readonly string[] = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'NFLX', 'V',
  'JPM', 'UNH', 'HD', 'MA', 'DIS', 'PFE', 'T', 'KO', 'PEP', 'INTC', 'CRM', 'BABA',
];
// Per IP per minute, anonymous. The tape fetches 10 symbols once a minute per
// open tab; 60 allows six tabs behind one address.
export const ANON_LIMIT_PER_IP_PER_MIN = 60;
// Per user per minute, signed in. usePortfolio quotes each held symbol (3 at a
// time, 2-minute cache) and each stock-sheet open is one call.
export const USER_LIMIT_PER_MIN = 120;

let requestOrigin = '';

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  // Allow any vercel.app subdomain (production and previews)
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

// Simple in-memory cache for ticker quotes (longer TTL since it's display only)
const quoteCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds for ticker

function getCachedQuote(symbol: string): any | null {
  const cached = quoteCache.get(symbol.toUpperCase());
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return cached.data;
  }
  return null;
}

function setCachedQuote(symbol: string, data: any): void {
  quoteCache.set(symbol.toUpperCase(), { data, timestamp: Date.now() });
  // Clean up old entries periodically
  if (quoteCache.size > 50) {
    const now = Date.now();
    for (const [key, value] of quoteCache.entries()) {
      if (now - value.timestamp > CACHE_TTL_MS) {
        quoteCache.delete(key);
      }
    }
  }
}

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

Deno.serve(async (req) => {
  requestOrigin = req.headers.get('Origin') || '';

  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders() });

  // Server-side Alpaca keys (for read-only market data)
  const ALPACA_KEY = env('ALPACA_API_KEY');
  const ALPACA_SECRET = env('ALPACA_API_SECRET');

  if (!ALPACA_KEY || !ALPACA_SECRET) {
    return json({ error: 'server_config_error', message: 'Server missing Alpaca keys' }, 500);
  }

  try {
    // GET ?symbol= or POST {symbol}
    let symbol = '';
    if (req.method === 'GET') {
      const u = new URL(req.url);
      symbol = (u.searchParams.get('symbol') || '').trim().toUpperCase();
    } else if (req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      symbol = String(b?.symbol || '').trim().toUpperCase();
    } else {
      return json({ error: 'method_not_allowed' }, 405);
    }

    if (!symbol) return json({ error: 'missing_symbol' }, 400);

    // The guard, before the cache and before Alpaca.
    const SUPABASE_URL = env('SUPABASE_URL');
    const user = await resolveUser(SUPABASE_URL, env('SB_PUBLISHABLE_KEY'), req.headers.get('Authorization'));
    if (!user && !TICKER_SYMBOLS.includes(symbol)) {
      return json(REFUSAL.not_authenticated.body, REFUSAL.not_authenticated.status);
    }
    const admin = createClient(SUPABASE_URL, env('SB_SECRET_KEY_INTERNAL'));
    const verdict = user
      ? await checkRateLimits(admin, 'ticker-quotes', [{ subject: `user:${user.id}`, limit: USER_LIMIT_PER_MIN }])
      : await checkRateLimits(admin, 'ticker-quotes-anon', [
        { subject: `ip:${clientIp(req) || 'unknown'}`, limit: ANON_LIMIT_PER_IP_PER_MIN },
      ]);
    if (verdict !== 'ok') {
      const r = refusalFor(verdict);
      return json(r.body, r.status);
    }

    // Check cache first
    const cached = getCachedQuote(symbol);
    if (cached) {
      return json({ ...cached, cached: true });
    }

    // Always request the free IEX feed
    const feedQS = `?feed=iex`;

    let price: number | null = null;
    let source = '';
    let lastErr: any = null;

    // 1) latest trade - most reliable source in IEX feed
    {
      const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/trades/latest${feedQS}`;
      const r = await alpacaGet(url, ALPACA_KEY, ALPACA_SECRET);
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
      const r = await alpacaGet(url, ALPACA_KEY, ALPACA_SECRET);
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
      const r = await alpacaGet(url, ALPACA_KEY, ALPACA_SECRET);
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

    if (price == null) return json({ error: 'no_price', symbol, lastErr }, 404);

    // 4) Fetch previous day's close for percent change calculation
    let prevClose: number | null = null;
    let todayOpen: number | null = null;
    {
      const snapshotUrl = `${BASE}/stocks/${encodeURIComponent(symbol)}/snapshot${feedQS}`;
      const snapR = await alpacaGet(snapshotUrl, ALPACA_KEY, ALPACA_SECRET);

      if (snapR.ok && snapR.body) {
        const prevBar = snapR.body?.prevDailyBar;
        const dailyBar = snapR.body?.dailyBar;

        if (prevBar) {
          const c = Number(prevBar?.c);
          if (Number.isFinite(c) && c > 0) prevClose = c;
        }

        if (dailyBar) {
          const o = Number(dailyBar?.o);
          if (Number.isFinite(o) && o > 0) todayOpen = o;
        }
      }

      // Fallback: fetch last 5 daily bars if snapshot didn't give us prevClose
      if (prevClose == null) {
        const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Day&limit=5${feedQS.replace('?', '&')}`;
        const r = await alpacaGet(url, ALPACA_KEY, ALPACA_SECRET);

        let barsArray: any[] = [];
        if (r.ok && r.body?.bars) {
          if (Array.isArray(r.body.bars)) {
            barsArray = r.body.bars;
          } else if (r.body.bars[symbol] && Array.isArray(r.body.bars[symbol])) {
            barsArray = r.body.bars[symbol];
          }
        }

        if (barsArray.length >= 2) {
          const prevBar = barsArray[barsArray.length - 2];
          const c = Number(prevBar?.c);
          if (Number.isFinite(c) && c > 0) prevClose = c;

          if (todayOpen == null) {
            const todayBar = barsArray[barsArray.length - 1];
            const o = Number(todayBar?.o);
            if (Number.isFinite(o) && o > 0) todayOpen = o;
          }
        }
      }
    }

    // Calculate percent change
    let changePercent: number | null = null;
    if (prevClose != null && price != null && prevClose > 0) {
      changePercent = ((price - prevClose) / prevClose) * 100;
    } else if (todayOpen != null && price != null && todayOpen > 0) {
      changePercent = ((price - todayOpen) / todayOpen) * 100;
    }

    // Cache the successful result
    const result = { symbol, price, source, prevClose, todayOpen, changePercent };
    setCachedQuote(symbol, result);

    return json(result);
  } catch (e) {
    console.error('ticker-quotes error:', e);
    return json({ error: 'unhandled', message: 'An unexpected error occurred.' }, 500);
  }
});
