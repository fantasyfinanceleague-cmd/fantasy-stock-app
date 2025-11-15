import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const symbol = String(body.symbol || '').trim().toUpperCase();
    const qty = Number(body.qty ?? 1);
    const side = String(body.side ?? 'buy');               // 'buy' | 'sell'
    const type = String(body.type ?? 'market');            // 'market' | 'limit' | ...
    const tif  = String(body.time_in_force ?? 'day');      // 'day' | 'gtc' | ...

    if (!symbol || !Number.isFinite(qty) || qty <= 0) {
      return json({ error: 'bad_request', message: 'symbol and positive qty required' }, 400);
    }

    const KEY = Deno.env.get('ALPACA_KEY_ID') ?? Deno.env.get('APCA_API_KEY_ID') ?? '';
    const SECRET = Deno.env.get('ALPACA_SECRET_KEY') ?? Deno.env.get('APCA_API_SECRET_KEY') ?? '';
    if (!KEY || !SECRET) return json({ error: 'server_missing_keys' }, 500);

    // IMPORTANT: use the *trading* PAPER endpoint
    const url = 'https://paper-api.alpaca.markets/v2/orders';

    const alpacaRes = await fetch(url, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': KEY,
        'APCA-API-SECRET-KEY': SECRET,
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
      // Return envelope with upstream status so you can see the reason
      return json({ error: 'alpaca_error', status: alpacaRes.status, body: payload ?? { preview: text.slice(0, 400) } }, 200);
    }

    return json({ ok: true, order: payload }, 200);
  } catch (e) {
    return json({ error: 'unhandled', message: String(e) }, 500);
  }
});
