#!/usr/bin/env node
// Generates the idempotent category-seed migration from supabase/seed/*.json.
//
// The JSONs are the source of truth (reviewed by Giorgio before merge); the
// SQL migration is GENERATED — edit the JSONs and re-run this script, never
// the .sql. Validation here fails the build BEFORE the DB trigger would fail
// the migration mid-push (≤3 overrides/symbol, slug resolution, non-empty
// justifications, duplicate rule keys).
//
// Idempotency: every statement is an upsert keyed on the table's natural
// unique key (categories.slug / category_rules.gics_industry /
// symbol_category_overrides (symbol, category_id)). Re-running converges.
// DELIBERATELY ADDITIVE: rows removed from a JSON are NOT deleted by the
// migration (league_draft_slots.category_id may reference categories, and a
// destructive sync inside a seed migration is how data disappears). Removing
// a category/rule/override is a manual curation action.
//
// Output is ALWAYS a new migration. `supabase db push` tracks applied
// VERSIONS, not file content, so rewriting an already-applied migration (e.g.
// the original 20260811000006_seed_categories.sql) is silently skipped — the
// push reports "up to date" and none of the curation reaches prod. Each run
// therefore writes a fresh timestamped file, and the script refuses to write
// over any existing path unless --force is given. Re-applying the full seed is
// safe: every statement is an upsert, so the new migration converges.
//
// Usage: node scripts/gen-category-seed-migration.mjs [--out <path>] [--force]
//   (default)     writes supabase/migrations/<UTC YYYYMMDDHHMMSS>_reseed_categories.sql
//   --out <path>  write somewhere else instead (relative to the cwd); e.g.
//                 --out /tmp/reseed-check.sql for a dry comparison outside the repo
//   --force       allow overwriting an existing file. Never point this at an
//                 applied migration — see above.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = resolve(root, 'supabase/seed');

