/**
 * DB-backed effective-category lookup for one symbol (Phase 4). The pure
 * layer-resolution rule lives in draft-validation.ts (effectiveCategoryIds);
 * this helper only performs the three reads: overrides -> symbols.gics_industry
 * -> category_rules. Throws on read failure — callers 500 rather than treating
 * a DB error as "unclassified" (which would silently change legality).
 */
import { effectiveCategoryIds } from './draft-validation.ts';

// deno-lint-ignore no-explicit-any
export async function fetchEligibleCategoryIds(admin: any, symbol: string): Promise<Set<string>> {
  const sym = symbol.toUpperCase();

  const { data: ovr, error: oErr } = await admin
    .from('symbol_category_overrides')
    .select('category_id')
    .eq('symbol', sym);
  if (oErr) throw new Error('eligibility_fetch_failed');
  // deno-lint-ignore no-explicit-any
  const overrideIds = (ovr ?? []).map((o: any) => String(o.category_id));
  if (overrideIds.length > 0) return effectiveCategoryIds(overrideIds, null);

  const { data: symRow, error: sErr } = await admin
    .from('symbols')
    .select('gics_industry')
    .eq('symbol', sym)
    .maybeSingle();
  if (sErr) throw new Error('eligibility_fetch_failed');
  const industry = symRow?.gics_industry ?? null;
  if (!industry) return effectiveCategoryIds([], null); // unclassified -> flex-only

  const { data: rule, error: rErr } = await admin
    .from('category_rules')
    .select('category_id')
    .eq('gics_industry', industry)
    .maybeSingle();
  if (rErr) throw new Error('eligibility_fetch_failed');
  return effectiveCategoryIds([], rule?.category_id ? String(rule.category_id) : null);
}

/**
 * The same three-layer lookup for MANY symbols in three reads total (the
 * auto-pick pre-filters a whole candidate pool by category; per-symbol reads
 * would be 3×pool-size round trips). Same layer rule, same throw-on-error
 * contract as fetchEligibleCategoryIds. Every requested symbol gets an entry
 * (empty set = unclassified -> flex-only).
 */
export async function fetchEligibleCategoryIdsBatch(
  // deno-lint-ignore no-explicit-any
  admin: any,
  symbols: string[],
): Promise<Map<string, Set<string>>> {
  const syms = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const out = new Map<string, Set<string>>();
  if (syms.length === 0) return out;

  const { data: ovr, error: oErr } = await admin
    .from('symbol_category_overrides')
    .select('symbol, category_id')
    .in('symbol', syms);
  if (oErr) throw new Error('eligibility_fetch_failed');
  const overrides = new Map<string, string[]>();
  // deno-lint-ignore no-explicit-any
  for (const o of (ovr ?? []) as any[]) {
    const s = String(o.symbol).toUpperCase();
    overrides.set(s, [...(overrides.get(s) ?? []), String(o.category_id)]);
  }

  const { data: symRows, error: sErr } = await admin
    .from('symbols')
    .select('symbol, gics_industry')
    .in('symbol', syms);
  if (sErr) throw new Error('eligibility_fetch_failed');
  const industryBySymbol = new Map<string, string>();
  // deno-lint-ignore no-explicit-any
  for (const r of (symRows ?? []) as any[]) {
    if (r.gics_industry) industryBySymbol.set(String(r.symbol).toUpperCase(), String(r.gics_industry));
  }

  const industries = [...new Set(industryBySymbol.values())];
  const ruleByIndustry = new Map<string, string>();
  if (industries.length > 0) {
    const { data: rules, error: rErr } = await admin
      .from('category_rules')
      .select('gics_industry, category_id')
      .in('gics_industry', industries);
    if (rErr) throw new Error('eligibility_fetch_failed');
    // deno-lint-ignore no-explicit-any
    for (const r of (rules ?? []) as any[]) {
      if (r.category_id) ruleByIndustry.set(String(r.gics_industry), String(r.category_id));
    }
  }

  for (const s of syms) {
    const industry = industryBySymbol.get(s);
    out.set(s, effectiveCategoryIds(overrides.get(s) ?? [], industry ? ruleByIndustry.get(industry) ?? null : null));
  }
  return out;
}
