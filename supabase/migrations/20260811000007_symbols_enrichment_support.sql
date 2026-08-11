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
--    updated_at (root cause of the May staleness mystery — the column stayed
--    frozen even while the cron worked). Fixing it in the DB covers BOTH
--    writers (refresh-symbols and enrich-symbols) and fires only when the row
--    actually changed, so max(updated_at) is a truthful cron-liveness signal
--    rather than bumping on every no-op upsert. refresh-symbols itself needs
--    NO code change: its upsert only SETs the columns it provides, so
--    enrichment columns are never clobbered, and this trigger supplies the
--    updated_at bump it was missing.
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
  when (old.* is distinct from new.*)
  execute function public.symbols_touch_updated_at();
