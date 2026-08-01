import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  // Allow any vercel.app subdomain (production and previews)
  if (origin.endsWith('.vercel.app') && origin.startsWith('https://')) return true;
  if (origin.startsWith('http://localhost:')) return true;
  return false;
}

function getCorsHeaders(origin: string) {
  const allowedOrigin = isAllowedOrigin(origin) ? origin : 'https://fantasy-stock-app.vercel.app';
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

// Poll Alpaca order status until filled or timeout
async function waitForFill(orderId: string, creds: { key: string; secret: string }, maxAttempts = 10): Promise<any> {
  const orderUrl = `https://paper-api.alpaca.markets/v2/orders/${orderId}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Wait before polling (except first attempt)
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, 500)); // 500ms between polls
    }

    try {
      const res = await fetch(orderUrl, {
        headers: {
          'APCA-API-KEY-ID': creds.key,
          'APCA-API-SECRET-KEY': creds.secret,
          'Accept': 'application/json',
        },
      });

      if (res.ok) {
        const order = await res.json();
        // Check if order is filled
        if (order.status === 'filled') {
          return order;
        }
        // If order is rejected, canceled, or expired, stop polling
        if (['rejected', 'canceled', 'expired', 'replaced'].includes(order.status)) {
          return order;
        }
      }
    } catch (e) {
      console.error('Error polling order status:', e);
    }
  }

  return null; // Timeout - couldn't confirm fill
}

Deno.serve(async (req: Request) => {
  // Capture origin for CORS
  requestOrigin = req.headers.get('Origin') || '';

  // CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(requestOrigin) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const PUBLISHABLE_KEY = Deno.env.get('SB_PUBLISHABLE_KEY')!;
  const SECRET_KEY = Deno.env.get('SB_SECRET_KEY_INTERNAL')!;
  const CRYPTO_KEY = Deno.env.get('BROKER_CRYPTO_KEY');

  // Authed client (to get user id from JWT)
  const authed = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });

  // Admin client for reading credentials
  const admin = createClient(SUPABASE_URL, SECRET_KEY);

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
    const leagueId = String(body.league_id ?? '').trim();

    if (!symbol || !Number.isFinite(qty) || qty <= 0) {
      return json({ error: 'bad_request', message: 'symbol and positive qty required' }, 400);
    }

    // league_id is required so the server can record the resulting fill and
    // enforce membership (replaces the dropped trades INSERT RLS WITH CHECK).
    if (!leagueId) {
      return json({ error: 'bad_request', message: 'league_id required' }, 400);
    }

    // Verify the caller is a member of the league they're trading in.
    // This replicates the RLS predicate that previously gated the client-side
    // trades INSERT: user_id = auth.uid() AND member of league_id.
    // league_members.user_id is TEXT (holds the uuid as a string).
    const { data: membership, error: membershipErr } = await admin
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (membershipErr) {
      return json({ error: 'server_error', message: 'Could not verify league membership.' }, 500);
    }
    if (!membership) {
      return json({ error: 'not_a_member', message: 'You are not a member of this league.' }, 403);
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

    // For market orders, poll until filled to get the actual fill price
    let finalOrder = payload;
    if (type === 'market' && payload?.id) {
      const filledOrder = await waitForFill(payload.id, creds);
      if (filledOrder) {
        finalOrder = filledOrder;
      }
    }

    const fillPrice = finalOrder?.filled_avg_price ? Number(finalOrder.filled_avg_price) : null;
    const fillQty = finalOrder?.filled_qty ? Number(finalOrder.filled_qty) : null;

    // Record the trade server-side from Alpaca's ACTUAL fill values, never from
    // client-supplied price/quantity. Only record a genuinely filled order with
    // a positive, finite price and quantity. The membership check above plus the
    // JWT-derived user.id replace the dropped client-side INSERT RLS policy.
    let tradeRecorded = false;
    const filled = finalOrder?.status === 'filled'
      && fillPrice !== null && Number.isFinite(fillPrice) && fillPrice > 0
      && fillQty !== null && Number.isFinite(fillQty) && fillQty > 0;

    if (filled) {
      // Normalise side to the lowercase 'buy'/'sell' the CHECK constraint and
      // scoring (trade.action === 'buy'/'sell') require. Alpaca returns lowercase.
      const action = String(finalOrder?.side ?? side).toLowerCase();

      const { error: insertErr } = await admin
        .from('trades')
        .insert({
          symbol,
          action,
          quantity: fillQty,
          price: fillPrice,
          total_value: fillPrice * fillQty,
          league_id: leagueId,
          user_id: user.id,
          alpaca_order_id: finalOrder?.id ?? null,
        });

      if (insertErr) {
        // The order DID fill at Alpaca but we failed to persist it. Surface this
        // as a hard error so the client does not treat the trade as recorded.
        console.error('Failed to record trade after fill:', insertErr);
        return json({
          error: 'trade_record_failed',
          message: 'Your order filled but could not be recorded. Please contact support.',
          order: finalOrder,
          filled_avg_price: fillPrice,
          filled_qty: fillQty,
          trade_recorded: false,
        }, 500);
      }

      tradeRecorded = true;
    }

    // Return order with filled_avg_price (the actual price Alpaca executed at)
    return json({
      ok: true,
      order: finalOrder,
      // Include fill price at top level for easy access
      filled_avg_price: fillPrice,
      filled_qty: fillQty,
      trade_recorded: tradeRecorded,
    }, 200);
  } catch (e) {
    return json({ error: 'unhandled', message: 'An unexpected error occurred. Please try again.' }, 500);
  }
});
