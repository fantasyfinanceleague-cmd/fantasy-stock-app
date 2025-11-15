import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

const BASE = 'https://data.alpaca.markets/v2';

function env(k: string) { return Deno.env.get(k) ?? ''; }

async function alpacaGet(url: string, key: string, secret: string) {
  const res = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret,
      'Accept': 'application/json',
    },
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) return { ok: false as const, status: res.status, preview: text.slice(0, 400) };
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = {}; }
  return { ok: true as const, status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

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

    const key = env('ALPACA_API_KEY');
    const secret = env('ALPACA_API_SECRET');
    if (!key || !secret) return json({ error: 'server missing API keys' }, 500);

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
      } else lastErr = { step: 'quote', status: r.status, preview: r.preview };
    }

    // 2) latest trade
    if (price == null) {
      const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/trades/latest${feedQS}`;
      const r = await alpacaGet(url, key, secret);
      if (r.ok) {
        const p = Number(r.body?.trade?.p);
        if (Number.isFinite(p) && p > 0) { price = p; source = 'trade.p'; }
      } else lastErr = { step: 'trade', status: r.status, preview: r.preview };
    }

    // 3) latest bar close
    if (price == null) {
      const url = `${BASE}/stocks/${encodeURIComponent(symbol)}/bars/latest${feedQS}`;
      const r = await alpacaGet(url, key, secret);
      if (r.ok) {
        const c = Number(r.body?.bar?.c);
        if (Number.isFinite(c) && c > 0) { price = c; source = 'bar.c'; }
      } else lastErr = { step: 'bar', status: r.status, preview: r.preview };
    }

    if (price == null) return json({ error: 'no_price', symbol, lastErr }, 404);
    return json({ symbol, price, source });
  } catch (e) {
    return json({ error: 'unhandled', message: String(e) }, 500);
  }
});
