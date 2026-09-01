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
