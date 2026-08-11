// enrich-symbols — Phase 4 symbols enrichment cron (DR-001 /
// SIMULATOR_MIGRATION_SPEC). Populates gics_industry, market_cap (Finnhub
// profile2), last_price (one batched Alpaca snapshots call), and computes
// is_draftable (../_shared/symbol-eligibility.ts) for a batch of the stalest
// symbols per run.
//
// WHY A 10-MINUTE BATCH CRON, NOT A DAILY FULL PASS: sector/industry comes
// from Finnhub (neither the NASDAQ Trader universe feed nor Alpaca's market
// data API exposes it), and Finnhub's free tier is 60 calls/min — a full
// ~14.4k-symbol pass cannot fit any single edge-function invocation. A batch
// of ~50 stalest-first (enriched_at ASC NULLS FIRST) every 10 minutes covers
// the universe in ~2 days and then sustains a ~2-day refresh cadence per
// symbol. gics_sector stays NULL: profile2 has no sector field; the column is
// reserved for a future GICS-grade source.
//
// CURSOR RULES (so the cron cannot wedge): a PERMANENT-looking miss (404 /
// empty profile — delisted, funds, foreign) still advances enriched_at, or the
// cursor would spin on the same dead symbols forever. A TRANSIENT failure
// (429 / 5xx / network) aborts the batch WITHOUT advancing the failed
// symbol's cursor, so the next run retries it.
//
// Auth: cron-only — verify_jwt=false at the gateway; constant-time apikey
// check against SB_SECRET_KEY_CRON in-code (snapshot-week-start pattern,
// fail-closed).
//
// Effect-verify (per CLAUDE.md, counts not statuses): the response reports
// batch/profiled/priced/draftable counts and unmatched_industries; the
// scheduled job's real check is data movement —
//   SELECT count(*) FROM symbols WHERE enriched_at > now() - interval '1 hour';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { computeIsDraftable } from '../_shared/symbol-eligibility.ts';

const DEFAULT_BATCH = 50;
const MAX_BATCH = 120;
const FINNHUB_SPACING_MS = 1100; // stay under 60 calls/min

function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) result |= aBytes[i] ^ bBytes[i];
  return result === 0;
}

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get('SB_SECRET_KEY_CRON');
  if (!expected || expected.length === 0) {
    console.error('SB_SECRET_KEY_CRON not configured — rejecting all requests');
    return false; // fail closed
  }
  return constantTimeEqual(req.headers.get('apikey') ?? '', expected);
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ProfileResult {
  status: 'ok' | 'empty' | 'transient';
  industry?: string | null;
  marketCap?: number | null; // dollars
}

