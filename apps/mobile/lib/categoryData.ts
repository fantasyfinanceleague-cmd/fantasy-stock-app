// Category / eligibility data helpers for league setup + drafting UI (Phase 4
// item 4 — DR-001). Mirror of apps/web/src/utils/categoryData.js — reads the
// seeded reference tables (authenticated SELECT) and symbols (PUBLIC read).
// Display-only: the authoritative eligibility logic lives in the
// validate-and-record-pick / record-trade edge functions.
import { supabase } from './supabase';

export type StakeMode = 'fixed_notional' | 'price_tiers' | 'budget_cap';

export const STAKE_MODE_OPTIONS: Array<{ value: StakeMode; label: string; icon: string; help: string }> = [
  {
    value: 'fixed_notional',
    label: 'Equal stakes',
    icon: 'scale',
    help: 'Every roster slot represents the same simulated dollar stake (fractional shares). Pick any stock without price strategy.',
  },
  {
    value: 'price_tiers',
    label: 'Price tiers',
    icon: 'layers',
    help: 'One share per pick; roster slots are bracketed by share-price ranges you define. Expensive stocks compete only with each other.',
  },
  {
    value: 'budget_cap',
    label: 'Budget cap',
    icon: 'wallet',
    help: 'One share per pick; the total of your roster’s share prices must fit under the league cap. Keep it tight so choices matter.',
  },
];

export const DEFAULT_NOTIONAL_PER_SLOT = 1000;
// A one-share cap must BIND: at the old $100k default a full roster of the
// priciest shares never touched it. ~$2,500 for a 6-slot roster forces real
// trade-offs.
export const DEFAULT_BUDGET_CAP = 2500;

export interface Category {
  id: string;
  slug: string;
  name: string;
  is_misc: boolean;
}

export interface SlotDraft {
  slotCount: number;
  priceMin: string; // '' = no floor
  priceMax: string; // '' = no ceiling
  categoryId: string; // '' = flex
}

let categoriesCache: Category[] | null = null;

export async function fetchCategories(): Promise<Category[]> {
  if (categoriesCache) return categoriesCache;
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug, name, is_misc')
    .order('display_order', { ascending: true });
  if (error) return [];
  categoriesCache = (data as Category[]) || [];
  return categoriesCache;
}

/** Display eligibility: overrides if any, else rule for the vendor industry
 * label, else [] (unclassified -> flex-only). */
export async function fetchSymbolCategories(
  symbol: string,
): Promise<{ categories: Category[]; classified: boolean }> {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return { categories: [], classified: false };
  const cats = await fetchCategories();
  const byId = new Map(cats.map((c) => [c.id, c]));

  const { data: ovr } = await supabase
    .from('symbol_category_overrides')
    .select('category_id')
    .eq('symbol', sym);
  if (ovr && ovr.length > 0) {
    return {
      categories: ovr.map((o) => byId.get(o.category_id)).filter(Boolean) as Category[],
      classified: true,
    };
  }

  const { data: symRow } = await supabase
    .from('symbols')
    .select('gics_industry')
    .eq('symbol', sym)
    .maybeSingle();
  if (!symRow?.gics_industry) return { categories: [], classified: false };

  const { data: rule } = await supabase
    .from('category_rules')
    .select('category_id')
    .eq('gics_industry', symRow.gics_industry)
    .maybeSingle();
  const cat = rule?.category_id ? byId.get(rule.category_id) : undefined;
  return { categories: cat ? [cat] : [], classified: !!cat };
}

export async function fetchEnrichmentProgress(): Promise<{ enriched: number; total: number; partial: boolean }> {
  const [{ count: total }, { count: enriched }] = await Promise.all([
    supabase.from('symbols').select('symbol', { count: 'exact', head: true }).eq('active', true),
    supabase.from('symbols').select('symbol', { count: 'exact', head: true }).eq('active', true).not('enriched_at', 'is', null),
  ]);
  const t = total || 0;
  const e = enriched || 0;
  return { enriched: e, total: t, partial: t === 0 || e < t * 0.9 };
}

/** Draftable symbols matching one slot — exact overrides-replace-rule count
 * (the overrides table is small enough to fetch whole). */
export async function countSlotMatches(
  slot: { priceMin: number | null; priceMax: number | null; categoryId: string | null },
): Promise<number> {
  const base = () => {
    let q = supabase
      .from('symbols')
      .select('symbol', { count: 'exact', head: true })
      .eq('is_draftable', true);
    if (slot.priceMin != null) q = q.gte('last_price', slot.priceMin);
    if (slot.priceMax != null) q = q.lte('last_price', slot.priceMax);
    return q;
  };

  if (!slot.categoryId) {
    const { count } = await base();
    return count || 0;
  }

  const [{ data: ruleRows }, { data: allOverrides }] = await Promise.all([
    supabase.from('category_rules').select('gics_industry').eq('category_id', slot.categoryId),
    supabase.from('symbol_category_overrides').select('symbol, category_id'),
  ]);
  const industries = (ruleRows || []).map((r) => r.gics_industry as string);
  const overridden = [...new Set((allOverrides || []).map((o) => o.symbol as string))];
  const catOverrideSyms = [
    ...new Set((allOverrides || []).filter((o) => o.category_id === slot.categoryId).map((o) => o.symbol as string)),
  ];

  let ruleCount = 0;
  if (industries.length > 0) {
    let q = base().in('gics_industry', industries);
    if (overridden.length > 0) q = q.not('symbol', 'in', `(${overridden.join(',')})`);
    const { count } = await q;
    ruleCount = count || 0;
  }

  let ovrCount = 0;
  if (catOverrideSyms.length > 0) {
    const { count } = await base().in('symbol', catOverrideSyms);
    ovrCount = count || 0;
  }

  return ruleCount + ovrCount;
}

/** Replace a league's slot definitions (commissioner-only via RLS; callers
 * gate on draft_status). */
export async function saveLeagueSlots(leagueId: string, slots: SlotDraft[]): Promise<void> {
  const { error: delErr } = await supabase
    .from('league_draft_slots')
    .delete()
    .eq('league_id', leagueId);
  if (delErr) throw delErr;
  if (!slots.length) return;
  const rows = slots.map((s, i) => ({
    league_id: leagueId,
    slot_index: i,
    slot_count: Math.max(1, Number(s.slotCount) || 1),
    price_min: s.priceMin === '' ? null : Number(s.priceMin),
    price_max: s.priceMax === '' ? null : Number(s.priceMax),
    category_id: s.categoryId || null,
  }));
  const { error: insErr } = await supabase.from('league_draft_slots').insert(rows);
  if (insErr) throw insErr;
}

/** Load a league's slots into SlotDraft form for the builder. */
export async function loadLeagueSlots(leagueId: string): Promise<SlotDraft[]> {
  const { data } = await supabase
    .from('league_draft_slots')
    .select('slot_index, slot_count, price_min, price_max, category_id')
    .eq('league_id', leagueId)
    .order('slot_index', { ascending: true });
  return (data || []).map((r) => ({
    slotCount: r.slot_count as number,
    priceMin: r.price_min == null ? '' : String(r.price_min),
    priceMax: r.price_max == null ? '' : String(r.price_max),
    categoryId: (r.category_id as string) ?? '',
  }));
}
