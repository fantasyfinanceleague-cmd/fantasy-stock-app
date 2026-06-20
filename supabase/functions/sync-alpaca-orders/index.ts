import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Sync Alpaca Orders
 *
 * Ensures our trades table matches Alpaca's actual fill prices.
 *
 * Modes:
 * 1. 'verify' - Verify a single order matches Alpaca (requires auth)
 * 2. 'sync' - Sync all recent orders for current user (requires auth)
 * 3. 'sync-all' - Sync all users with Alpaca credentials (server/cron only)
 */

function env(k: string) { return Deno.env.get(k) ?? ''; }

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
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

// ── apikey auth (Phase 2b-2; pattern proven in 2b-1 snapshot-week-end) ────────
// Constant-time compare to avoid leaking the expected key via timing.
function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

const unauthorized = () => json({ error: 'Unauthorized' }, 401);

function isAuthorized(req: Request): boolean {
  const expectedKey = Deno.env.get('SB_SECRET_KEY_CRON');
  if (!expectedKey || expectedKey.length === 0) {
    console.error('SB_SECRET_KEY_CRON not configured — rejecting all requests');
    return false;                       // fail closed
  }
  const providedKey = req.headers.get('apikey') ?? '';
  return constantTimeEqual(providedKey, expectedKey);
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

  if (error || !data) return null;

  const secret = await aesDecrypt(data.secret_ciphertext, data.iv, cryptoKey);
  return { key: data.key_id, secret };
}

// Fetch order details from Alpaca
async function fetchAlpacaOrder(orderId: string, creds: { key: string; secret: string }): Promise<any> {
  const url = `https://paper-api.alpaca.markets/v2/orders/${orderId}`;

  try {
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': creds.key,
        'APCA-API-SECRET-KEY': creds.secret,
        'Accept': 'application/json',
      },
    });
    if (res.ok) return await res.json();
  } catch (e) {
    console.error('Error fetching order:', e);
  }
  return null;
}

// Fetch recent filled orders from Alpaca
async function fetchRecentAlpacaOrders(
  creds: { key: string; secret: string },
  limit: number = 100
): Promise<any[]> {
  const url = `https://paper-api.alpaca.markets/v2/orders?status=filled&limit=${limit}&direction=desc`;

  try {
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': creds.key,
        'APCA-API-SECRET-KEY': creds.secret,
        'Accept': 'application/json',
      },
    });
    if (res.ok) return await res.json();
  } catch (e) {
    console.error('Error fetching orders:', e);
  }
  return [];
}

// Sync trades for a specific user
async function syncUserTrades(
  userId: string,
  creds: { key: string; secret: string },
  admin: any,
  leagueId?: string
): Promise<{ checked: number; matched: number; updated: number; errors: string[] }> {
  const results = { checked: 0, matched: 0, updated: 0, errors: [] as string[] };

  // Fetch recent filled orders from Alpaca
  const alpacaOrders = await fetchRecentAlpacaOrders(creds, 100);
  const alpacaOrderMap = new Map(alpacaOrders.map(o => [o.id, o]));

  // Get our trades with alpaca_order_ids
  let tradesQuery = admin
    .from('trades')
    .select('*')
    .eq('user_id', userId)
    .not('alpaca_order_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (leagueId) {
    tradesQuery = tradesQuery.eq('league_id', leagueId);
  }

  const { data: trades, error: tradesErr } = await tradesQuery;

  if (tradesErr) {
    results.errors.push(`Failed to fetch trades: ${tradesErr.message}`);
    return results;
  }

  for (const trade of trades || []) {
    const alpacaOrder = alpacaOrderMap.get(trade.alpaca_order_id);

    if (!alpacaOrder) {
      // Order not in recent Alpaca history - might be older, skip
      continue;
    }

    results.checked++;

    const alpacaPrice = Number(alpacaOrder.filled_avg_price);
    const ourPrice = Number(trade.price);
    const alpacaQty = Number(alpacaOrder.filled_qty);
    const ourQty = Number(trade.quantity);

    // Allow 1 cent tolerance for floating point
    const priceMatch = Math.abs(alpacaPrice - ourPrice) < 0.01;
    const qtyMatch = alpacaQty === ourQty;

    if (priceMatch && qtyMatch) {
      results.matched++;
    } else {
      // Update our record to match Alpaca
      const { error: updateErr } = await admin
        .from('trades')
        .update({
          price: alpacaPrice,
          quantity: alpacaQty,
          total_value: alpacaPrice * alpacaQty,
        })
        .eq('id', trade.id);

      if (updateErr) {
        results.errors.push(`Trade ${trade.id}: ${updateErr.message}`);
      } else {
        results.updated++;
        console.log(`Updated trade ${trade.id}: price ${ourPrice} -> ${alpacaPrice}, qty ${ourQty} -> ${alpacaQty}`);
      }
    }
  }

  return results;
}

