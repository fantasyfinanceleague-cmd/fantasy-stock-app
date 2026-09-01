// Category / eligibility data helpers for league setup + drafting UI (Phase 4
// item 4 — DR-001). Reads only the seeded reference tables (categories,
// category_rules, symbol_category_overrides — authenticated SELECT per Phase 2
// RLS) and symbols (PUBLIC read policy).
//
// These MIRROR the server's rules for display: the authoritative eligibility
// logic lives in the validate-and-record-pick / record-trade edge functions
// (supabase/functions/_shared/draft-validation.ts). Overrides REPLACE the rule
// category; unclassified symbols are flex-only.
import { supabase } from '../supabase/supabaseClient';
import { coverageIsPartial } from '@fantasy-stock/shared';

export const STAKE_MODE_OPTIONS = [
  {
    value: 'fixed_notional',
    label: 'Equal stakes',
    help: 'Every roster slot represents the same simulated dollar stake (fractional shares). Price-neutral — pick any stock without price strategy.',
  },
  {
    value: 'price_tiers',
    label: 'Price tiers',
    help: 'One share per pick; roster slots are bracketed by share-price ranges you define below. Expensive stocks compete only with each other.',
  },
  {
    value: 'budget_cap',
    label: 'Budget cap',
    help: 'One share per pick; the total of your roster’s share prices must fit under the league cap. Keep the cap tight so choices matter.',
  },
];

/** Plain-language label for a league's stake_mode; 'Not set' for NULL/legacy leagues. */
export function stakeModeLabel(stakeMode) {
  return STAKE_MODE_OPTIONS.find((o) => o.value === stakeMode)?.label ?? 'Not set';
}

export const DEFAULT_NOTIONAL_PER_SLOT = 1000;
// A one-share cap must BIND to shape the draft: at the old $100k default a
// full roster of the priciest shares never touched it. ~$2,500 for a 6-slot
// roster forces real trade-offs (avg ~$400/share).
export const DEFAULT_BUDGET_CAP = 2500;

let categoriesCache = null;

/** Ordered category list [{id, slug, name, is_misc}]. Cached per page load. */
export async function fetchCategories() {
  if (categoriesCache) return categoriesCache;
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug, name, is_misc')
    .order('display_order', { ascending: true });
  if (error) return [];
  categoriesCache = data || [];
  return categoriesCache;
}

/**
 * Display eligibility for one symbol: overrides if any, else the rule for its
 * vendor industry label, else [] (unclassified -> flex-only).
 * Returns { categories: [{id, slug, name}], classified: boolean }.
 */
export async function fetchSymbolCategories(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return { categories: [], classified: false };
  const cats = await fetchCategories();
  const byId = new Map(cats.map((c) => [c.id, c]));

  const { data: ovr } = await supabase
    .from('symbol_category_overrides')
    .select('category_id')
    .eq('symbol', sym);
  if (ovr && ovr.length > 0) {
    return { categories: ovr.map((o) => byId.get(o.category_id)).filter(Boolean), classified: true };
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
  if (!rule?.category_id) return { categories: [], classified: false };
  const cat = byId.get(rule.category_id);
  return { categories: cat ? [cat] : [], classified: !!cat };
}

/** {enriched, total, partial} over the active universe — feasibility counts
 * are lower bounds while the enrichment cron is still covering the universe. */
export async function fetchEnrichmentProgress() {
  const [{ count: total }, { count: enriched }] = await Promise.all([
    supabase.from('symbols').select('symbol', { count: 'exact', head: true }).eq('active', true),
    supabase.from('symbols').select('symbol', { count: 'exact', head: true }).eq('active', true).not('enriched_at', 'is', null),
  ]);
  const t = total || 0;
  const e = enriched || 0;
  // partial reads LIVE coverage (e/t queried above) against the shared threshold.
  return { enriched: e, total: t, partial: coverageIsPartial(e, t) };
}

/**
 * How many draftable symbols match one slot definition?
 * Category slots are computed with the overrides-REPLACE-rule semantics
 * exactly: rule-path counts exclude ALL overridden symbols (the overrides
 * table is small), then this category's override symbols are added back.
 */
export async function countSlotMatches({ priceMin, priceMax, categoryId }) {
  const base = () => {
    let q = supabase
      .from('symbols')
      .select('symbol', { count: 'exact', head: true })
      .eq('is_draftable', true);
    if (priceMin != null && priceMin !== '') q = q.gte('last_price', Number(priceMin));
    if (priceMax != null && priceMax !== '') q = q.lte('last_price', Number(priceMax));
    return q;
  };

  if (!categoryId) {
    const { count } = await base();
    return count || 0;
  }

  const [{ data: ruleRows }, { data: allOverrides }] = await Promise.all([
    supabase.from('category_rules').select('gics_industry').eq('category_id', categoryId),
    supabase.from('symbol_category_overrides').select('symbol, category_id'),
  ]);
  const industries = (ruleRows || []).map((r) => r.gics_industry);
  const overridden = [...new Set((allOverrides || []).map((o) => o.symbol))];
  const catOverrideSyms = [
    ...new Set((allOverrides || []).filter((o) => o.category_id === categoryId).map((o) => o.symbol)),
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

/**
 * HARD slot-config errors (block create/save — distinct from soft feasibility
 * warnings). Mirror of the mobile validator: once a league has ANY slots the
 * server requires every pick to land in an unfilled slot, so total slot count
 * must equal stocks-per-team exactly; inverted brackets would fail the DB
 * CHECK at save time.
 */
export function validateSlotConfig(slots, numRounds) {
  const errors = [];
  if (slots.length === 0) return errors;
  let total = 0;
  slots.forEach((s, i) => {
    const count = Number(s.slotCount);
    if (!(count > 0)) errors.push(`Slot ${i + 1}: count must be at least 1.`);
    else total += count;
    const min = s.priceMin === '' || s.priceMin == null ? null : Number(s.priceMin);
    const max = s.priceMax === '' || s.priceMax == null ? null : Number(s.priceMax);
    if (min != null && max != null && min > max) {
      errors.push(`Slot ${i + 1}: min price is above max price.`);
    }
  });
  if (total !== numRounds) {
    errors.push(
      total > numRounds
        ? `Slots cover ${total} picks but each team drafts only ${numRounds} (stocks per team) — remove ${total - numRounds}.`
        : `Slots cover only ${total} of ${numRounds} picks — once slots exist, every pick needs an open slot, so the draft would jam after ${total}. Add ${numRounds - total} more.`,
    );
  }
  return errors;
}
