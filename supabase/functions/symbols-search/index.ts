import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });

function env(k: string) { return Deno.env.get(k) ?? ''; }

// Fetch prices for multiple symbols from Alpaca
async function fetchPrices(symbols: string[]): Promise<Record<string, number | null>> {
  const prices: Record<string, number | null> = {};
  if (symbols.length === 0) return prices;

  const key = env('ALPACA_API_KEY');
  const secret = env('ALPACA_API_SECRET');
  if (!key || !secret) return prices;

  try {
    // Alpaca multi-symbol latest trades endpoint
    const symbolsParam = symbols.join(',');
    const url = `https://data.alpaca.markets/v2/stocks/trades/latest?symbols=${encodeURIComponent(symbolsParam)}&feed=iex`;

    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
        'Accept': 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json();
      // Response format: { trades: { AAPL: { p: 195.50, ... }, MSFT: { p: 420.00, ... } } }
      if (data?.trades) {
        for (const sym of symbols) {
          const trade = data.trades[sym];
          if (trade?.p && Number.isFinite(Number(trade.p))) {
            prices[sym] = Number(trade.p);
          }
        }
      }
    }
  } catch {
    // Silently fail - prices are optional enhancement
  }

  return prices;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const { q, limit = 10, includePrices = true } = await req.json().catch(() => ({}));
  const query = String(q || '').trim();
  if (!query) return json({ items: [] });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await supabase
    .from('symbols')
    .select('symbol,name')
    .or(`symbol.ilike.%${query}%,name.ilike.%${query}%`)
    .order('symbol')
    .limit(Math.min(25, Number(limit) || 10));

  if (error) return json({ items: [], error: error.message }, 500);

  const items = data || [];

  // Optionally fetch prices for search results
  if (includePrices && items.length > 0) {
    const symbols = items.map((item: { symbol: string }) => item.symbol);
    const prices = await fetchPrices(symbols);

    // Attach prices to items
    for (const item of items as Array<{ symbol: string; name: string; price?: number | null }>) {
      item.price = prices[item.symbol] ?? null;
    }
  }

  return json({ items });
});
