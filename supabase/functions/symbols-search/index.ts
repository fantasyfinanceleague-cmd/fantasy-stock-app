import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

let requestOrigin = '';

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  // Allow any vercel.app subdomain (production and previews)
  if (origin.endsWith('.vercel.app') && origin.startsWith('https://')) return true;
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
  requestOrigin = req.headers.get('Origin') || '';

  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders() });

  const { q, limit = 10, includePrices = true } = await req.json().catch(() => ({}));
  const query = String(q || '').trim().toUpperCase();
  if (!query) return json({ items: [] });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_PUBLISHABLE_KEY')!);

  // Smart search with relevance-based ordering
  // Priority: 1) Exact symbol, 2) Symbol starts-with, 3) Name starts-with, 4) Symbol/Name contains
  let items: Array<{ symbol: string; name: string; price?: number | null }> = [];
  const maxResults = Math.min(15, Number(limit) || 10);
  const seen = new Set<string>();

  const addItems = (newItems: Array<{ symbol: string; name: string }> | null) => {
    if (!newItems) return;
    for (const item of newItems) {
      if (!seen.has(item.symbol) && items.length < maxResults) {
        seen.add(item.symbol);
        items.push(item);
      }
    }
  };

  // 1. Exact symbol match (highest priority)
  const { data: exactSymbol } = await supabase
    .from('symbols')
    .select('symbol,name')
    .eq('symbol', query)
    .limit(1);
  addItems(exactSymbol);

  // 2. Symbol starts with query
  if (items.length < maxResults) {
    const { data: symbolStartsWith } = await supabase
      .from('symbols')
      .select('symbol,name')
      .like('symbol', `${query}%`)
      .order('symbol')
      .limit(maxResults);
    addItems(symbolStartsWith);
  }

  // 3. Name starts with query (e.g., "Intel" -> "Intel Corporation")
  if (items.length < maxResults) {
    const { data: nameStartsWith } = await supabase
      .from('symbols')
      .select('symbol,name')
      .ilike('name', `${query}%`)
      .order('symbol')
      .limit(maxResults);
    addItems(nameStartsWith);
  }

  // 4. Symbol contains query
  if (items.length < maxResults) {
    const { data: symbolContains } = await supabase
      .from('symbols')
      .select('symbol,name')
      .ilike('symbol', `%${query}%`)
      .order('symbol')
      .limit(maxResults);
    addItems(symbolContains);
  }

  // 5. Name contains query (lowest priority)
  if (items.length < maxResults) {
    const { data: nameContains } = await supabase
      .from('symbols')
      .select('symbol,name')
      .ilike('name', `%${query}%`)
      .order('symbol')
      .limit(maxResults);
    addItems(nameContains);
  }

  // Items are already deduplicated via the seen Set in addItems

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
