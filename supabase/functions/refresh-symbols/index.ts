// supabase/functions/refresh-symbols/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });

/**
 * Parse a NASDAQ "pipe" file, returning an array of string[] rows.
 * Skips header and footer lines.
 */
function parsePipe(body: string): string[][] {
  const rows: string[][] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || !line.includes('|')) continue;
    // Skip headers / footers that appear in both files
    if (line.startsWith('Symbol|')) continue;        // nasdaqlisted header
    if (line.startsWith('ACT Symbol|')) continue;    // otherlisted header
    if (line.startsWith('File Creation Time')) break; // footer
    rows.push(line.split('|'));
  }
  return rows;
}

// Map of OTHERLISTED exchange codes to human names
const EX_MAP: Record<string, string> = {
  A: 'NYSE American',
  N: 'NYSE',
  P: 'NYSE Arca',
  Z: 'Cboe BZX',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const urlNasdaq = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
  const urlOther  = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';

  const [r1, r2] = await Promise.all([fetch(urlNasdaq), fetch(urlOther)]);
  if (!r1.ok) return json({ error: 'fetch nasdaqlisted failed', status: r1.status }, 502);
  if (!r2.ok) return json({ error: 'fetch otherlisted failed',  status: r2.status }, 502);

  const [t1, t2] = await Promise.all([r1.text(), r2.text()]);
  const nasdaqRows = parsePipe(t1); // Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
  const otherRows  = parsePipe(t2); // ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol

  // Use a map to dedupe by symbol; prefer NASDAQ if duplicates exist
  const bySymbol = new Map<string, {
    symbol: string; name: string; exchange: string; is_etf: boolean; active: boolean;
  }>();

  // NASDAQ
  for (const row of nasdaqRows) {
    // Guard against short rows
    const symRaw = row[0] ?? '';
    const nameRaw = row[1] ?? '';
    const test    = row[3] ?? 'N';
    const etfFlag = row[6] ?? 'N';
    if (!symRaw) continue;
    if (test === 'Y') continue; // skip test issues
    const symbol = symRaw.trim().toUpperCase();
    const name   = nameRaw.trim();
    bySymbol.set(symbol, {
      symbol,
      name,
      exchange: 'NASDAQ',
      is_etf: etfFlag === 'Y',
      active: true,
    });
  }

  // OTHERLISTED (only add if we don't already have a NASDAQ entry for this symbol)
  for (const row of otherRows) {
    // Correct column order for OTHERLISTED
    // 0: ACT Symbol, 1: Security Name, 2: Exchange (A/N/P/Z), 3: CQS Symbol, 4: ETF, 5: Round Lot, 6: Test Issue, 7: NASDAQ Symbol
    const symRaw  = row[0] ?? '';
    const nameRaw = row[1] ?? '';
    const exCode  = (row[2] ?? '').trim();
    const etfFlag = row[4] ?? 'N';
    const test    = row[6] ?? 'N';
    if (!symRaw) continue;
    if (test === 'Y') continue; // skip test issues
    const symbol = symRaw.trim().toUpperCase();
    if (bySymbol.has(symbol)) continue; // keep NASDAQ version if present
    const name = nameRaw.trim();
    const exchange = EX_MAP[exCode] ?? exCode; // map A/N/P/Z to human, else keep code
    bySymbol.set(symbol, {
      symbol,
      name,
      exchange,
      is_etf: etfFlag === 'Y',
      active: true,
    });
  }

  const records = Array.from(bySymbol.values());

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // service key to bypass RLS for upsert
  );

  // Upsert in chunks
  const chunk = 1000;
  for (let i = 0; i < records.length; i += chunk) {
    const slice = records.slice(i, i + chunk);
    const { error } = await supabase
      .from('symbols')
      .upsert(slice, { onConflict: 'symbol' });
    if (error) return json({ error: error.message, at: 'upsert', offset: i }, 500);
  }

  return json({ ok: true, count: records.length });
});
