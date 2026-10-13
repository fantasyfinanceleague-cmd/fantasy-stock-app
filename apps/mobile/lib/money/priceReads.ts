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
  /** The daily bars read (ascending), per symbol: the previous closes come from them, and
   * Portfolio's value line and the player cards' season lines reuse them (W4). */
  bars: Record<string, DailyBar[]>;
  /** New network reads this call made (0 for no symbols). */
  requests: number;
}

export interface PriceMarksOptions {
  /** Also read bars for these symbols (e.g. every stock ever held), in the same request. */
  barsSymbols?: string[];
  /** The bars' first date (YYYY-MM-DD); the default is the last 10 days (the previous close). */
  barsStart?: string | null;
}

function etIsoDate(d: Date): string | null {
  const p = etDateParts(d);
  if (!p) return null;
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export async function readPriceMarks(symbols: string[], now: Date = new Date(), opts: PriceMarksOptions = {}): Promise<PriceMarks> {
  const out: PriceMarks = { prices: {}, prevCloses: {}, bars: {}, requests: 0 };
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
    const tenDays = new Date(now.getTime() - 10 * 86_400_000).toISOString().slice(0, 10);
    const start = opts.barsStart && opts.barsStart < tenDays ? opts.barsStart : tenDays;
    const barSymbols = [...new Set([...symbols, ...(opts.barsSymbols ?? [])].map((x) => x.toUpperCase()))];
    const { data: barsData, error: barsError } = await supabase.functions.invoke('historical-bars', { body: { symbols: barSymbols, start } });
    if (barsError) console.warn('[prices] historical-bars failed', barsError.message);
    else {
      const raw = (barsData?.bars ?? {}) as Record<string, { t: string; c: number }[]>;
      for (const [sym, series] of Object.entries(raw)) {
        const bars: DailyBar[] = series
          .map((b) => ({ date: b.t.slice(0, 10), close: b.c }))
          .filter((b) => typeof b.close === 'number' && Number.isFinite(b.close) && b.close > 0)
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        out.bars[sym.toUpperCase()] = bars;
        const prev = prevCloseFromBars(bars, todayEt);
        if (prev != null) out.prevCloses[sym.toUpperCase()] = prev;
      }
    }
  }
  return out;
}
