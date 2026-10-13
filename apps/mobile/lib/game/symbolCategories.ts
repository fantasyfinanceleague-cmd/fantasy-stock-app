/**
 * symbolCategories (W4 Draft): each drafted stock's category, for the draft tile's 3pt line
 * and its 3-letter code (§9C; Giorgio, 2026-10-12: "color coded just with that line at the
 * bottom … you kind of see the breakdown by sector"). The app's real categories, never a
 * sample sector (the W4 gate's "Draft tiles" row).
 *
 * The schema's three layers (20260810000003_create_categories_tables.sql), in order:
 *   2. a curated override (symbol_category_overrides; up to 3 per symbol): the first in the
 *      categories' display order, since a tile shows one;
 *   1. the GICS industry's rule (symbols.gics_industry → category_rules);
 *   3. otherwise the Misc row (categories.is_misc), the layer-3 fallback.
 * Only called on reads that SUCCEEDED: a failed read is no category at all (no line, no
 * code), never Misc. Pure, so tests-deno pins it.
 */
import { CATEGORIES, type Category } from '../../components/sp/logic/gameNight';

export interface CategoryRef {
  id: string;
  slug: string;
  is_misc?: boolean;
}

export function isCategory(slug: string | null | undefined): slug is Category {
  return typeof slug === 'string' && Object.prototype.hasOwnProperty.call(CATEGORIES, slug);
}

export function resolveSymbolCategories(input: {
  symbols: readonly string[];
  /** In display order (fetchCategories orders by display_order). */
  categories: readonly CategoryRef[];
  overrides: readonly { symbol: string; category_id: string }[];
  industries: readonly { symbol: string; gics_industry: string | null }[];
  rules: readonly { gics_industry: string; category_id: string }[];
}): Record<string, Category | null> {
  const rank = new Map(input.categories.map((c, i) => [String(c.id), i]));
  const slugOf = new Map(input.categories.map((c) => [String(c.id), c.slug]));
  const misc = input.categories.find((c) => c.is_misc === true)?.slug ?? null;
  const industryOf = new Map(input.industries.map((r) => [r.symbol.toUpperCase(), r.gics_industry]));
  const ruleOf = new Map(input.rules.map((r) => [r.gics_industry, String(r.category_id)]));
  const out: Record<string, Category | null> = {};
  for (const raw of input.symbols) {
    const sym = raw.toUpperCase();
    const own = input.overrides
      .filter((o) => o.symbol.toUpperCase() === sym && rank.has(String(o.category_id)))
      .sort((a, b) => (rank.get(String(a.category_id)) ?? 0) - (rank.get(String(b.category_id)) ?? 0));
    let slug: string | null = null;
    if (own.length > 0) slug = slugOf.get(String(own[0].category_id)) ?? null;
    else {
      const industry = industryOf.get(sym) ?? null;
      const ruled = industry ? ruleOf.get(industry) : undefined;
      slug = ruled ? slugOf.get(ruled) ?? null : misc;
    }
    out[sym] = isCategory(slug) ? slug : null;
  }
  return out;
}

/** The capture seam's categories for the draft fixtures' stocks (seamRoom.ts), so the board
 * shows the breakdown a real draft would. Anything not listed falls to Misc, as the real
 * layer 3 does. */
const SEAM_CATEGORIES: Record<string, Category> = {
  MSFT: 'tech', NVDA: 'tech', META: 'media', AMZN: 'retail', GOOGL: 'media', COIN: 'finance',
  JPM: 'finance', AMD: 'tech', PLTR: 'tech', AAPL: 'tech', CRM: 'tech', TSLA: 'transport',
  COST: 'retail', V: 'finance', AVGO: 'tech', NFLX: 'media', ORCL: 'tech', ADBE: 'tech',
  INTC: 'tech', QCOM: 'tech', TXN: 'tech', IBM: 'tech', UBER: 'transport', SHOP: 'retail',
  SNOW: 'tech', PYPL: 'finance', DIS: 'media', NKE: 'retail', SBUX: 'food', MCD: 'food',
  KO: 'food', PEP: 'food', WMT: 'retail', HD: 'retail', BAC: 'finance', GS: 'finance',
  MA: 'finance', UNH: 'health', LLY: 'health', XOM: 'energy', CVX: 'energy', NEE: 'energy',
  CAT: 'industrials', DE: 'industrials', GE: 'industrials', PLD: 'realestate', AMT: 'realestate',
  JNJ: 'health', PFE: 'health', MRK: 'health', CMCSA: 'media', BRKB: 'finance', ABNB: 'retail',
};

export function seamSymbolCategories(symbols: readonly string[]): Record<string, Category | null> {
  const out: Record<string, Category | null> = {};
  for (const s of symbols) out[s.toUpperCase()] = SEAM_CATEGORIES[s.toUpperCase()] ?? 'misc';
  return out;
}
