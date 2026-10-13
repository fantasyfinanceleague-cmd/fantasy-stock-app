/**
 * App-key latest-price fetch for simulator fills (Phase 3, DR-001).
 *
 * Same three-stage IEX fallback chain as the quote function (trade → bar →
 * quote), same app-wide ALPACA_API_KEY — no per-user credentials. Extracted
 * here so validate-and-record-pick and record-trade share ONE fill-price
 * implementation instead of each re-implementing quote's chain. quote/index.ts
 * still carries its own copy (it additionally computes prevClose/changePercent
 * and caches); unifying it onto this module is a follow-up, not Phase 3.
 *
 * "Market-hours handling can be 'last available quote' for launch" (spec):
 * outside market hours the latest trade/bar is simply the last session's —
 * no market-hours gate here by design. (2026-09-30: record-trade itself now
 * refuses off-hours buys/sells before it ever calls this — see
 * ./market-hours.ts — so this module's "last available quote" behavior is
 * exercised only by preview, which has no gate. This function's own
 * contract is unchanged.)
 */

const BASE = 'https://data.alpaca.markets/v2';
const FEED_QS = '?feed=iex';

/** Per-request timeout (2026-10-13): a hung Alpaca request must not hold an edge
 * invocation (or a draft turn) open. A timeout rejects like a network error. */
export const ALPACA_TIMEOUT_MS = 5_000;

async function alpacaGet(url: string, key: string, secret: string) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ALPACA_TIMEOUT_MS),
    headers: {
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret,
      'Accept': 'application/json',
    },
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return { ok: false as const, status: res.status, preview: text.slice(0, 400) };
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }
  return { ok: true as const, status: res.status, body: body as Record<string, unknown> };
}

export interface FillPrice {
  price: number | null;
  source: string;
  error?: { step: string; status: number } | null;
}

/** One fallback stage. A network error or the ALPACA_TIMEOUT_MS abort is that
 * STAGE failing (status 0), never an exception out of fetchFillPrice (review L5,
 * 2026-10-13): the chain moves on to the next stage, and if every stage fails the
 * caller gets price null, its existing "no price" path, not a 500. */
async function stage(url: string, key: string, secret: string) {
  try {
    return await alpacaGet(url, key, secret);
  } catch (e) {
    console.error('alpaca stage failed', String(e).slice(0, 120));
    return { ok: false as const, status: 0, preview: '' };
  }
}

/** Latest usable price for one symbol, or price:null if all three stages fail. */
export async function fetchFillPrice(
  symbol: string,
  key: string,
  secret: string,
): Promise<FillPrice> {
  const sym = encodeURIComponent(symbol.toUpperCase());
  let lastErr: { step: string; status: number } | null = null;

  // 1) latest trade — most reliable in the IEX feed
  {
    const r = await stage(`${BASE}/stocks/${sym}/trades/latest${FEED_QS}`, key, secret);
    if (r.ok) {
      const p = Number((r.body?.trade as Record<string, unknown>)?.p);
      if (Number.isFinite(p) && p > 0) return { price: p, source: 'trade.p' };
    } else {
      lastErr = { step: 'trade', status: r.status };
    }
  }

  // 2) latest bar close
  {
    const r = await stage(`${BASE}/stocks/${sym}/bars/latest${FEED_QS}`, key, secret);
    if (r.ok) {
      const c = Number((r.body?.bar as Record<string, unknown>)?.c);
      if (Number.isFinite(c) && c > 0) return { price: c, source: 'bar.c' };
    } else {
      lastErr = { step: 'bar', status: r.status };
    }
  }

  // 3) latest quote (bid preferred; IEX quotes can be stale, so last resort)
  {
    const r = await stage(`${BASE}/stocks/${sym}/quotes/latest${FEED_QS}`, key, secret);
    if (r.ok) {
      const q = r.body?.quote as Record<string, unknown> | undefined;
      const bp = Number(q?.bp);
      const ap = Number(q?.ap);
      if (Number.isFinite(bp) && bp > 0) return { price: bp, source: 'quote.bp' };
      if (Number.isFinite(ap) && ap > 0) return { price: ap, source: 'quote.ap' };
    } else {
      lastErr = { step: 'quote', status: r.status };
    }
  }

  return { price: null, source: '', error: lastErr };
}

/**
 * The auto-pick SCREEN's prices out of one /v2/stocks/snapshots body (2026-10-13).
 * The same two sources fetchFillPrice tries first, in the same order: the latest
 * trade, then the latest minute bar's close. A symbol with neither (only a quote,
 * or no data) is left out, so the caller prices it with fetchFillPrice instead.
 * PURE.
 */
export function parseSnapshotPrices(body: unknown, symbols: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!body || typeof body !== 'object') return out;
  const rows = body as Record<string, unknown>;
  for (const sym of symbols) {
    const snap = rows[sym] as Record<string, unknown> | null | undefined;
    if (!snap || typeof snap !== 'object') continue;
    const trade = Number((snap.latestTrade as Record<string, unknown> | undefined)?.p);
    const bar = Number((snap.minuteBar as Record<string, unknown> | undefined)?.c);
    const p = Number.isFinite(trade) && trade > 0 ? trade : Number.isFinite(bar) && bar > 0 ? bar : null;
    if (p != null) out.set(sym, p);
  }
  return out;
}

/**
 * ONE multi-symbol snapshots request (IEX feed, the app key). The endpoint is
 * all-or-nothing: one symbol Alpaca does not list 400s the whole request, so the
 * caller bisects (./price-bisect.ts fetchPricesBisecting). Network
 * errors propagate.
 */
export async function fetchSnapshotPrices(
  symbols: string[],
  key: string,
  secret: string,
): Promise<{ ok: true; prices: Map<string, number> } | { ok: false; status: number }> {
  const syms = symbols.map((s) => s.toUpperCase());
  const r = await alpacaGet(`${BASE}/stocks/snapshots?symbols=${syms.map(encodeURIComponent).join(',')}&feed=iex`, key, secret);
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, prices: parseSnapshotPrices(r.body, syms) };
}
