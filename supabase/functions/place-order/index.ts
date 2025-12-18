import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://fantasy-stock-app.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

function getCorsHeaders(origin: string) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

let requestOrigin = '';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(requestOrigin) },
  });
}

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

Deno.serve(async (req: Request) => {
  // Capture origin for CORS
  requestOrigin = req.headers.get('Origin') || '';

  // CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(requestOrigin) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const CRYPTO_KEY = Deno.env.get('BROKER_CRYPTO_KEY');

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
      return json({ error: 'not_authenticated', message: 'Please sign in to place trades' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const symbol = String(body.symbol || '').trim().toUpperCase();
    const qty = Number(body.qty ?? 1);
    const side = String(body.side ?? 'buy');               // 'buy' | 'sell'
    const type = String(body.type ?? 'market');            // 'market' | 'limit' | ...
    const tif  = String(body.time_in_force ?? 'day');      // 'day' | 'gtc' | ...

    if (!symbol || !Number.isFinite(qty) || qty <= 0) {
      return json({ error: 'bad_request', message: 'symbol and positive qty required' }, 400);
    }

    // Get user's Alpaca credentials
    if (!CRYPTO_KEY) {
      return json({ error: 'server_config_error', message: 'Server missing encryption key' }, 500);
    }

    const creds = await getUserCredentials(user.id, admin, CRYPTO_KEY);
    if (!creds) {
      return json({
        error: 'no_credentials',
        message: 'Please link your Alpaca account in Profile settings before trading'
      }, 400);
    }

    // IMPORTANT: use the *trading* PAPER endpoint
    const url = 'https://paper-api.alpaca.markets/v2/orders';

    const alpacaRes = await fetch(url, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': creds.key,
        'APCA-API-SECRET-KEY': creds.secret,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        symbol,
        qty,
        side,
        type,
        time_in_force: tif,
      }),
    });

    const text = await alpacaRes.text();
    let payload: any = undefined;
    try { payload = JSON.parse(text); } catch { /* leave as text */ }

    if (!alpacaRes.ok) {
      // Detect auth errors and provide clear message
      if (alpacaRes.status === 401 || alpacaRes.status === 403) {
        return json({
          error: 'credentials_invalid',
          message: 'Your Alpaca credentials are invalid or expired. Please update them in your Profile settings.',
          status: alpacaRes.status
        }, 200);
      }

      // Detect insufficient funds
      if (alpacaRes.status === 403 && payload?.message?.includes('buying power')) {
        return json({
          error: 'insufficient_funds',
          message: 'Insufficient buying power in your Alpaca account.',
          status: alpacaRes.status
        }, 200);
      }

      // Return envelope with upstream status for other errors
      return json({
        error: 'alpaca_error',
        message: payload?.message || 'Trade failed. Please try again.',
        status: alpacaRes.status,
        details: payload
      }, 200);
    }

    return json({ ok: true, order: payload }, 200);
  } catch (e) {
    return json({ error: 'unhandled', message: 'An unexpected error occurred. Please try again.' }, 500);
  }
});
