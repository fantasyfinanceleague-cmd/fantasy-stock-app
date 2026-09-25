// enrich-symbols — Phase 4 symbols enrichment cron (DR-001 /
// SIMULATOR_MIGRATION_SPEC). Populates gics_industry, market_cap (Finnhub
// profile2), last_price (batched Alpaca snapshots calls), and computes
// is_draftable (../_shared/symbol-eligibility.ts) for a batch of the stalest
// symbols per run.
//
// WHY A 10-MINUTE BATCH CRON, NOT A DAILY FULL PASS: sector/industry comes
// from Finnhub (neither the NASDAQ Trader universe feed nor Alpaca's market
// data API exposes it), and Finnhub's free tier is 60 calls/min — a full
// ~14.4k-symbol pass cannot fit any single edge-function invocation. A batch
// of ~50 stalest-first every 10 minutes covers the universe in ~2 days and
// then sustains a ~2-day refresh cadence per symbol. gics_sector stays NULL:
// profile2 has no sector field; the column is reserved for a future
// GICS-grade source.
//
// CURSOR RULES, PROFILE (Finnhub, so the cron cannot wedge): a PERMANENT-
// looking miss (404 / empty profile — delisted, funds, foreign) still
// advances enriched_at, or the cursor would spin on the same dead symbols
// forever. A TRANSIENT failure (429 / 5xx / network) aborts the batch
// WITHOUT advancing the failed symbol's cursor, so the next run retries it.
//
// CURSOR RULES, PRICE (Alpaca — see ./price-batch.ts for the full writeup;
// found 2026-09-25, docs/STATUS.md §4 / CLAUDE.md "success signals are
// unreliable" #7): Alpaca's multi-symbol snapshots endpoint is all-or-
// nothing, so one malformed symbol used to 400 an ENTIRE 50-symbol batch and
// silently drop up to 49 good prices while still reporting ok:true. Fixed
// with two independent defenses — partitionForAlpaca filters out symbol
// FORMATS Alpaca's us_equity universe structurally does not list (preferred/
// warrant/unit/rights/when-issued forms) before ever sending them, and
// fetchPricesBisecting bisects on any 400 that slips through anyway so one
// bad symbol costs only itself. `symbols.price_unsupported` is the explicit
// discriminator (never overload `last_price IS NULL`, per CLAUDE.md
// "Overloaded NULLs are type tags") that keeps permanently-unpriceable
// formats out of the price-priority batch-selection tier below. enriched_at
// is NOT reused for price cursor purposes — it already means "profile pass
// completed" and is read that way by apps/web + apps/mobile categoryData
// (`.not('enriched_at','is',null)` as an enrichment-coverage signal); price
// state lives entirely in last_price / price_unsupported instead.
//
// BATCH SELECTION (backfill for the ~4,749 already-unpriced symbols found
// 2026-09-25): up to half of every batch is drawn from the unpriced-and-
// supported priority tier (mergeBatchSelection / priorityCapFor in
// ./price-batch.ts), the rest from the normal stalest-first pool. The half
// cap is a STARVATION guard: without it, once symbols that chronically fail
// Alpaca's price lookup accumulate, they could fill an entire batch forever
// and stop the stalest-first profile refresh of the other ~14k symbols.
//
// Auth: cron-only — verify_jwt=false at the gateway; constant-time apikey
// check against SB_SECRET_KEY_CRON in-code (snapshot-week-start pattern,
// fail-closed).
//
// Effect-verify (per CLAUDE.md, counts not statuses): the response reports
// batch/profiled/priced/draftable/price_errors/price_status counts and
// unmatched_industries; the scheduled job's real check is data movement —
//   SELECT count(*) FILTER (WHERE active AND last_price IS NULL),
//          count(*) FILTER (WHERE is_draftable)
//   FROM symbols;
// trending down/up over the hours after deploy, plus BAC/F specifically.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { computeIsDraftable } from '../_shared/symbol-eligibility.ts';
import {
  computePriceStatus,
  fetchPricesBisecting,
  mergeBatchSelection,
  partitionForAlpaca,
  priorityCapFor,
  type BatchFetchResult,
} from './price-batch.ts';

const DEFAULT_BATCH = 50;
const MAX_BATCH = 80; // 80 * 1100ms = 88s Finnhub time — headroom under the 150s edge wall clock
const FINNHUB_SPACING_MS = 1100; // stay under 60 calls/min
const PRICE_ERROR_SYMBOLS_LOGGED = 20; // cap the rejected-symbols list in the response/log

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

/** One Alpaca snapshots request for one chunk of symbols. Logs a truncated
 * 400 body (Alpaca's own error message names the offending symbol) so a
 * genuine format gap in ALPACA_TICKER_RE is diagnosable from logs alone. */
