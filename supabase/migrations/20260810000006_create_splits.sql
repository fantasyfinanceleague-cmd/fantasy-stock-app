-- In-house simulator (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 2)
-- Corporate actions — net-new `splits` table (no prod equivalent, recon Item 3).
--
-- WHAT: records stock splits. An application job (Phase 3/4) multiplies open
--   position quantities by `ratio` on `effective_date` so exposure stays
--   continuous across a split (DR-001 corporate-actions decision).
--
-- `applied` GUARD (spec line 75): the job must set `applied = true` ONLY after
--   verifying the row count of updated positions matches expectation —
--   effect-verified, not status-verified (the recurring silent-success pattern
--   in this codebase). That verification is the JOB's responsibility; this
--   schema only provides the flag + `applied_at` audit timestamp. It is written
--   here as a nullable boolean default false, i.e. an explicit discriminator —
--   NOT overloaded onto a NULL (per the CLAUDE.md overloaded-NULL rule).
--
-- SCHEMA ONLY — no application job here (that is simulator logic, Phase 3/4).
--
-- RLS: reference data. authenticated reads all (clients may surface split
-- history); anon reads nothing; no client write policy (the service-role job
-- owns writes and bypasses RLS).
--
-- HUMAN ACTION: `supabase db push` is Giorgio's.

create table if not exists splits (
  id             uuid primary key default gen_random_uuid(),
  symbol         text not null,
  ratio          numeric not null check (ratio > 0), -- e.g. 4 for a 4:1 split
  effective_date date not null,
  applied        boolean not null default false,
  applied_at     timestamptz null,
  created_at     timestamptz not null default now(),
  unique (symbol, effective_date)
);

-- Partial index: the application job scans for unapplied splits due today.
create index if not exists splits_unapplied_effective_idx
  on splits(effective_date) where not applied;

alter table splits enable row level security;

create policy "splits_select_authenticated" on splits
  for select to authenticated using (true);
