# Simulator seed data (Phase 4 content — REVIEW REQUIRED before merge)

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


---

## Phase 4 status (2026-08-11)

The three files now carry the full Phase 4 content: 11 categories (10 curated +
`misc` fallback), 80 industry rules, 91 overrides across 55 symbols (max 3 per
symbol, generator-validated before the DB trigger ever sees them).

**Deviation from the spec's "~160 rules", and why:** the spec's count assumed a
GICS sub-industry taxonomy (163 values). Vendor reality: neither the NASDAQ
Trader universe feed (refresh-symbols' actual source) nor Alpaca's market-data
API exposes sector/industry at all, so enrichment uses **Finnhub `profile2`'s
`finnhubIndustry`** (the FINNHUB_API_KEY already in the stack). That vocabulary
is coarser (~50 labels, derived from GICS *industry* names). The rules file
covers that operative vocabulary completely, plus common naming variants —
"total coverage of the vendor taxonomy" per the spec's intent, at the vendor's
actual granularity. Any label that slips through falls to Misc **by design**
(flex-only, never an error) and is logged by `enrich-symbols` as
`unmatched_industries` for curation here.

**Override semantics reminder:** overrides REPLACE rule eligibility (they are
not additive), so every multi-category entry restates its primary category.
Several single-row overrides exist purely to correct a coarse rule mapping
(hotels/cruises/casinos land in Food via the "Hotels Restaurants & Leisure"
label; games land in Retail via "Leisure Products").

**Apply path:** `node scripts/gen-category-seed-migration.mjs` regenerates
`supabase/migrations/20260811000006_seed_categories.sql` (idempotent, additive
only — see the generator header). Never edit the .sql by hand.
