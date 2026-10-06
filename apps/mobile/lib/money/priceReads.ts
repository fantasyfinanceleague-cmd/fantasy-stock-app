/**
 * priceReads: the live prices and previous closes for a set of symbols (3e), as
 * the quote batch and the daily bars. Each read is error-checked: a failed read
 * leaves its prices empty (the view captions them at cost, or hides Today).
 */
import { etDateParts } from '../time/etParts';
import { supabase } from '@/lib/supabase';
import { prevCloseFromBars, type DailyBar } from './prevClose';

export interface PriceMarks {
  prices: Record<string, number>;
  prevCloses: Record<string, number>;
  /** New network reads this call made (0 for no symbols). */
  requests: number;
}

function etIsoDate(d: Date): string | null {
  const p = etDateParts(d);
  if (!p) return null;
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export async function readPriceMarks(symbols: string[], now: Date = new Date()): Promise<PriceMarks> {
  const out: PriceMarks = { prices: {}, prevCloses: {}, requests: 0 };
  if (symbols.length === 0) return out;

  out.requests += 1;
  const { data: quoteData, error: quoteError } = await supabase.functions.invoke('quote', { body: { symbols } });
  if (quoteError) console.warn('[prices] quote failed', quoteError.message);
  else {
    for (const [sym, p] of Object.entries((quoteData?.prices ?? {}) as Record<string, unknown>)) {
      if (typeof p === 'number' && Number.isFinite(p) && p > 0) out.prices[sym.toUpperCase()] = p;
    }
  }

  const todayEt = etIsoDate(now);
  if (todayEt) {
    out.requests += 1;
    const start = new Date(now.getTime() - 10 * 86_400_000).toISOString().slice(0, 10);
    const { data: barsData, error: barsError } = await supabase.functions.invoke('historical-bars', { body: { symbols, start } });
    if (barsError) console.warn('[prices] historical-bars failed', barsError.message);
    else {
      const raw = (barsData?.bars ?? {}) as Record<string, { t: string; c: number }[]>;
      for (const [sym, series] of Object.entries(raw)) {
        const bars: DailyBar[] = series.map((b) => ({ date: b.t.slice(0, 10), close: b.c }));
        const prev = prevCloseFromBars(bars, todayEt);
        if (prev != null) out.prevCloses[sym.toUpperCase()] = prev;
      }
    }
  }
  return out;
}
