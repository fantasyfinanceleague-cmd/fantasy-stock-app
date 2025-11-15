// supabase/functions/save-broker-keys/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const CRYPTO_KEY = Deno.env.get('BROKER_CRYPTO_KEY'); // base64, 32 bytes recommended

  if (!CRYPTO_KEY) return json({ error: 'server missing BROKER_CRYPTO_KEY' }, 500);

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
    if (!key_id || !secret) return json({ error: 'key_id and secret required' }, 400);

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

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