// ---------------------------------------------------------------------------
// Args + output path — resolved and checked before any work is done.
// ---------------------------------------------------------------------------
const USAGE = 'Usage: node scripts/gen-category-seed-migration.mjs [--out <path>] [--force]';
let outArg = null;
let force = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--force') force = true;
  else if (a === '--out') {
    outArg = argv[++i];
    if (!outArg || outArg.startsWith('--')) {
      console.error(`--out requires a path.\n${USAGE}`);
      process.exit(2);
    }
  } else if (a.startsWith('--out=')) outArg = a.slice('--out='.length);
  else if (a === '--help' || a === '-h') {
    console.log(USAGE);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${a}\n${USAGE}`);
    process.exit(2);
  }
}

const utcStamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14); // YYYYMMDDHHMMSS
const OUT = outArg
  ? resolve(process.cwd(), outArg)
  : resolve(root, `supabase/migrations/${utcStamp}_reseed_categories.sql`);

const overwriting = existsSync(OUT);
if (overwriting && !force) {
  const shown = relative(process.cwd(), OUT);
  console.error(`Refusing to overwrite existing file: ${shown.startsWith('..') ? OUT : shown}`);
  console.error(`  supabase db push tracks migration VERSIONS, not content. If this file is an`);
  console.error(`  already-applied migration, rewriting it is silently skipped: the push reports`);
  console.error(`  "up to date" and none of your curation reaches prod.`);
  console.error(`  Run without --out to get a new timestamped *_reseed_categories.sql, or pass`);
  console.error(`  --force only if you are sure the target has never been applied anywhere.`);
  process.exit(1);
}

const categories = JSON.parse(readFileSync(resolve(seedDir, 'categories.json'), 'utf8'));
const rules = JSON.parse(readFileSync(resolve(seedDir, 'category_rules.json'), 'utf8'));
const overrides = JSON.parse(readFileSync(resolve(seedDir, 'symbol_category_overrides.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Validation — fail loudly here, not mid-migration.
// ---------------------------------------------------------------------------
const errors = [];
const slugs = new Set();
let miscCount = 0;
for (const c of categories) {
  if (!c.slug || !c.name) errors.push(`category missing slug/name: ${JSON.stringify(c)}`);
  if (slugs.has(c.slug)) errors.push(`duplicate category slug: ${c.slug}`);
  slugs.add(c.slug);
  if (c.is_misc) miscCount++;
}
if (miscCount !== 1) errors.push(`exactly one is_misc category required, found ${miscCount}`);

const ruleKeys = new Set();
for (const r of rules) {
  if (!r.gics_industry) errors.push(`rule missing gics_industry: ${JSON.stringify(r)}`);
  if (ruleKeys.has(r.gics_industry)) errors.push(`duplicate rule for industry: ${r.gics_industry}`);
  ruleKeys.add(r.gics_industry);
  if (!slugs.has(r.category_slug)) errors.push(`rule ${r.gics_industry}: unknown slug ${r.category_slug}`);
}

const perSymbol = new Map();
const seenPairs = new Set();
for (const o of overrides) {
  if (!o.symbol || !o.category_slug) errors.push(`override missing symbol/slug: ${JSON.stringify(o)}`);
  if (!o.justification || !o.justification.trim()) errors.push(`override ${o.symbol}/${o.category_slug}: justification required (DR-001)`);
  if (!slugs.has(o.category_slug)) errors.push(`override ${o.symbol}: unknown slug ${o.category_slug}`);
  const pair = `${o.symbol}:${o.category_slug}`;
  if (seenPairs.has(pair)) errors.push(`duplicate override pair: ${pair}`);
  seenPairs.add(pair);
  perSymbol.set(o.symbol, (perSymbol.get(o.symbol) ?? 0) + 1);
}
for (const [sym, n] of perSymbol) {
  if (n > 3) errors.push(`symbol ${sym} has ${n} overrides (max 3 per DR-001)`);
}

if (errors.length) {
  console.error(`Seed validation FAILED (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Emit SQL
// ---------------------------------------------------------------------------
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const lines = [];
lines.push(`-- GENERATED by scripts/gen-category-seed-migration.mjs from supabase/seed/*.json.`);
lines.push(`-- DO NOT EDIT — edit the JSONs and re-run the script. The JSONs are the`);
lines.push(`-- reviewed source of truth (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 4).`);
lines.push(`--`);
lines.push(`-- Idempotent (upserts on natural keys) and ADDITIVE ONLY — removed JSON rows`);
lines.push(`-- are not deleted here; see the generator header for why.`);
lines.push(`--`);
lines.push(`-- Seed inventory: ${categories.length} categories, ${rules.length} rules, ${overrides.length} overrides (${perSymbol.size} symbols).`);
lines.push(`-- HUMAN ACTION: supabase db push. Effect-verify AFTER push (counts, not output):`);
lines.push(`--   SELECT (SELECT count(*) FROM categories)              AS categories,   -- expect >= ${categories.length}`);
lines.push(`--          (SELECT count(*) FROM category_rules)          AS rules,        -- expect >= ${rules.length}`);
lines.push(`--          (SELECT count(*) FROM symbol_category_overrides) AS overrides;  -- expect >= ${overrides.length}`);
lines.push(``);
lines.push(`-- categories -----------------------------------------------------------------`);
for (const c of categories) {
  lines.push(
    `insert into categories (slug, name, display_order, is_misc) values (` +
    `${q(c.slug)}, ${q(c.name)}, ${c.display_order ?? 0}, ${c.is_misc ? 'true' : 'false'})` +
    ` on conflict (slug) do update set name = excluded.name, display_order = excluded.display_order, is_misc = excluded.is_misc;`
  );
}
lines.push(``);
lines.push(`-- category_rules (vendor industry label -> category) --------------------------`);
for (const r of rules) {
  lines.push(
    `insert into category_rules (gics_industry, category_id) values (` +
    `${q(r.gics_industry)}, (select id from categories where slug = ${q(r.category_slug)}))` +
    ` on conflict (gics_industry) do update set category_id = excluded.category_id;`
  );
}
lines.push(``);
lines.push(`-- symbol_category_overrides (curated exceptions; <=3/symbol via trigger) ------`);
for (const o of overrides) {
  lines.push(
    `insert into symbol_category_overrides (symbol, category_id, justification) values (` +
    `${q(o.symbol.toUpperCase())}, (select id from categories where slug = ${q(o.category_slug)}), ${q(o.justification)})` +
    ` on conflict (symbol, category_id) do update set justification = excluded.justification;`
  );
}
lines.push(``);

writeFileSync(OUT, lines.join('\n'));
console.log(`Wrote ${OUT}${overwriting ? ' (overwrote existing file: --force)' : ''}`);
console.log(`  ${categories.length} categories, ${rules.length} rules, ${overrides.length} overrides across ${perSymbol.size} symbols`);
