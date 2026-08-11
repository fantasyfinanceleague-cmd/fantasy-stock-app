-- In-house simulator (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 4)
-- Support schema for the enrich-symbols cron.
--
-- 1) symbols.enriched_at — the enrichment cursor. The cron processes the
--    stalest rows first (NULLS FIRST), so initial coverage of the ~14.4k-row
--    universe completes in ~2 days at 50 symbols / 10 minutes, after which
--    every symbol re-enriches on a ~2-day cadence. Deliberately separate from
--    updated_at, which means "any column changed" (see 2).
--
-- 2) updated_at bump trigger. The refresh-symbols upsert never touched
--    updated_at (root cause of the May staleness mystery). Fixing it in the
--    DB covers BOTH writers; refresh-symbols needs NO code change (its upsert
--    only SETs the columns it provides, so enrichment columns are never
--    clobbered).
--
--    The WHEN clause compares SUBSTANTIVE columns explicitly rather than
--    old.* — enriched_at is cursor BOOKKEEPING written on every enrichment
--    pass, and including it would bump updated_at on every run even when no
--    data changed (found in Phase 4 review). What each signal now honestly
--    means:
--      updated_at  = listing or enrichment DATA changed (either writer)
--      enriched_at = enrich-symbols cron liveness (advances every pass)
--      refresh-symbols liveness = cron.job_run_details + net._http_response +
--        listing-change counts — updated_at was NEVER a reliable refresh
--        liveness signal (a healthy run on a quiet day changes nothing).
--
-- HUMAN ACTION: supabase db push. Effect-verify AFTER push:
--   -- trigger exists:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.symbols'::regclass AND NOT tgisinternal;
--   -- bump-on-change works (run refresh-symbols once, then):
--   SELECT count(*) FROM symbols WHERE updated_at > now() - interval '1 hour';
--   -- expect > 0 only if listings actually changed; re-run refresh and the
--   -- count must NOT jump to the full table (no-op upserts must not bump).

alter table symbols add column if not exists enriched_at timestamptz;

create index if not exists symbols_enriched_at_idx
  on symbols (enriched_at asc nulls first)
  where active = true;

create or replace function public.symbols_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists symbols_touch_updated_at on symbols;
create trigger symbols_touch_updated_at
  before update on symbols
  for each row
  when (
    old.name          is distinct from new.name or
    old.exchange      is distinct from new.exchange or
    old.is_etf        is distinct from new.is_etf or
    old.active        is distinct from new.active or
    old.gics_sector   is distinct from new.gics_sector or
    old.gics_industry is distinct from new.gics_industry or
    old.is_draftable  is distinct from new.is_draftable or
    old.last_price    is distinct from new.last_price or
    old.market_cap    is distinct from new.market_cap
  )
  execute function public.symbols_touch_updated_at();
