-- fix(rls): league creation (INSERT ... RETURNING) 403'd since the
-- 2026-07-30 RLS hardening. The SELECT policy's is_commissioner(id)
-- re-queries leagues, and a row inserted by the current statement is not
-- visible to that subquery (command-id visibility), so the RETURNING row
-- failed the SELECT policy and the whole insert reported
-- "new row violates row-level security".
-- Effect-verified diagnosis 2026-08-11: identical insert succeeds without
-- RETURNING, fails with it, under the same JWT claims.
-- Fix: add a direct commissioner_id comparison, evaluated on the row
-- itself with no subquery, so a creator can always see their own league.
--
-- Previous policy (for rollback):
--   create policy leagues_select_member_or_commissioner on leagues
--     for select using (is_member(id) OR is_commissioner(id));

drop policy leagues_select_member_or_commissioner on leagues;

create policy leagues_select_member_or_commissioner on leagues
  for select using (
    is_member(id)
    or is_commissioner(id)
    or commissioner_id = (auth.uid())::text
  );
