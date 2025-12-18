import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://fantasy-stock-app.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

const json = (b: unknown, s = 200, req?: Request) => {
  const headers = req ? getCorsHeaders(req) : { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0], 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...headers } });
};

const BASE = 'https://data.alpaca.markets/v2';

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

/** base64 -> Uint8Array */
function b64d(s: string) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function importAesKey(b64: string) {
  const raw = b64d(b64);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function aesDecrypt(ciphertext: string, iv: string, b64Key: string): Promise<string> {
  const key = await importAesKey(b64Key);
  const ctBuf = b64d(ciphertext);
  const ivBuf = b64d(iv);
  const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuf }, key, ctBuf);
  return new TextDecoder().decode(ptBuf);
}

async function getUserCredentials(userId: string, admin: any, cryptoKey: string) {
  const { data, error } = await admin
    .from('broker_credentials')
    .select('key_id, secret_ciphertext, iv')
    .eq('user_id', userId)
    .eq('broker', 'alpaca')
    .single();

  if (error || !data) {
    return null;
  }

  const secret = await aesDecrypt(data.secret_ciphertext, data.iv, cryptoKey);
  return { key: data.key_id, secret };
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
    // Check for auth errors specifically
    const isAuthError = res.status === 401 || res.status === 403;
    return { ok: false as const, status: res.status, preview: text.slice(0, 400), isAuthError };
  }
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = {}; }
  return { ok: true as const, status: res.status, body, isAuthError: false };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  const SUPABASE_URL = env('SUPABASE_URL');
  const ANON_KEY = env('SUPABASE_ANON_KEY');
  const SERVICE_ROLE = env('SUPABASE_SERVICE_ROLE_KEY');
  const CRYPTO_KEY = env('BROKER_CRYPTO_KEY');

  // Authed client (to get user id from JWT)
  const authed = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });

  // Admin client for reading credentials
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // Get authenticated user
    const { data: auth } = await authed.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return json({ error: 'not_authenticated', message: 'Please sign in to view quotes' }, 401);
    }

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

    // Get user's Alpaca credentials
    if (!CRYPTO_KEY) {
      return json({ error: 'server_config_error', message: 'Server missing encryption key' }, 500);
    }

    const creds = await getUserCredentials(user.id, admin, CRYPTO_KEY);
    if (!creds) {
      return json({
        error: 'no_credentials',
        message: 'Please link your Alpaca account in Profile settings'
      }, 400);
    }

    const key = creds.key;
    const secret = creds.secret;

    // Always request the free IEX feed
    const feedQS = `?feed=iex`;

    let price: number | null = null;
    let source = '';
    let lastErr: any = null;

    // 1) latest quote
    {
      const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/quotes/latest${feedQS}`;
      const r = await alpacaGet(url, key, secret);
      if (r.ok) {
        const ap = Number(r.body?.quote?.ap);
        const bp = Number(r.body?.quote?.bp);
        if (Number.isFinite(ap) && ap > 0) { price = ap; source = 'quote.ap'; }
        else if (Number.isFinite(bp) && bp > 0) { price = bp; source = 'quote.bp'; }
      } else {
        // Check for auth errors and return immediately with clear message
        if (r.isAuthError) {
          return json({
            error: 'credentials_invalid',
            message: 'Your Alpaca credentials are invalid or expired. Please update them in your Profile settings.'
          }, 401);
        }
        lastErr = { step: 'quote', status: r.status, preview: r.preview };
      }
    }

    // 2) latest trade
    if (price == null) {
      const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/trades/latest${feedQS}`;
      const r = await alpacaGet(url, key, secret);
      if (r.ok) {
        const p = Number(r.body?.trade?.p);
        if (Number.isFinite(p) && p > 0) { price = p; source = 'trade.p'; }
      } else {
        if (r.isAuthError) {
          return json({
            error: 'credentials_invalid',
            message: 'Your Alpaca credentials are invalid or expired. Please update them in your Profile settings.'
          }, 401);
        }
        lastErr = { step: 'trade', status: r.status, preview: r.preview };
      }
    }

    // 3) latest bar close
    if (price == null) {
      const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/bars/latest${feedQS}`;
      const r = await alpacaGet(url, key, secret);
      if (r.ok) {
        const c = Number(r.body?.bar?.c);
        if (Number.isFinite(c) && c > 0) { price = c; source = 'bar.c'; }
      } else {
        if (r.isAuthError) {
          return json({
            error: 'credentials_invalid',
            message: 'Your Alpaca credentials are invalid or expired. Please update them in your Profile settings.'
          }, 401);
        }
        lastErr = { step: 'bar', status: r.status, preview: r.preview };
      }
    }

    if (price == null) return json({ error: 'no_price', symbol, lastErr }, 404);

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

    return json(result);
  } catch (e) {
    return json({ error: 'unhandled', message: 'An unexpected error occurred. Please try again.' }, 500);
  }
});
