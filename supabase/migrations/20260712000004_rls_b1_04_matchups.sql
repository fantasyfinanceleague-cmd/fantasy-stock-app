-- ============================================================================
-- B1 — RLS HARDENING (step 04 of 06): matchups
-- Roadmap + helpers: see 20260712000000_rls_b1_00_helpers.sql
-- ----------------------------------------------------------------------------
-- REALTIME FIX (permanent): matchups PK is `id` only; league_id is NOT in the
-- default replica identity. Once SELECT is scoped to is_member(league_id), the
-- UPDATE/DELETE old-row image would LACK league_id, so Supabase Realtime cannot
-- evaluate the policy and SILENTLY DROPS standings events. REPLICA IDENTITY FULL
-- puts every column in the old image so the RLS check resolves. (league_standings
-- does NOT need this — its PK already contains league_id.)
-- ============================================================================
alter table matchups enable row level security;
drop policy if exists "dev_all" on matchups;

alter table matchups replica identity full;

-- SELECT (permanent): members read the league's matchups.
create policy "matchups_select_members" on matchups
  for select to authenticated
  using (is_member(league_id));

-- [I8] INSERT (interim): client-side schedule generation runs in any member's
-- browser (web completeDraft useEffect DraftPage.jsx:508-548), so member-scoped
-- (not commissioner). Removed when schedule-gen moves server-side (mini-project #2).
create policy "matchups_insert_members" on matchups
  for insert to authenticated
  with check (is_member(league_id));