function makeAlpacaFetcher(key: string, secret: string): (symbols: string[]) => Promise<BatchFetchResult> {
  return async (symbols: string[]): Promise<BatchFetchResult> => {
    const url = `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${
      symbols.map(encodeURIComponent).join(',')
    }&feed=iex`;
    try {
      const res = await fetch(url, {
        headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, 'Accept': 'application/json' },
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        console.error('alpaca snapshots failed', res.status, bodyText.slice(0, 300), 'chunk_size', symbols.length);
        return { ok: false, status: res.status };
      }
      const body = await res.json().catch(() => ({}));
      const prices = new Map<string, number>();
      for (const sym of symbols) {
        const snap = body?.[sym];
        const p = Number(snap?.latestTrade?.p) || Number(snap?.dailyBar?.c) || Number(snap?.prevDailyBar?.c);
        if (Number.isFinite(p) && p > 0) prices.set(sym, p);
      }
      return { ok: true, prices };
    } catch (e) {
      console.error('alpaca snapshots error', e, 'chunk_size', symbols.length);
      return { ok: false, status: 0 };
    }
  };
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

  // price_unsupported is filtered on (priority query below) but not selected:
  // the per-row loop recomputes it fresh from partitionForAlpaca every pass
  // rather than reading back a stale value (see the comment at its write).
  const selectCols = 'symbol, exchange, is_etf, active, gics_industry, last_price, market_cap';

  // Priority tier: unpriced AND not permanently-unsupported, stalest-first,
  // capped at half the batch (starvation guard — see price-batch.ts).
  const priorityCap = priorityCapFor(batchSize);
  const { data: priorityRows, error: prioErr } = await admin
    .from('symbols')
    .select(selectCols)
    .eq('active', true)
    .is('last_price', null)
    .eq('price_unsupported', false)
    .order('enriched_at', { ascending: true, nullsFirst: true })
    .limit(priorityCap);
  if (prioErr) return json({ error: 'select_failed' }, 500);

  // Normal stalest-first pool, excluding whatever the priority query already
  // picked so the merge below never has to dedupe past a LIMIT boundary.
  const prioritySymbols = (priorityRows ?? []).map((r) => String(r.symbol));
  let stalestQuery = admin
    .from('symbols')
    .select(selectCols)
    .eq('active', true)
    .order('enriched_at', { ascending: true, nullsFirst: true })
    .limit(batchSize);
  if (prioritySymbols.length > 0) {
    stalestQuery = stalestQuery.not('symbol', 'in', `(${prioritySymbols.join(',')})`);
  }
  const { data: stalestRows, error: staleErr } = await stalestQuery;
  if (staleErr) return json({ error: 'select_failed' }, 500);

  const batch = mergeBatchSelection(priorityRows ?? [], stalestRows ?? [], batchSize);
  if (batch.length === 0) return json({ ok: true, batch: 0 });

  // Known rule keys, to report unmatched vendor labels for curation.
  const { data: ruleRows } = await admin.from('category_rules').select('gics_industry');
  const knownIndustries = new Set((ruleRows ?? []).map((r) => String(r.gics_industry)));

  // Price fetch for the whole batch, up front (ETFs included — Alpaca still
  // prices them). Format-unsupported symbols never reach Alpaca at all.
  const { eligible: alpacaEligible, unsupported: formatUnsupported } = partitionForAlpaca(
    batch.map((r) => String(r.symbol)),
  );
  const bisectResult = await fetchPricesBisecting(alpacaEligible, makeAlpacaFetcher(ALPACA_KEY, ALPACA_SECRET));
  const priceErrorSet = new Set(bisectResult.failed);
  const formatUnsupportedSet = new Set(formatUnsupported);

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

    // Price outcome for this symbol, in priority order:
    //   1. format-unsupported (never sent to Alpaca) -> permanent, no error
    //   2. priced by Alpaca this run -> new last_price
    //   3. request-level failure (bisected 400 / cap-truncated) -> price_error,
    //      last_price left untouched so the row stays in the priority tier
    //   4. request succeeded but Alpaca had no data -> benign miss, keep old price
    // Case 3 (price_error) and case 4 (benign no-data) both leave `newPrice`
    // undefined and so fall through to the same "keep old price" branch
    // below — they differ only in the AGGREGATE price_errors/price_error_symbols
    // reporting at the end of this handler, built directly from priceErrorSet.
    const isFormatUnsupported = formatUnsupportedSet.has(symbol);
    const newPrice = bisectResult.prices.get(symbol);

    const lastPrice = newPrice ?? (row.last_price == null ? null : Number(row.last_price));
    if (newPrice !== undefined) priced++;
    // partitionForAlpaca classifies every symbol in the batch on every pass,
    // so this is simply that verdict — no reason to preserve a stale prior
    // value (format never changes; a price_error is a fetch failure, not a
    // format verdict, and does not affect this flag).
    const priceUnsupported = isFormatUnsupported;

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
        price_unsupported: priceUnsupported,
        is_draftable,
        enriched_at: new Date().toISOString(),
      })
      .eq('symbol', symbol);
    if (upErr) {
      console.error('update failed', symbol, upErr.message);
      // continue: one bad row must not starve the rest of the batch
    }
  }

  const priceErrorSymbols = [...priceErrorSet].slice(0, PRICE_ERROR_SYMBOLS_LOGGED);
  const priceStatus = computePriceStatus(alpacaEligible.length, priced, priceErrorSet.size);

  const result = {
    ok: true,
    batch: batch.length,
    profiled,
    priced,
    skipped_etf: skippedEtf,
    draftable_in_batch: draftable,
    transient_abort: transientAbort,
    unmatched_industries: [...unmatched],
    // Honest price-fetch reporting (found 2026-09-25: this used to report
    // ok:true, priced:0 on a whole-batch Alpaca 400 — see header). `ok`
    // above means "the run completed"; price_status is the separately-
    // scoped verdict for pricing specifically.
    price_status: priceStatus,
    price_errors: priceErrorSet.size,
    price_error_symbols: priceErrorSymbols,
    price_unsupported_in_batch: formatUnsupportedSet.size,
    alpaca_requests: bisectResult.requestCount,
    alpaca_request_cap_hit: bisectResult.capHit,
  };
  console.log('enrich-symbols', JSON.stringify(result));
  return json(result);
});
