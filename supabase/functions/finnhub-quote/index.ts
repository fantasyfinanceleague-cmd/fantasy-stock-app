// supabase/functions/finnhub-quote/index.ts
// Secure endpoint for Finnhub quote lookups - keeps API key server-side
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

// Simple in-memory cache
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
  if (quoteCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of quoteCache.entries()) {
      if (now - value.timestamp > CACHE_TTL_MS) {
        quoteCache.delete(key);
      }
    }
  }
}

Deno.serve(async (req) => {
  requestOrigin = req.headers.get('Origin') || '';

  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders() });

  const FINNHUB_API_KEY = env('FINNHUB_API_KEY');

  if (!FINNHUB_API_KEY) {
    return json({ error: 'server_config_error', message: 'Server missing Finnhub API key' }, 500);
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

    // Fetch from Finnhub
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`
    );

    if (!res.ok) {
      return json({ error: 'finnhub_error', status: res.status }, res.status);
    }

    const data = await res.json();

    // Finnhub returns { c: current, h: high, l: low, o: open, pc: previous close, t: timestamp }
    if (!Number.isFinite(data?.c) || data.c === 0) {
      return json({ error: 'no_price', symbol }, 404);
    }

    const result = {
      symbol,
      price: data.c,
      high: data.h,
      low: data.l,
      open: data.o,
      prevClose: data.pc,
      changePercent: data.pc > 0 ? ((data.c - data.pc) / data.pc) * 100 : null,
    };

    setCachedQuote(symbol, result);

    return json(result);
  } catch (e) {
    console.error('finnhub-quote error:', e);
    return json({ error: 'unhandled', message: 'An unexpected error occurred.' }, 500);
  }
});
