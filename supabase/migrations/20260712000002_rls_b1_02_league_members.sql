-- ============================================================================
-- B1 — RLS HARDENING (step 02 of 06): league_members   [RECURSION-RISK STEP]
-- Roadmap + helpers: see 20260712000000_rls_b1_00_helpers.sql
-- ----------------------------------------------------------------------------
-- This is the self-referential step: a SELECT policy on league_members that
-- must decide visibility BY consulting league_members. is_member() is
-- SECURITY DEFINER, so it runs as the table owner (for whom RLS is NOT
-- enforced) and reads league_members WITHOUT re-triggering this policy ->
-- no infinite recursion. Verified post-push by a real authenticated-member
-- read from the mobile app (NOT the SQL editor, which bypasses RLS as owner).
-- If it throws "infinite recursion detected in policy for relation
-- league_members": DROP this table's SELECT policy and STOP — steps 00/01
-- (helpers + leagues) remain safely applied.
-- ============================================================================
alter table league_members enable row level security;
drop policy if exists "dev_all" on league_members;

-- SELECT (permanent): a member sees every member row in leagues they belong to.
-- Also bootstraps the "which leagues am I in" query (true for the caller's own rows).
create policy "league_members_select_members" on league_members
  for select to authenticated
  using (is_member(league_id));

-- [I4] INSERT self (interim): a user may add ONLY themselves (join + create-league).
create policy "league_members_insert_self" on league_members
  for insert to authenticated
  with check (user_id = auth.uid()::text);

-- [I6] INSERT bot (interim): mirror drafts' existing "League members can create bot picks".
create policy "league_members_insert_bot" on league_members
  for insert to authenticated
  with check (user_id like 'bot-%' and is_member(league_id));

-- [I5] DELETE self (interim): a user may remove ONLY themselves (leave-league).
create policy "league_members_delete_self" on league_members
  for delete to authenticated
  using (user_id = auth.uid()::text);
