-- ============================================================================
-- Leave league (7/7): the draft order and the draft start wait for the
-- commissioner's roster reconfirmation
-- ============================================================================
-- Design board #call-leave (PR #122): "Draft order set Sat 6:00 PM ET, once the
-- teams are confirmed" / "Draft order: set as soon as you confirm the teams".
-- A pending league_roster_reconfirm row can outlive T-1h (the commissioner
-- hasn't chosen), so:
--
-- 1. THE ORDER WAITS. _draft_order_sync finalizes at the LATER of draft_date - 1h,
--    the 4th member, and NOW the roster being confirmed. That is the same shape
--    as the existing member floor, and in the one function every finalize path
--    goes through (the lazy reads, the member trigger, set_draft_order, the
--    cron's finalize_due_draft_orders). confirm_league_roster ('move_forward')
--    and join_league_by_code (an 'invite' cleared by a join) call it as soon as
--    the row clears, so the order is set the moment the teams are confirmed.
--    The start backstop (lock_draft_order_on_start -> _draft_order_finalize) is
--    untouched: the start itself is refused while the row exists (3).
--    finalize_due_draft_orders and draft_order_notify_due skip a league that is
--    waiting, so the cron does not post every tick for a league it cannot
--    finalize (the same reason they carry the member floor).
--
-- 2. member_left IS NOT THE CRON'S. draft_order_notify_due also says "yes" while
--    ANY league_notifications row is pending (or stale 'sending'). member_left
--    is delivered once, immediately, by the leave-league edge function, and
--    draft-order-notify never selects it. A member_left row stranded at
--    'pending' (the edge function died between the RPC's commit and its claim)
--    would otherwise keep the cron posting every tick, forever. It is excluded
--    by kind, not by an allowlist, so PR #94's renewal kinds (which
--    draft-order-notify DOES deliver on that branch) still count.
--
-- 3. THE START IS REFUSED for EVERY role while a reconfirmation is owed:
--    trg_leagues_roster_reconfirm_gate. draft-control already refuses with its
--    roster_reconfirm_required blocker; this is the backstop that binds the
--    commissioner's raw [I2a] draft_status flip (still used by the paused web
--    DraftPage) AND the service role. It also closes the read-then-flip window
--    in draft-control's start (security review, 2026-10-05). The trigger's query
--    runs after the UPDATE has taken the row lock that leave_league also takes,
--    so it sees a leave that committed first. The same pattern as PR #94's
--    trg_leagues_renewal_gate.
--
-- The three functions below are 20261013000000's bodies VERBATIM plus the lines
-- marked "20261107000006". CREATE OR REPLACE keeps their ACLs; the grants are
-- re-asserted verbatim.
--
-- PROVISIONAL TIMESTAMP: see 20261107000000's header.
--
-- POST-PUSH EFFECT CHECKS:
--   SELECT proname, position('league_roster_reconfirm' in prosrc) > 0 AS waits, proacl
--     FROM pg_proc WHERE proname IN ('_draft_order_sync', 'finalize_due_draft_orders', 'draft_order_notify_due');
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_leagues_roster_reconfirm_gate';
-- ============================================================================

create or replace function public._draft_order_sync(p_league_id uuid, p_lock boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l public.leagues%rowtype;
begin
  if p_lock then
    select * into v_l from public.leagues where id = p_league_id for no key update;
  else
    select * into v_l from public.leagues where id = p_league_id;
  end if;
  if not found or coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
    return;
  end if;

  if public._draft_order_is_due(v_l.draft_date)
     and (select count(*) from public.league_members m where m.league_id = p_league_id) >= 4
     -- 20261107000006: and the commissioner has confirmed the teams after a leave
     and not exists (select 1 from public.league_roster_reconfirm rc where rc.league_id = p_league_id) then
    perform public._draft_order_finalize(p_league_id);
  elsif v_l.draft_order_mode = 'manual' then
    perform public._draft_order_materialize(p_league_id, 'manual_seed');
  end if;
end;
$$;

create or replace function public.finalize_due_draft_orders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select l.id
      from public.leagues l
     where coalesce(l.draft_status, 'not_started') = 'not_started'
       and public._draft_order_is_due(l.draft_date)
       and (select count(*) from public.league_members x where x.league_id = l.id) >= 4
       and not exists (select 1 from public.league_draft_order_meta m
                        where m.league_id = l.id and m.state <> 'open')
       and not exists (select 1 from public.league_roster_reconfirm rc where rc.league_id = l.id)   -- 20261107000006 (alias rc: r is the loop variable)
     order by l.draft_date
     limit 100
  loop
    perform public._draft_order_sync(r.id, true);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.draft_order_notify_due()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
           select 1 from public.leagues l
            where coalesce(l.draft_status, 'not_started') = 'not_started'
              -- inlined _draft_order_is_due: this is SECURITY INVOKER and the
              -- service role may not execute the internal helper
              and l.draft_date is not null
              and now() >= l.draft_date - interval '1 hour'
              -- the MIN_DRAFT_MEMBERS floor, as in _draft_order_sync: without it a
              -- stale under-filled league would keep the cron posting every tick
              and (select count(*) from public.league_members x where x.league_id = l.id) >= 4
              and not exists (select 1 from public.league_draft_order_meta m
                               where m.league_id = l.id and m.state <> 'open')
              -- 20261107000006: a league waiting on its roster reconfirmation can't be finalized
              and not exists (select 1 from public.league_roster_reconfirm r where r.league_id = l.id))
      or exists (
           select 1 from public.league_notifications n
            where n.kind <> 'member_left'   -- 20261107000006: delivered by leave-league, never by this cron
              and (n.push_status = 'pending'
                   or (n.push_status = 'sending' and n.push_attempted_at < now() - interval '10 minutes')));
$$;

revoke all on function public._draft_order_sync(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.finalize_due_draft_orders() from public, anon, authenticated;
revoke all on function public.draft_order_notify_due()    from public, anon, authenticated;
grant execute on function public.finalize_due_draft_orders() to service_role;
grant execute on function public.draft_order_notify_due()    to service_role;

-- ----------------------------------------------------------------------------
-- 3. The start gate. SECURITY DEFINER so it reads the row regardless of the
-- caller's RLS; callable by nobody (a trigger function).
-- ----------------------------------------------------------------------------
create or replace function public.enforce_league_roster_reconfirm_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(old.draft_status, 'not_started') = 'not_started'
     and new.draft_status is distinct from 'not_started'
     and exists (select 1 from public.league_roster_reconfirm r where r.league_id = new.id) then
    raise exception 'roster_reconfirm_required: the commissioner must confirm the teams before the draft can start'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_league_roster_reconfirm_gate() from public, anon, authenticated, service_role;

drop trigger if exists trg_leagues_roster_reconfirm_gate on public.leagues;
create trigger trg_leagues_roster_reconfirm_gate
  before update of draft_status on public.leagues
  for each row execute function public.enforce_league_roster_reconfirm_gate();
