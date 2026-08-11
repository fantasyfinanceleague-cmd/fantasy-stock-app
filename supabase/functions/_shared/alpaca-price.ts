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
 * no market-hours gate here by design.
 */

const BASE = 'https://data.alpaca.markets/v2';
const FEED_QS = '?feed=iex';

async function alpacaGet(url: string, key: string, secret: string) {
  const res = await fetch(url, {
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
    const r = await alpacaGet(`${BASE}/stocks/${sym}/trades/latest${FEED_QS}`, key, secret);
    if (r.ok) {
      const p = Number((r.body?.trade as Record<string, unknown>)?.p);
      if (Number.isFinite(p) && p > 0) return { price: p, source: 'trade.p' };
    } else {
      lastErr = { step: 'trade', status: r.status };
    }
  }

  // 2) latest bar close
  {
    const r = await alpacaGet(`${BASE}/stocks/${sym}/bars/latest${FEED_QS}`, key, secret);
    if (r.ok) {
      const c = Number((r.body?.bar as Record<string, unknown>)?.c);
      if (Number.isFinite(c) && c > 0) return { price: c, source: 'bar.c' };
    } else {
      lastErr = { step: 'bar', status: r.status };
    }
  }

  // 3) latest quote (bid preferred; IEX quotes can be stale, so last resort)
  {
    const r = await alpacaGet(`${BASE}/stocks/${sym}/quotes/latest${FEED_QS}`, key, secret);
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
