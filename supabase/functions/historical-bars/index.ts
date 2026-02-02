// supabase/functions/historical-bars/index.ts
// Fetches historical daily bars for multiple symbols
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

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

  const ALPACA_KEY = env('ALPACA_API_KEY');
  const ALPACA_SECRET = env('ALPACA_API_SECRET');

  if (!ALPACA_KEY || !ALPACA_SECRET) {
    return json({ error: 'server_config_error', message: 'Server missing Alpaca keys' }, 500);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const symbols: string[] = body?.symbols || [];
    const startDate: string = body?.start || ''; // YYYY-MM-DD
    const endDate: string = body?.end || ''; // YYYY-MM-DD (optional, defaults to today)

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return json({ error: 'missing_symbols', message: 'symbols array is required' }, 400);
    }

    if (!startDate) {
      return json({ error: 'missing_start', message: 'start date is required (YYYY-MM-DD)' }, 400);
    }

    // Limit symbols to prevent abuse
    const maxSymbols = 20;
    const limitedSymbols = symbols.slice(0, maxSymbols).map(s => String(s).trim().toUpperCase());

    // Build multi-symbol request
    const symbolsParam = limitedSymbols.join(',');
    let url = `${BASE}/stocks/bars?symbols=${encodeURIComponent(symbolsParam)}&timeframe=1Day&start=${startDate}&feed=iex`;

    if (endDate) {
      url += `&end=${endDate}`;
    }

    // Limit to reasonable number of bars
    url += '&limit=1000';

    const result = await alpacaGet(url, ALPACA_KEY, ALPACA_SECRET);

    if (!result.ok) {
      return json({ error: 'alpaca_error', status: result.status, preview: result.preview }, 500);
    }

    // Result format: { bars: { AAPL: [{t, o, h, l, c, v}, ...], MSFT: [...] } }
    const bars: Record<string, Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>> = {};

    if (result.body?.bars) {
      for (const symbol of limitedSymbols) {
        const symbolBars = result.body.bars[symbol];
        if (Array.isArray(symbolBars)) {
          bars[symbol] = symbolBars.map((bar: any) => ({
            t: bar.t, // timestamp
            o: Number(bar.o), // open
            h: Number(bar.h), // high
            l: Number(bar.l), // low
            c: Number(bar.c), // close
            v: Number(bar.v), // volume
          }));
        }
      }
    }

    return json({ bars });
  } catch (e) {
    console.error('historical-bars error:', e);
    return json({ error: 'unhandled', message: 'An unexpected error occurred.' }, 500);
  }
});