async function fetchProfile(symbol: string, token: string): Promise<ProfileResult> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`,
    );
    if (res.status === 429 || res.status >= 500) return { status: 'transient' };
    if (!res.ok) return { status: 'empty' }; // 4xx: no profile for this symbol
    const body = await res.json().catch(() => null);
    if (!body || Object.keys(body).length === 0) return { status: 'empty' };
    const industry = typeof body.finnhubIndustry === 'string' && body.finnhubIndustry.trim()
      ? body.finnhubIndustry.trim()
      : null;
    // profile2 marketCapitalization is in MILLIONS of USD.
    const capM = Number(body.marketCapitalization);
    const marketCap = Number.isFinite(capM) && capM > 0 ? capM * 1_000_000 : null;
    return { status: 'ok', industry, marketCap };
  } catch {
    return { status: 'transient' };
  }
}

/** One batched Alpaca snapshots call: symbol -> latest usable price. */
async function fetchBatchPrices(
  symbols: string[],
  key: string,
  secret: string,
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (symbols.length === 0) return prices;
  const url = `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${
    symbols.map(encodeURIComponent).join(',')
  }&feed=iex`;
  try {
    const res = await fetch(url, {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, 'Accept': 'application/json' },
    });
    if (!res.ok) {
      console.error('alpaca snapshots failed', res.status);
      return prices;
    }
    const body = await res.json().catch(() => ({}));
    for (const sym of symbols) {
      const snap = body?.[sym];
      const p = Number(snap?.latestTrade?.p) || Number(snap?.dailyBar?.c) || Number(snap?.prevDailyBar?.c);
      if (Number.isFinite(p) && p > 0) prices.set(sym, p);
    }
  } catch (e) {
    console.error('alpaca snapshots error', e);
  }
  return prices;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!isAuthorized(req)) return json({ error: 'unauthorized' }, 401);

  const FINNHUB = Deno.env.get('FINNHUB_API_KEY') ?? '';
  const ALPACA_KEY = Deno.env.get('ALPACA_API_KEY') ?? '';
  const ALPACA_SECRET = Deno.env.get('ALPACA_API_SECRET') ?? '';
  if (!FINNHUB || !ALPACA_KEY || !ALPACA_SECRET) {
    return json({ error: 'server_config_error' }, 500);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SECRET_KEY_INTERNAL')!);

  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(Math.max(Number(body?.limit) || DEFAULT_BATCH, 1), MAX_BATCH);

  // Stalest-first cursor. active-only: delisted rows never re-enter.
  const { data: rows, error: selErr } = await admin
    .from('symbols')
    .select('symbol, exchange, is_etf, active, gics_industry, last_price, market_cap')
    .eq('active', true)
    .order('enriched_at', { ascending: true, nullsFirst: true })
    .limit(batchSize);
  if (selErr) return json({ error: 'select_failed' }, 500);
  const batch = rows ?? [];
  if (batch.length === 0) return json({ ok: true, batch: 0 });

  // Known rule keys, to report unmatched vendor labels for curation.
  const { data: ruleRows } = await admin.from('category_rules').select('gics_industry');
  const knownIndustries = new Set((ruleRows ?? []).map((r) => String(r.gics_industry)));

  // One batched price call for the whole batch (ETFs included).
  const prices = await fetchBatchPrices(batch.map((r) => String(r.symbol)), ALPACA_KEY, ALPACA_SECRET);

  let profiled = 0;
  let priced = 0;
  let skippedEtf = 0;
  let draftable = 0;
  let transientAbort = false;
  const unmatched = new Set<string>();

  for (const row of batch) {
    const symbol = String(row.symbol);
    let industry: string | null = row.gics_industry ?? null;
    let marketCap: number | null = row.market_cap == null ? null : Number(row.market_cap);

    if (row.is_etf === true) {
      skippedEtf++; // funds have no profile2 data; category layer handles them
    } else {
      const prof = await fetchProfile(symbol, FINNHUB);
      if (prof.status === 'transient') {
        // Abort WITHOUT advancing this symbol's cursor — next run retries.
        transientAbort = true;
        break;
      }
      if (prof.status === 'ok') {
        industry = prof.industry ?? null;
        marketCap = prof.marketCap ?? null;
        profiled++;
        if (industry && !knownIndustries.has(industry)) unmatched.add(industry);
      }
      // 'empty' still advances the cursor (permanent miss — see header).
      await sleep(FINNHUB_SPACING_MS);
    }

    const lastPrice = prices.get(symbol) ?? (row.last_price == null ? null : Number(row.last_price));
    if (prices.has(symbol)) priced++;

    const is_draftable = computeIsDraftable({
      active: row.active,
      exchange: row.exchange ?? null,
      is_etf: row.is_etf ?? null,
      last_price: lastPrice,
      market_cap: marketCap,
    });
    if (is_draftable) draftable++;

    const { error: upErr } = await admin
      .from('symbols')
      .update({
        gics_industry: industry,
        market_cap: marketCap,
        last_price: lastPrice,
        is_draftable,
        enriched_at: new Date().toISOString(),
      })
      .eq('symbol', symbol);
    if (upErr) {
      console.error('update failed', symbol, upErr.message);
      // continue: one bad row must not starve the rest of the batch
    }
  }

  const result = {
    ok: true,
    batch: batch.length,
    profiled,
    priced,
    skipped_etf: skippedEtf,
    draftable_in_batch: draftable,
    transient_abort: transientAbort,
    unmatched_industries: [...unmatched],
  };
  console.log('enrich-symbols', JSON.stringify(result));
  return json(result);
});
