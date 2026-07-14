-- ============================================================================
-- B1 — RLS HARDENING (step 06 of 06): week_snapshots   [FINAL STEP]
-- Roadmap + helpers: see 20260712000000_rls_b1_00_helpers.sql
-- ----------------------------------------------------------------------------
-- SELECT-only: week_snapshots is written exclusively by the cron snapshot
-- functions (service role, which bypasses RLS), so NO client write policy by
-- design. This step completes the B1 lock on all six placeholder-RLS tables.
-- ============================================================================
alter table week_snapshots enable row level security;
drop policy if exists "dev_all" on week_snapshots;

-- SELECT (permanent): members read the league's weekly snapshots.
create policy "week_snapshots_select_members" on week_snapshots
  for select to authenticated
  using (is_member(league_id));
