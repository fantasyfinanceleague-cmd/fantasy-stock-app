-- ============================================================================
-- B1 — RLS HARDENING (step 01 of 06): leagues
-- Roadmap + helpers: see 20260712000000_rls_b1_00_helpers.sql
-- ============================================================================
alter table leagues enable row level security;
drop policy if exists "dev_all" on leagues;   -- LOAD-BEARING: dev_all is FOR ALL USING(true); permissive policies OR together, so it must go FIRST.

-- SELECT (permanent): members and the commissioner can read the league.
-- (commissioner clause also lets create-league read its row back before the
--  membership row exists — .insert(...).select().single().)
create policy "leagues_select_member_or_commissioner" on leagues
  for select to authenticated
  using (is_member(id) or is_commissioner(id));

-- [I1] INSERT (interim): creator must stamp themselves as commissioner.
create policy "leagues_insert_self_commissioner" on leagues
  for insert to authenticated
  with check (commissioner_id = auth.uid()::text);

-- [I2a] UPDATE commissioner (interim): settings, start-draft, dates — full control.
create policy "leagues_update_commissioner" on leagues
  for update to authenticated
  using (is_commissioner(id))
  with check (is_commissioner(id));

-- [I2b] UPDATE member draft-complete (interim): the in_progress -> completed
-- transition is triggered by ANY member, NOT the commissioner — mobile fires it
-- from the last picker (draft.tsx:253-258, isMyTurn-gated) and web from any
-- viewing member's completeDraft useEffect (DraftPage.jsx:508-571). A
-- commissioner-only policy would RLS-deny that update and the draft would never
-- finalize. Scoped to EXACTLY that transition (old row in_progress, new row
-- completed), so it grants nothing else.
create policy "leagues_update_member_draft_complete" on leagues
  for update to authenticated
  using (is_member(id) and draft_status = 'in_progress')
  with check (is_member(id) and draft_status = 'completed');

-- [I3] DELETE (interim): commissioner-only.
create policy "leagues_delete_commissioner" on leagues
  for delete to authenticated
  using (is_commissioner(id));
