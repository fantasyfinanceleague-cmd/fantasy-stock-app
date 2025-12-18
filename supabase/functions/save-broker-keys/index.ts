// supabase/functions/save-broker-keys/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

let requestOrigin = '';

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  // Allow any vercel.app subdomain (production and previews)
  if (origin.endsWith('.vercel.app') && origin.startsWith('https://')) return true;
  // Allow localhost for development
  if (origin.startsWith('http://localhost:')) return true;
  return false;
}

function getCorsHeaders() {
  const allowedOrigin = isAllowedOrigin(requestOrigin) ? requestOrigin : 'https://fantasy-stock-app.vercel.app';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...getCorsHeaders() } });

/** base64 -> Uint8Array */
function b64d(s: string) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
/** Uint8Array -> base64 */
function b64e(a: Uint8Array) { return btoa(String.fromCharCode(...a)); }

async function importAesKey(b64: string) {
  const raw = b64d(b64);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function aesEncrypt(plaintext: string, b64Key: string) {
  const key = await importAesKey(b64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(plaintext);
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);
  return { iv: b64e(iv), ct: b64e(new Uint8Array(buf)) };
}

/** Validate Alpaca credentials by calling their account endpoint */
async function validateAlpacaCredentials(keyId: string, secret: string): Promise<{ valid: boolean; error?: string; accountInfo?: any }> {
  try {
    // Use paper trading endpoint to validate credentials
    const res = await fetch('https://paper-api.alpaca.markets/v2/account', {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': keyId,
        'APCA-API-SECRET-KEY': secret,
        'Accept': 'application/json',
      },
    });

    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: 'Invalid API credentials. Please check your API Key ID and Secret Key.' };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { valid: false, error: `Alpaca API error (${res.status}): Unable to verify credentials.` };
    }

    const account = await res.json();

    // Check if this is a paper trading account
    if (account.status !== 'ACTIVE') {
      return { valid: false, error: `Account status is ${account.status}. Please use an active account.` };
    }

    return {
      valid: true,
      accountInfo: {
        accountNumber: account.account_number,
        status: account.status,
        currency: account.currency,
        buyingPower: account.buying_power,
      }
    };
  } catch (e) {
    return { valid: false, error: 'Failed to connect to Alpaca. Please try again.' };
  }
}

Deno.serve(async (req) => {
  requestOrigin = req.headers.get('Origin') || '';

  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders() });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const CRYPTO_KEY = Deno.env.get('BROKER_CRYPTO_KEY'); // base64, 32 bytes recommended

  if (!CRYPTO_KEY) return json({ error: 'Server configuration error' }, 500);

  // Authed client (to get user id from JWT)
  const authed = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });

  // Admin client (to write secrets)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const { data: auth } = await authed.auth.getUser();
    const user = auth?.user;
    if (!user) return json({ error: 'not_authenticated' }, 401);

    const body = await req.json().catch(() => ({}));
    const key_id = String(body?.key_id || '').trim();
    const secret = String(body?.secret || '').trim();
    const skipValidation = body?.skipValidation === true; // Allow skipping for testing

    if (!key_id || !secret) return json({ error: 'key_id and secret required' }, 400);

    // Validate credentials with Alpaca before saving
    if (!skipValidation) {
      const validation = await validateAlpacaCredentials(key_id, secret);
      if (!validation.valid) {
        return json({
          error: 'invalid_credentials',
          message: validation.error
        }, 400);
      }
    }

    const { iv, ct } = await aesEncrypt(secret, CRYPTO_KEY);

    const { error } = await admin
      .from('broker_credentials')
      .upsert({
        user_id: user.id,
        broker: 'alpaca',
        key_id,
        secret_ciphertext: ct,
        iv,
      });

    if (error) return json({ error: 'Failed to save credentials' }, 500);
    return json({ ok: true });
  } catch (e) {
    return json({ error: 'An unexpected error occurred' }, 500);
  }
});
