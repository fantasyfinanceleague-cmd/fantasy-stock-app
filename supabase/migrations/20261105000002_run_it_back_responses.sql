-- ============================================================================
-- Run it back (3/6): the renewal reply record and its transition guard
-- ============================================================================
-- Design: docs/migrations/RUN_IT_BACK_DESIGN.md (rev 3.1), §2.2 and §2.5.
--
-- league_renewal_responses has ONE row per invited Season 1 player, on the NEW
-- league, written by renew_league and never by a client. The expected set is
-- frozen when the ask goes out, so "No reply yet" is a count against a fixed
-- set, not "a Season 1 member with no row".
--
--   status     pending | in | out          (the discriminator; never inferred from NULL)
--   decided_by player | commissioner       (NULL while pending)
--
-- The commissioner's own row is 'in' (decided_by 'player'): they are a member.
--
-- THE ONE-WAY DOOR (CLAUDE.md "a gate keyed on state must not be re-openable"):
-- the guard trigger below refuses, for EVERY role including service_role:
--   * any transition INTO 'pending' (rows are created pending only, by
--     renew_league's INSERT; nothing moves a row back to pending);
--   * any change of a row decided by the commissioner ("Remove is final");
--   * 'out' for the league's own commissioner (they cannot opt out of their
--     own renewal);
--   * an invalid status/decided_by pair (the stamps CHECK).
-- The RPCs enforce the same rules with readable reasons; the trigger is the
-- backstop, so a direct write cannot make the gate reopen.
--
-- PROVISIONAL TIMESTAMP: re-stamp before release (see 20261027000000's header).
--
-- POST-PUSH EFFECT CHECKS:
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'league_renewal_responses';   -- t
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name = 'league_renewal_responses';   -- service_role SELECT only
-- ============================================================================

create table if not exists public.league_renewal_responses (
  league_id       uuid not null references public.leagues(id) on delete cascade,
  user_id         text not null,
  status          text not null,
  decided_by      text,
  invited_at      timestamptz not null default now(),
  responded_at    timestamptz,
  nudge_count     smallint not null default 0,
  last_nudged_at  timestamptz,
  primary key (league_id, user_id),
  constraint league_renewal_responses_status_check
    check (status in ('pending', 'in', 'out')),
  constraint league_renewal_responses_decided_by_check
    check (decided_by is null or decided_by in ('player', 'commissioner')),
  -- The stamps agree with the discriminator (the league_draft_order_meta pattern).
  constraint league_renewal_responses_stamps_check check (
       (status = 'pending' and decided_by is null and responded_at is null)
    or (status <> 'pending' and decided_by is not null and responded_at is not null)),
  constraint league_renewal_responses_nudge_check check (nudge_count >= 0)
);

comment on table public.league_renewal_responses is
  'Run it back: one row per invited Season 1 player on the NEW league. status is the discriminator (pending|in|out). Written only by the renewal SECURITY DEFINER functions; the guard trigger makes the pending state one-way.';

create index if not exists league_renewal_responses_pending_idx
  on public.league_renewal_responses (league_id) where status = 'pending';

-- ----------------------------------------------------------------------------
-- The guard. SECURITY DEFINER so it reads the row being changed regardless of
-- the caller; it is never callable (no EXECUTE for any API role).
-- ----------------------------------------------------------------------------
create or replace function public.enforce_renewal_response_transitions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    -- The door does not reopen: nothing returns to pending.
    if new.status = 'pending' and old.status <> 'pending' then
      raise exception 'renewal_one_way: a reply cannot return to pending'
        using errcode = '22023';
    end if;
    -- Remove is final: a commissioner-decided row never changes again.
    if old.decided_by = 'commissioner' and (new.status is distinct from old.status
        or new.decided_by is distinct from old.decided_by) then
      raise exception 'renewal_removed_final: the commissioner removed this player'
        using errcode = '22023';
    end if;
  end if;

  -- The league's own commissioner cannot opt out of their own renewal.
  if new.status = 'out' and exists (
       select 1 from public.leagues l
        where l.id = new.league_id and l.commissioner_id = new.user_id) then
    raise exception 'renewal_commissioner_out: the commissioner cannot opt out of their own renewal'
      using errcode = '22023';
  end if;

  -- Creation is pending-only, with ONE exception: the commissioner's own row,
  -- created 'in' by renew_league (they are a member of their own renewal).
  if tg_op = 'INSERT' and new.status <> 'pending' and not (
       new.status = 'in' and new.decided_by = 'player' and exists (
         select 1 from public.leagues l
          where l.id = new.league_id and l.commissioner_id = new.user_id)) then
    raise exception 'renewal_insert_pending_only: responses are created pending'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_league_renewal_responses_transitions on public.league_renewal_responses;
create trigger trg_league_renewal_responses_transitions
  before insert or update on public.league_renewal_responses
  for each row execute function public.enforce_renewal_response_transitions();

-- ----------------------------------------------------------------------------
-- RLS + grants. No client policies: every read is an RPC, every write is a
-- DEFINER function. service_role gets SELECT only, for draft-control's
-- replies-pending count. Revoke by name (Supabase default grants ALL on new
-- tables to the API roles).
-- ----------------------------------------------------------------------------
alter table public.league_renewal_responses enable row level security;

revoke all on table public.league_renewal_responses from public, anon, authenticated, service_role;
grant select on table public.league_renewal_responses to service_role;
