-- ============================================================================
-- FIXTURE: PR #94 (Run it back) membership objects, VERBATIM from
-- origin/feat/run-it-back @ 398da84 (unmerged when leave-league was built):
--   * league_renewal_responses + its transition guard (20261105000002)
--   * sync_renewal_on_member_delete + trg_league_members_renewal_sync_delete
--     (20261105000004)
-- plus the one lineage column they read (20261105000000).
--
-- Used ONLY by leave_league.pglite.test.ts to prove leave_league's Run-it-back
-- branch against #94's real trigger bodies. WHEN #94 MERGES: delete this file
-- and load #94's migrations from supabase/migrations/ instead.
-- ============================================================================

alter table public.leagues add column if not exists previous_league_id uuid references public.leagues(id);

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

create or replace function public.sync_renewal_on_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comm     text;
  v_prev     uuid;
  v_status   text;
begin
  select l.commissioner_id, l.previous_league_id into v_comm, v_prev
    from public.leagues l where l.id = old.league_id;
  if not found or v_prev is null then
    return null;   -- an ordinary league, or the league itself is being deleted
  end if;
  select r.status into v_status from public.league_renewal_responses r
   where r.league_id = old.league_id and r.user_id = old.user_id;
  if v_status is distinct from 'in' then
    return null;   -- no reply, or already out / pending: nothing to keep in step
  end if;
  if v_comm = old.user_id then
    raise exception 'renewal_commissioner_out: the commissioner cannot leave their own renewal'
      using errcode = '22023';
  end if;
  update public.league_renewal_responses
     set status = 'out', decided_by = 'player', responded_at = now()
   where league_id = old.league_id and user_id = old.user_id;
  return null;
end;
$$;

drop trigger if exists trg_league_members_renewal_sync_delete on public.league_members;
create trigger trg_league_members_renewal_sync_delete
  after delete on public.league_members
  for each row execute function public.sync_renewal_on_member_delete();
