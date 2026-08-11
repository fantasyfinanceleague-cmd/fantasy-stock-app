# Simulator seed data — STUBS (full content is Phase 4)

These files carry the Stockpile-curated category data that layers over vendor
GICS taxonomy (DR-001). The **schema** for their target tables ships in Phase 2
(`supabase/migrations/20260810000003_create_categories_tables.sql`); the **data**
below is authored and reviewed in **Phase 4** (SIMULATOR_MIGRATION_SPEC lines
89–94). The stub files exist now so the shape is fixed and code can reference
stable slugs; they are intentionally near-empty until Phase 4.

| Stub file | Target table | Phase 4 content |
|---|---|---|
| `categories.json` | `categories` | ~10 curated, player-intuitive categories (incl. the `is_misc` fallback). |
| `category_rules.json` | `category_rules` | ~160 GICS-industry → category rows; total coverage of the vendor taxonomy. |
| `symbol_category_overrides.json` | `symbol_category_overrides` | ~30–60 curated exceptions, each with a one-line justification per the DR-001 criterion (distinct segment ≥ ~1/3 revenue, or the famous-for-it test). Cap: ≤3 categories per symbol (enforced in-schema by the `symbol_category_overrides_cap` trigger). |

**Phase 4 authoring rules (from the spec):**
- Generate the override draft against the top ~500 draftable names; Giorgio
  reviews before merge.
- Every override row needs a written justification (the table's `justification`
  column is `NOT NULL`).
- Unclassified symbols (no rule match, no override) fall through to Misc /
  flex-only until the daily refresh classifies them.

The category `slug` values are the stable join key between these seeds and code;
do not renumber or rename slugs once seeded.
