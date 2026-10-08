/**
 * categoryNames: the app's category-name cache for the tier words (3e). It
 * fills from fetchCategories() (lib/categoryData.ts, cached once per session),
 * and the pure tier functions read it through a resolver. A name that hasn't
 * loaded resolves to null, and the words fall back (never "Category").
 */
import { fetchCategories } from '../categoryData';

const names = new Map<string, string>();

/** Loads the category names into the cache. Safe to call again (fetchCategories is cached). */
export async function loadCategoryNames(): Promise<void> {
  const cats = await fetchCategories();
  for (const c of cats) {
    if (c.id && c.name) names.set(c.id, c.name);
  }
}

/** The name for a category id, or null when it hasn't loaded or doesn't exist. */
export function categoryNameOf(categoryId: string): string | null {
  return names.get(categoryId) ?? null;
}
