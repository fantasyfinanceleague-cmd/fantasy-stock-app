-- ============================================================================
-- B1 — RLS HARDENING (step 00 of 06): SECURITY DEFINER helpers
-- ============================================================================
-- Part of the B1 league-table RLS lockdown. Reviewed as one assembled unit;
-- partitioned into ordered step-files ONLY so each table is pushed + verified
-- independently (the league_members step carries the recursion risk and must be
-- reversible on its own). Spec: docs/migrations/RLS_HARDENING_SPEC.md (B1).
--
-- MODEL (mirrors proven trades/drafts/league_seasons policies):
--   anon -> reads NOTHING; authenticated member -> reads league-scoped rows;
--   writes -> interim owner/commissioner policies, each removed as its
--   replacement edge function lands.  Rule: harden WITHOUT changing behavior.
--
-- INTERIM WRITE-POLICY REMOVAL ROADMAP (path to full write-closure):
--   [I1]  leagues INSERT                       -> remove when `create-league` fn lands
--   [I2a] leagues UPDATE commissioner          -> remove when `update-league` fn lands
--   [I2b] leagues UPDATE member draft-complete -> remove when `draft-control` fn lands
--   [I3]  leagues DELETE                       -> remove when `delete-league` fn lands
--   [I4]  league_members self INSERT           -> remove when `join-league` + `create-league` land
--   [I5]  league_members self DELETE           -> remove when `leave-league` fn lands
--   [I6]  league_members bot INSERT            -> remove when `draft-control` fn lands
--   [I7]  league_invites accept UPDATE         -> remove when `join-league` fn lands
--   [I8]  matchups INSERT                      -> remove when schedule-gen fn lands (mini-project #2)
--   [I9]  league_standings INSERT              -> remove when schedule-gen fn lands (mini-project #2)
-- PERMANENT: all SELECT policies, both helpers, league_invites commissioner
--   INSERT [P1], matchups REPLICA IDENTITY FULL, week_snapshots (no client write).
--
-- SECURITY DEFINER breaks the league_members self-referential recursion trap
-- (a definer fn runs as owner, for whom RLS is not enforced, so it reads
-- league_members without re-triggering its own policy).
-- ============================================================================

create or replace function public.is_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from league_members
    where league_id = p_league_id
      and user_id = auth.uid()::text
  );
$$;

create or replace function public.is_commissioner(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from leagues
    where id = p_league_id
      and commissioner_id = auth.uid()::text
  );
$$;

revoke all on function public.is_member(uuid)       from public;
revoke all on function public.is_commissioner(uuid) from public;
grant execute on function public.is_member(uuid)       to authenticated;
grant execute on function public.is_commissioner(uuid) to authenticated;