Deno.serve(async (req: Request) => {
  requestOrigin = req.headers.get('Origin') || '';

  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(requestOrigin) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // SECURITY: cron-only function. As of Phase 2b-2 it runs with verify_jwt=false,
  // so this apikey guard is the ONLY thing protecting it. Validate before reading
  // the body, connecting to the DB, or calling Alpaca. (Placed after the OPTIONS
  // preflight + method check — preflight carries no secret.)
  if (!isAuthorized(req)) {
    return unauthorized();
  }

  const SUPABASE_URL = env('SUPABASE_URL');
  const ANON_KEY = env('SUPABASE_ANON_KEY');
  const SECRET_KEY = env('SB_SECRET_KEY_INTERNAL');
  const CRYPTO_KEY = env('BROKER_CRYPTO_KEY');

  if (!SUPABASE_URL || !SECRET_KEY) {
    return json({ error: 'missing_config' }, 500);
  }

  const admin = createClient(SUPABASE_URL, SECRET_KEY);

  // Try to get authenticated user (may be null for server-side calls)
  const authed = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth } = await authed.auth.getUser();
  const user = auth?.user;

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'sync';

    if (!CRYPTO_KEY) {
      return json({ error: 'server_config_error', message: 'Missing encryption key' }, 500);
    }

    // Mode: sync-all (server/cron only - no user auth)
    if (mode === 'sync-all') {
      console.log('Starting sync-all for all users with Alpaca credentials...');

      // Get all users with Alpaca credentials
      const { data: credentials, error: credErr } = await admin
        .from('broker_credentials')
        .select('user_id, key_id, secret_ciphertext, iv')
        .eq('broker', 'alpaca');

      if (credErr) {
        return json({ error: 'Failed to fetch credentials', details: credErr.message }, 500);
      }

      const allResults = {
        users_processed: 0,
        total_checked: 0,
        total_matched: 0,
        total_updated: 0,
        errors: [] as string[],
      };

      for (const cred of credentials || []) {
        try {
          const secret = await aesDecrypt(cred.secret_ciphertext, cred.iv, CRYPTO_KEY);
          const userCreds = { key: cred.key_id, secret };

          const userResults = await syncUserTrades(cred.user_id, userCreds, admin);

          allResults.users_processed++;
          allResults.total_checked += userResults.checked;
          allResults.total_matched += userResults.matched;
          allResults.total_updated += userResults.updated;
          allResults.errors.push(...userResults.errors.map(e => `User ${cred.user_id}: ${e}`));

        } catch (e) {
          allResults.errors.push(`User ${cred.user_id}: ${String(e)}`);
        }
      }

      console.log(`Sync-all complete: ${allResults.users_processed} users, ${allResults.total_updated} trades updated`);

      return json({
        mode: 'sync-all',
        results: allResults,
      });
    }

    // Other modes require authentication
    if (!user) {
      return json({ error: 'not_authenticated' }, 401);
    }

    const creds = await getUserCredentials(user.id, admin, CRYPTO_KEY);
    if (!creds) {
      return json({ error: 'no_credentials', message: 'No Alpaca account linked' }, 400);
    }

    // Mode: verify (single order)
    if (mode === 'verify') {
      const orderId = body.order_id;
      if (!orderId) {
        return json({ error: 'order_id required for verify mode' }, 400);
      }

      const alpacaOrder = await fetchAlpacaOrder(orderId, creds);

      if (!alpacaOrder) {
        return json({ error: 'order_not_found', order_id: orderId }, 404);
      }

      if (alpacaOrder.status !== 'filled') {
        return json({
          error: 'order_not_filled',
          order_id: orderId,
          status: alpacaOrder.status
        }, 400);
      }

      // Find our trade record
      const { data: trade } = await admin
        .from('trades')
        .select('*')
        .eq('alpaca_order_id', orderId)
        .eq('user_id', user.id)
        .single();

      if (!trade) {
        return json({
          error: 'trade_not_found_in_our_db',
          order_id: orderId,
          alpaca_data: {
            symbol: alpacaOrder.symbol,
            side: alpacaOrder.side,
            filled_qty: alpacaOrder.filled_qty,
            filled_avg_price: alpacaOrder.filled_avg_price,
          }
        }, 404);
      }

      const alpacaPrice = Number(alpacaOrder.filled_avg_price);
      const ourPrice = Number(trade.price);
      const priceMatch = Math.abs(alpacaPrice - ourPrice) < 0.01;
      const qtyMatch = Number(alpacaOrder.filled_qty) === Number(trade.quantity);

      if (priceMatch && qtyMatch) {
        return json({ verified: true, matches: true, order_id: orderId });
      }

      // Update to match
      await admin
        .from('trades')
        .update({
          price: alpacaPrice,
          quantity: Number(alpacaOrder.filled_qty),
          total_value: alpacaPrice * Number(alpacaOrder.filled_qty),
        })
        .eq('id', trade.id);

      return json({
        verified: true,
        was_corrected: true,
        order_id: orderId,
        previous: { price: ourPrice, quantity: trade.quantity },
        corrected_to: { price: alpacaPrice, quantity: alpacaOrder.filled_qty },
      });
    }

    // Mode: sync (current user)
    if (mode === 'sync') {
      const results = await syncUserTrades(user.id, creds, admin, body.league_id);
      return json({ mode: 'sync', user_id: user.id, results });
    }

    return json({ error: 'invalid_mode', valid_modes: ['verify', 'sync', 'sync-all'] }, 400);

  } catch (e) {
    console.error('Sync error:', e);
    return json({ error: 'unhandled', message: String(e) }, 500);
  }
});
