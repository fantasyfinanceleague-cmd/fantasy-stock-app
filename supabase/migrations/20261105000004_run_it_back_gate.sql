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
-- It keys on the pending rows, so it holds even if a league's predecessor link
-- were ever cleared; the team cap applies only to renewed leagues.
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
  -- Keyed on the PENDING ROWS, not on previous_league_id: a league whose
  -- predecessor link is cleared must not escape the gate (security review).
  -- Ordinary leagues have no response rows, so the EXISTS is false for them.
  if (new.draft_date is distinct from old.draft_date
      or new.draft_order_mode is distinct from old.draft_order_mode
      or new.draft_status is distinct from old.draft_status)
     and exists (select 1 from public.league_renewal_responses r
                  where r.league_id = new.id and r.status = 'pending') then
    raise exception 'renewal_replies_pending: every Season 1 player must answer before the draft can be set or started'
      using errcode = '22023';
  end if;

  -- The team cap at start applies to renewed leagues only.
  if new.previous_league_id is not null
     and old.draft_status = 'not_started' and new.draft_status is distinct from 'not_started' then
    new.num_participants := (select count(*)::int from public.league_members m where m.league_id = new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_leagues_renewal_gate on public.leagues;
create trigger trg_leagues_renewal_gate
  before update on public.leagues
  for each row execute function public.enforce_league_renewal_gate();

-- ----------------------------------------------------------------------------
-- The lineage columns are written by the renewal RPCs only. A DIRECT client write
-- (PostgREST: current_user = 'authenticated' or 'anon') may not set, change or
-- clear previous_league_id, lineage_id or season_number, or insert them away from
-- their defaults. That closes two forgeries the RLS policies allow today:
-- leagues_insert_self_commissioner and leagues_update_commissioner place no column
-- limits, so a commissioner could otherwise join a victim's lineage, or clear the
-- predecessor link to switch the gate off.
--
-- SECURITY INVOKER on purpose: current_user is then the CALLER's role. The
-- renewal RPCs are SECURITY DEFINER, so inside them current_user is postgres and
-- the check does not apply to them. (A DEFINER trigger would always see the owner.)
-- ----------------------------------------------------------------------------
create or replace function public.enforce_league_lineage_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;   -- the renewal RPCs (definer) and the owner / service paths
  end if;
  if tg_op = 'INSERT' then
    if new.previous_league_id is not null or new.lineage_id is not null
       or new.season_number is distinct from 1 then
      raise exception 'renewal_lineage_locked: lineage columns are written by the renewal functions only'
        using errcode = '42501';
    end if;
  elsif (new.previous_league_id is distinct from old.previous_league_id
      or new.lineage_id is distinct from old.lineage_id
      or new.season_number is distinct from old.season_number) then
    raise exception 'renewal_lineage_locked: lineage columns are written by the renewal functions only'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leagues_lineage_columns on public.leagues;
create trigger trg_leagues_lineage_columns
  before insert or update on public.leagues
  for each row execute function public.enforce_league_lineage_columns();

revoke all on function public.enforce_league_renewal_gate() from public, anon, authenticated, service_role;
-- ----------------------------------------------------------------------------
-- The membership guard. Every way a member row is written (join_league_by_code,
-- add_bots, respond_to_renewal, a direct insert) passes here, so the renewal
-- state and the membership can never disagree. Ordinary leagues: untouched.
--
--   * An invitee who gets a seat by ANY path becomes 'in' (decided by the player),
--     so membership and the reply record agree (in <=> member).
--   * A player the commissioner removed ('out', decided by the commissioner) is
--     refused: "Remove is final" holds on the join path too.
--   * SEATS ARE RESERVED for pending invitees. A newcomer or bot may take a seat
--     only if members + pending + 1 fits the cap, so an invitee can always still
--     answer in. Without this, newcomers can fill the 16 seats before the invitees
--     reply and lock them out.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_renewal_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cap      int;
  v_renewed  boolean;
  v_r        public.league_renewal_responses%rowtype;
  v_members  int;
  v_pending  int;
begin
  select (l.previous_league_id is not null), l.num_participants
    into v_renewed, v_cap
    from public.leagues l where l.id = new.league_id;
  if not found or not v_renewed then
    return new;
  end if;

  select * into v_r from public.league_renewal_responses
   where league_id = new.league_id and user_id = new.user_id;
  if found then
    if v_r.status = 'out' and v_r.decided_by = 'commissioner' then
      raise exception 'renewal_removed_final: the commissioner removed this player'
        using errcode = '22023';
    end if;
    if v_r.status <> 'in' then
      update public.league_renewal_responses
         set status = 'in', decided_by = 'player', responded_at = now()
       where league_id = new.league_id and user_id = new.user_id;
    end if;
    return new;   -- an invitee already holds a reserved seat
  end if;

  -- A newcomer or a bot: may take only an UNRESERVED seat.
  select count(*)::int into v_members from public.league_members where league_id = new.league_id;
  select count(*)::int into v_pending from public.league_renewal_responses
   where league_id = new.league_id and status = 'pending';
  if v_members + v_pending + 1 > v_cap then
    raise exception 'league_full: the seats are full (invitees still to reply hold theirs)'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_league_members_renewal_guard on public.league_members;
create trigger trg_league_members_renewal_guard
  before insert on public.league_members
  for each row execute function public.enforce_renewal_membership();

revoke all on function public.enforce_renewal_membership() from public, anon, authenticated, service_role;

revoke all on function public.enforce_league_lineage_columns() from public, anon, authenticated, service_role;
revoke all on function public.enforce_renewal_response_transitions() from public, anon, authenticated, service_role;
