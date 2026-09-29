-- ============================================================================
-- Flexible playoffs (3/4): playoff_teams is frozen once the draft starts
-- ============================================================================
-- PROBLEM
--   Two things are derived from playoff_teams at fixed moments:
--     * draft start: draft-control refuses P > managers (membership freezes here);
--     * draft end: finalize stamps league_end_date = the end of week
--       num_weeks + ceil(log2 P).
--   The commissioner can UPDATE their own league (leagues_update_commissioner),
--   so a later change to playoff_teams would silently invalidate both: a P
--   raised past the member count strands the season at its end (the seeding
--   refuses every run), and any change makes the stamped end date wrong.
--
-- RULE (Giorgio, 2026-09-29, approved as decision (c)): once draft_status
-- leaves 'not_started' (in_progress or completed), playoff_teams cannot change
-- through a user session. The designed Start-draft flow still works, because
-- the commissioner lowers P on the confirm sheet WHILE the league is still
-- 'not_started', and only then starts the draft. A single UPDATE that changes
-- both columns is judged against OLD.draft_status and is also allowed.
--
-- WHO IS EXEMPT: auth.uid() IS NULL (service_role, cron, migrations, the
-- dashboard SQL editor), the same test the F1 member column guard uses
-- (20260925000000). A server-side repair can still change it deliberately.
--
-- SECURITY
--   SECURITY INVOKER is enough: the trigger reads only OLD/NEW and auth.uid().
--   search_path is pinned anyway. `returns trigger` cannot be called directly,
--   and firing a trigger does not check EXECUTE, but the default
--   anon/authenticated grants are revoked so proacl reads as the lockdown it is
--   (CLAUDE.md: REVOKE FROM PUBLIC does not clear them).
--
-- POST-PUSH EFFECT CHECKS:
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_leagues_freeze_playoff_teams';
--   SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'enforce_playoff_teams_frozen_after_draft_start';
--   -- expect no anon= / authenticated= entries
-- ============================================================================

create or replace function public.enforce_playoff_teams_frozen_after_draft_start()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.playoff_teams is distinct from old.playoff_teams
     and old.draft_status in ('in_progress', 'completed') then
    raise exception 'playoff_teams_locked: playoff spots cannot change once the draft has started'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_playoff_teams_frozen_after_draft_start() from public;
revoke all on function public.enforce_playoff_teams_frozen_after_draft_start() from anon, authenticated;

drop trigger if exists trg_leagues_freeze_playoff_teams on public.leagues;
create trigger trg_leagues_freeze_playoff_teams
  before update of playoff_teams on public.leagues
  for each row execute function public.enforce_playoff_teams_frozen_after_draft_start();
