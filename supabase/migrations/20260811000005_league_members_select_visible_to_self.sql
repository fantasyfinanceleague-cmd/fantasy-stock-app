-- fix(rls): same command-id visibility bug as 20260811000004, one table
-- down the create-league chain. Client inserts membership with RETURNING;
-- the SELECT policy (is_member(league_id)) re-queries league_members and
-- cannot see the row inserted by the current statement, so the RETURNING
-- row fails RLS and the insert reports a policy violation.
-- Fix: a user can always see their own membership row (direct column
-- comparison, no subquery).
--
-- Previous policy (for rollback):
--   create policy league_members_select_members on league_members
--     for select using (is_member(league_id));

drop policy league_members_select_members on league_members;

create policy league_members_select_members on league_members
  for select using (
    is_member(league_id)
    or user_id = (auth.uid())::text
  );
