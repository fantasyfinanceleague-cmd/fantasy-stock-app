-- ============================================================================
-- Run it back (5/6): the server-side renewal gate and the team cap at start
-- ============================================================================
-- Design: docs/migrations/RUN_IT_BACK_DESIGN.md (rev 3.1), §2.6 and §2.7.
--
-- THE GATE: while ANY reply is pending on a renewed league, its draft date, its
-- draft order mode and its draft status cannot change. The check is an EXISTS
-- over the frozen expected set (league_renewal_responses), and it binds EVERY
-- role, service_role included: draft-control starts drafts with the secret key,
-- so an exemption on auth.uid() IS NULL would let the start through. SECURITY
-- DEFINER, so it counts every row regardless of RLS.
--
-- It fires only for renewed leagues (previous_league_id IS NOT NULL). Ordinary
-- leagues are untouched.
--
-- THE TEAM CAP AT START (§2.7): a renewed league is created with num_participants
-- = 16 so newcomers can join during the renewal. When its draft starts, the cap
-- becomes the actual member count. The CHECK (4..16) holds because draft-control
-- refuses a start below 4 members and the join cap keeps it at 16 or under.
--
-- TRIGGER ORDER: Postgres fires BEFORE triggers in name order, so this one runs
-- AFTER trg_leagues_member_update_columns (the F1 column guard). The guard
-- therefore judges the caller's own columns, not this server-side write.
--
-- PROVISIONAL TIMESTAMP: re-stamp before release (see 20261027000000's header).
--
-- POST-PUSH EFFECT CHECKS:
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_leagues_renewal_gate';
-- ============================================================================

create or replace function public.enforce_league_renewal_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.previous_league_id is null then
    return new;
  end if;

  if (new.draft_date is distinct from old.draft_date
      or new.draft_order_mode is distinct from old.draft_order_mode
      or new.draft_status is distinct from old.draft_status)
     and exists (select 1 from public.league_renewal_responses r
                  where r.league_id = new.id and r.status = 'pending') then
    raise exception 'renewal_replies_pending: every Season 1 player must answer before the draft can be set or started'
      using errcode = '22023';
  end if;

  if old.draft_status = 'not_started' and new.draft_status is distinct from 'not_started' then
    new.num_participants := (select count(*)::int from public.league_members m where m.league_id = new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_leagues_renewal_gate on public.leagues;
create trigger trg_leagues_renewal_gate
  before update on public.leagues
  for each row execute function public.enforce_league_renewal_gate();

revoke all on function public.enforce_league_renewal_gate() from public, anon, authenticated, service_role;
revoke all on function public.enforce_renewal_response_transitions() from public, anon, authenticated, service_role;
