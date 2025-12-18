// supabase/functions/ticker-quotes/index.ts
// Public endpoint for ticker display - uses server-side Alpaca keys
// This is read-only market data, safe to serve without per-user auth
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

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

    // 1) latest quote
    {
      const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/quotes/latest${feedQS}`;
      const r = await alpacaGet(url, ALPACA_KEY, ALPACA_SECRET);
      if (r.ok) {
        const ap = Number(r.body?.quote?.ap);
        const bp = Number(r.body?.quote?.bp);
        if (Number.isFinite(ap) && ap > 0) { price = ap; source = 'quote.ap'; }
        else if (Number.isFinite(bp) && bp > 0) { price = bp; source = 'quote.bp'; }
      } else {
        lastErr = { step: 'quote', status: r.status, preview: r.preview };
      }
    }

    // 2) latest trade
    if (price == null) {
      const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/trades/latest${feedQS}`;
      const r = await alpacaGet(url, ALPACA_KEY, ALPACA_SECRET);
      if (r.ok) {
        const p = Number(r.body?.trade?.p);
        if (Number.isFinite(p) && p > 0) { price = p; source = 'trade.p'; }
      } else {
        lastErr = { step: 'trade', status: r.status, preview: r.preview };
      }
    }

    // 3) latest bar close
    if (price == null) {
      const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/bars/latest${feedQS}`;
      const r = await alpacaGet(url, ALPACA_KEY, ALPACA_SECRET);
      if (r.ok) {
        const c = Number(r.body?.bar?.c);
        if (Number.isFinite(c) && c > 0) { price = c; source = 'bar.c'; }
      } else {
        lastErr = { step: 'bar', status: r.status, preview: r.preview };
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
