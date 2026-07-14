-- ============================================================================
-- B1 — RLS HARDENING (step 05 of 06): league_standings
-- Roadmap + helpers: see 20260712000000_rls_b1_00_helpers.sql
-- ----------------------------------------------------------------------------
-- NO replica-identity change needed: league_standings PK is (league_id, user_id),
-- so league_id is already in the default replica identity -> Realtime can
-- evaluate is_member(league_id) on UPDATE/DELETE old-row images. (Contrast
-- matchups, PK = id only, which needed REPLICA IDENTITY FULL in step 04.)
-- ============================================================================
alter table league_standings enable row level security;
drop policy if exists "dev_all" on league_standings;

-- SELECT (permanent): members read the league's standings.
create policy "league_standings_select_members" on league_standings
  for select to authenticated
  using (is_member(league_id));

-- [I9] INSERT (interim): client-side standings initialization at draft complete,
-- fired from any member's browser (web completeDraft useEffect). Removed when
-- schedule-gen moves server-side (mini-project #2).
create policy "league_standings_insert_members" on league_standings
  for insert to authenticated
  with check (is_member(league_id));

-- NOTE: no client UPDATE policy — standings are updated by the SECURITY DEFINER
-- standings function / cron (service role bypasses RLS).
