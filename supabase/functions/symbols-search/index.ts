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

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);

  // For short queries (1-2 chars), prioritize exact symbol matches
  // This fixes issues with single letter stocks like V, T, F
  let items: Array<{ symbol: string; name: string; price?: number | null }> = [];

  if (query.length <= 2) {
    // First, try exact symbol match
    const { data: exactMatch } = await supabase
      .from('symbols')
      .select('symbol,name')
      .eq('symbol', query)
      .limit(1);

    if (exactMatch && exactMatch.length > 0) {
      items.push(...exactMatch);
    }

    // Then add symbols that START with the query
    const { data: startsWithSymbol } = await supabase
      .from('symbols')
      .select('symbol,name')
      .like('symbol', `${query}%`)
      .neq('symbol', query) // exclude exact match already added
      .order('symbol')
      .limit(Math.min(15, Number(limit) || 10));

    if (startsWithSymbol) {
      items.push(...startsWithSymbol);
    }

    // Finally add name matches if we need more results
    if (items.length < (Number(limit) || 10)) {
      const remaining = (Number(limit) || 10) - items.length;
      const existingSymbols = items.map(i => i.symbol);

      const { data: nameMatches } = await supabase
        .from('symbols')
        .select('symbol,name')
        .ilike('name', `%${query}%`)
        .not('symbol', 'in', `(${existingSymbols.map(s => `"${s}"`).join(',') || '""'})`)
        .order('symbol')
        .limit(remaining);

      if (nameMatches) {
        items.push(...nameMatches);
      }
    }
  } else {
    // For longer queries, use the original fuzzy search but prioritize symbol matches
    const { data: symbolMatches } = await supabase
      .from('symbols')
      .select('symbol,name')
      .ilike('symbol', `%${query}%`)
      .order('symbol')
      .limit(Math.min(15, Number(limit) || 10));

    if (symbolMatches) {
      items.push(...symbolMatches);
    }

    // Add name matches if we need more
    if (items.length < (Number(limit) || 10)) {
      const remaining = (Number(limit) || 10) - items.length;
      const existingSymbols = items.map(i => i.symbol);

      const { data: nameMatches } = await supabase
        .from('symbols')
        .select('symbol,name')
        .ilike('name', `%${query}%`)
        .not('symbol', 'in', `(${existingSymbols.map(s => `"${s}"`).join(',') || '""'})`)
        .order('symbol')
        .limit(remaining);

      if (nameMatches) {
        items.push(...nameMatches);
      }
    }
  }

  // Deduplicate by symbol just in case
  const seen = new Set<string>();
  items = items.filter(item => {
    if (seen.has(item.symbol)) return false;
    seen.add(item.symbol);
    return true;
  });

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
