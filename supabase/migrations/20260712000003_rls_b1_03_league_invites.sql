-- ============================================================================
-- B1 — RLS HARDENING (step 03 of 06): league_invites
-- Roadmap + helpers: see 20260712000000_rls_b1_00_helpers.sql
-- ----------------------------------------------------------------------------
-- By-code invite lookups (join preview) intentionally LOSE access here and move
-- to the `preview-league` edge fn (closes the invite-code enumeration surface,
-- L6). Reachable readers post-lock: only the commissioner (own league's invites).
-- ============================================================================
alter table league_invites enable row level security;
drop policy if exists "dev_all" on league_invites;

-- SELECT (permanent): commissioner-only.
create policy "league_invites_select_commissioner" on league_invites
  for select to authenticated
  using (is_commissioner(league_id));

-- [P1] INSERT (PERMANENT — approved): commissioner creates invites for own league;
-- inviter_id pinned to the caller to prevent spoofing.
create policy "league_invites_insert_commissioner" on league_invites
  for insert to authenticated
  with check (is_commissioner(league_id) and inviter_id = auth.uid()::text);

-- [I7] UPDATE accept-status (interim): the current client flow inserts the
-- membership row FIRST, then flips status->'accepted', so the accepter is a
-- member by this point. Scoped to members + the accepted transition only.
-- (Not exercised until preview-league/join-league land, since the join preview
-- read is intentionally broken in the interim.)
create policy "league_invites_update_accept" on league_invites
  for update to authenticated
  using (is_member(league_id))
  with check (status = 'accepted' and is_member(league_id));
