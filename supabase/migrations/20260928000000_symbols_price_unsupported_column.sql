-- enrich-symbols batch-pricing fix (found 2026-09-25 by the live test draft;
-- see docs/STATUS.md §4 and CLAUDE.md "success signals are unreliable" #7).
--
-- WHAT: `symbols.price_unsupported` is the explicit discriminator that keeps
-- Alpaca-unsupported instrument types (preferred stock / warrant / unit /
-- rights / when-issued forms from NASDAQ Trader's otherlisted/nasdaqlisted
-- feeds, e.g. `$`/`-`/`=`/`^`/digit-suffixed symbols) out of enrich-symbols'
-- price-priority batch-selection tier forever, instead of overloading
-- `last_price IS NULL` to mean three different things at once (never
-- attempted / permanently unpriceable / transient failure, retry soon) —
-- see CLAUDE.md "Overloaded NULLs are type tags". Class shares (NASDAQ
-- Trader's own dot notation, e.g. BRK.B) are NOT affected by this column —
-- Alpaca accepts that form as-is, no translation needed.
--
-- KEEP IN SYNC: the regex below matches ALPACA_TICKER_RE in
-- supabase/functions/enrich-symbols/price-batch.ts EXACTLY. Both must
-- classify a symbol identically, or this one-time seed and the cron's
-- runtime filter will disagree about which symbols are "unsupported" and
-- the price-priority queue will misclassify rows. If you change one, change
-- the other and re-run the effect-verify query below.
--
-- WHY SEED IT HERE, NOT LEAVE IT TO THE CRON: `default false` alone means
-- every one of the ~606 already-known-unsupported active symbols (per the
-- 2026-09-25 prod count) starts in the price-priority tier and wastes a
-- batch slot each before enrich-symbols classifies them itself over the
-- following runs — seeding matches the cron's own runtime rule so the
-- priority queue is correct from the very first push, not just eventually.
--
-- HUMAN ACTION (in order): 1) `supabase db push` FIRST — the function writes
-- this column on its next run, so it must exist before enrich-symbols is
-- redeployed; 2) deploy enrich-symbols.
--
-- Effect-verify:
--   -- BEFORE push, record the baseline this migration should reproduce:
--   SELECT count(*) FILTER (WHERE symbol !~ '^[A-Z]{1,6}(\.[A-Z]{1,2})?$')
--   FROM symbols WHERE active;
--   -- AFTER push, must equal the baseline above:
--   SELECT count(*) FILTER (WHERE price_unsupported) FROM symbols WHERE active;
--   -- Sanity check on the inference that non-[A-Z] priced symbols are class
--   -- shares (dot-form), not something the regex is misclassifying:
--   SELECT symbol ~ '^[A-Z]{1,6}\.[A-Z]{1,2}$' AS dot_form, count(*)
--   FROM symbols WHERE active AND symbol ~ '[^A-Z]' AND last_price IS NOT NULL
--   GROUP BY 1; -- expect dot_form = true for all or nearly all rows
--   -- After the next several enrich-symbols runs, the unpriced backlog
--   -- should fall noticeably within hours, not the ~2-day full cycle:
--   SELECT count(*) FILTER (WHERE active AND last_price IS NULL),
--          count(*) FILTER (WHERE is_draftable)
--   FROM symbols;
--   SELECT symbol, last_price, is_draftable FROM symbols WHERE symbol IN ('BAC','F');

alter table symbols add column if not exists price_unsupported boolean not null default false;

comment on column symbols.price_unsupported is
  'True when the symbol does not match Alpaca''s supported us_equity ticker format (plain ticker, or one dot-suffixed class share e.g. BRK.B) -- a preferred/warrant/unit/rights/when-issued form from the NASDAQ Trader feed that Alpaca does not list. Keeps these permanently out of enrich-symbols'' price-priority queue instead of overloading last_price IS NULL (CLAUDE.md "Overloaded NULLs are type tags"). Set by the pure filter in enrich-symbols/price-batch.ts (partitionForAlpaca) on every enrichment pass; seeded here for the already-known set at migration time so the priority queue is correct immediately, not just eventually.';

-- Seed the already-known set so the priority queue does not waste its first
-- several runs re-discovering what the format regex would tell it anyway.
-- Idempotent: only touches rows not already marked, matches the runtime rule.
update symbols
   set price_unsupported = true
 where active = true
   and price_unsupported = false
   and symbol !~ '^[A-Z]{1,6}(\.[A-Z]{1,2})?$';

-- Supports the batch-selection priority query:
--   .eq('active', true).is('last_price', null).eq('price_unsupported', false)
--   .order('enriched_at', { ascending: true, nullsFirst: true })
-- Partial index mirrors the existing symbols_enriched_at_idx pattern
-- (20260811000007_symbols_enrichment_support.sql).
create index if not exists symbols_price_priority_idx
  on symbols ((last_price is null and not price_unsupported), enriched_at)
  where active = true;
