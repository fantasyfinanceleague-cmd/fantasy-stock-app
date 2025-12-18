// supabase/functions/get-broker-keys/index.ts
// Retrieves and decrypts user's broker credentials
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://fantasy-stock-app.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

let requestOrigin = '';

function getCorsHeaders() {
  const allowedOrigin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...getCorsHeaders() } });

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

Deno.serve(async (req) => {
  requestOrigin = req.headers.get('Origin') || '';

  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders() });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const CRYPTO_KEY = Deno.env.get('BROKER_CRYPTO_KEY');

  if (!CRYPTO_KEY) return json({ error: 'server missing BROKER_CRYPTO_KEY' }, 500);

  // Authed client (to get user id from JWT)
  const authed = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });

  // Admin client (to read secrets - bypasses RLS for service operations)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const { data: auth } = await authed.auth.getUser();
    const user = auth?.user;
    if (!user) return json({ error: 'not_authenticated' }, 401);

    // Parse optional broker parameter (defaults to 'alpaca')
    let broker = 'alpaca';
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      broker = String(body?.broker || 'alpaca').trim();
    } else if (req.method === 'GET') {
      const url = new URL(req.url);
      broker = url.searchParams.get('broker') || 'alpaca';
    }

    // Fetch credentials from database
    const { data, error } = await admin
      .from('broker_credentials')
      .select('key_id, secret_ciphertext, iv')
      .eq('user_id', user.id)
      .eq('broker', broker)
      .single();

    if (error || !data) {
      return json({ error: 'no_credentials', message: 'No broker credentials found. Please link your Alpaca account in Profile settings.' }, 404);
    }

    // Decrypt the secret
    const secret = await aesDecrypt(data.secret_ciphertext, data.iv, CRYPTO_KEY);

    return json({
      ok: true,
      key_id: data.key_id,
      secret,
      broker
    });
  } catch (e) {
    console.error('get-broker-keys error:', e);
    return json({ error: 'decrypt_failed', message: 'Failed to retrieve credentials. Please try again.' }, 500);
  }
});
