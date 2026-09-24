# Simulator seed data (curated categories)

**Status: reviewed, merged, and applied in prod** (seed migration
`20260811000006_seed_categories.sql`, confirmed in `schema_migrations` 2026-09-24).
To change categories, edit the JSON here and regenerate the migration (see *Apply
path* below) — never edit the generated `.sql` by hand.

These files carry the Stockpile-curated category data that layers over vendor
industry taxonomy (DR-001). The **schema** for their target tables shipped in Phase 2
(`supabase/migrations/20260810000003_create_categories_tables.sql`); the **data**
was authored and reviewed in Phase 4.

| File | Target table | Content |
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
`misc` fallback), 80 industry rules, 74 overrides across 55 symbols (91 before
the b8041f7 review removed 17 delivery-mechanism tech overrides; max 3
per symbol, generator-validated before the DB trigger ever sees them).

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

**Apply path:** edit the JSONs, then run `node scripts/gen-category-seed-migration.mjs`.
It validates the seed and writes a **new** migration,
`supabase/migrations/<UTC YYYYMMDDHHMMSS>_reseed_categories.sql` (idempotent,
additive only — see the generator header). Review it, commit it, then `supabase db push`. Never
edit the generated .sql by hand, and never touch the original
`20260811000006_seed_categories.sql`.

> ⚠️ **Why every run makes a new file:** `20260811000006` is already applied, and
> `supabase db push` tracks migration *versions*, not content — it never re-runs an
> applied version. Rewriting that file would make `db push` report "up to date"
> while **none of your curation reaches prod**. So the generator always emits a
> fresh timestamp, and it **refuses to overwrite any existing path** (exit 1)
> unless `--force` is passed. Re-applying the full seed is safe: every statement
> is an upsert, so the new migration converges. Effect-verify with row counts
> (the queries are in the generated header), not the push output.

Options: `--out <path>` writes somewhere else (e.g. `--out /tmp/reseed-check.sql`
to preview or diff without touching the repo); `--force` permits overwriting an
existing file — only for a draft that has never been applied anywhere.
