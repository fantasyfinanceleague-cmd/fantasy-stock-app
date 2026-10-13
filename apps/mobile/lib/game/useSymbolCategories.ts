/**
 * useSymbolCategories (W4 Draft): the categories of the stocks on the draft board, read in one
 * batch (three reads for the whole board, not three per stock) and kept for the session, so a
 * new pick reads only its own stock. The layers are symbolCategories.ts's.
 *
 * A failed read never fails the room and never guesses: those stocks stay unknown (no line,
 * no code) and the next new pick tries them again. With the capture seam on, the fixture's
 * categories, and no read.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { fetchCategories } from '../categoryData';
import { SEAM_ON } from './devSeam';
import { resolveSymbolCategories, seamSymbolCategories } from './symbolCategories';
import type { Category } from '../../components/sp/logic/gameNight';

const known = new Map<string, Category | null>();

async function readCategories(symbols: string[]): Promise<Record<string, Category | null> | null> {
  const [categories, overrides, industries] = await Promise.all([
    fetchCategories(),
    supabase.from('symbol_category_overrides').select('symbol, category_id').in('symbol', symbols),
    supabase.from('symbols').select('symbol, gics_industry').in('symbol', symbols),
  ]);
  if (categories.length === 0 || overrides.error || industries.error) return null;
  const inds = Array.from(new Set((industries.data ?? []).map((r) => r.gics_industry).filter((g): g is string => !!g)));
  const rules = inds.length > 0 ? await supabase.from('category_rules').select('gics_industry, category_id').in('gics_industry', inds) : { data: [], error: null };
  if (rules.error) return null;
  return resolveSymbolCategories({
    symbols,
    categories,
    overrides: (overrides.data ?? []) as { symbol: string; category_id: string }[],
    industries: (industries.data ?? []) as { symbol: string; gics_industry: string | null }[],
    rules: (rules.data ?? []) as { gics_industry: string; category_id: string }[],
  });
}

export function useSymbolCategories(symbols: readonly string[]): Record<string, Category | null> {
  const wanted = useMemo(() => Array.from(new Set(symbols.map((s) => s.toUpperCase()))).sort(), [symbols]);
  const key = wanted.join(',');
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (SEAM_ON) {
      const seam = seamSymbolCategories(wanted);
      let changed = false;
      for (const [s, c] of Object.entries(seam)) if (!known.has(s)) { known.set(s, c); changed = true; }
      if (changed) setVersion((v) => v + 1);
      return;
    }
    const missing = wanted.filter((s) => !known.has(s));
    if (missing.length === 0) return;
    let cancelled = false;
    void readCategories(missing).then((got) => {
      if (cancelled || !got) return;
      for (const s of missing) known.set(s, got[s] ?? null);
      setVersion((v) => v + 1);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the symbol set itself
  }, [key]);

  const out: Record<string, Category | null> = {};
  for (const s of wanted) out[s] = known.get(s) ?? null;
  return out;
}
