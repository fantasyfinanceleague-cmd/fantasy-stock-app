-- ============================================================================
-- No joins once the draft room opens (join_league_by_code), and Run it back
-- answers lock then too (respond_to_renewal)
-- ============================================================================
-- Giorgio, 2026-10-14: "once the draft room opens (an hour before) the league
-- is considered started. no one can join and the share link cannot work"
--
-- Before this, join_league_by_code refused only once draft_status left
-- 'not_started', so a code worked for the whole hour the room was open, while
-- the app already hid Share from T-1h (the leave window, 20261110000000). The
-- client and the server now agree on the same moment.
--
-- THE CLOCK: public._draft_order_is_due(draft_date), i.e. draft_date is set
-- and now() >= draft_date - 1 hour. It is the one helper the room machinery is
-- built on: _draft_order_sync sets the order with it, the leave/transfer window
-- (_league_membership_window, 'locked_order_set') locks with it, and its hour
-- is draft_start_policy()'s room_lead_s (3600), which open_due_draft_rooms /
-- draft_room_notices_due and the draft-time lock (enforce_leagues_draft_time)
-- use. The mobile window (apps/mobile/lib/game/leaveLeague.ts leaveWindow,
-- which inviteShareShown reads) is the same formula, and so is preview-league
-- (reason.ts, via _shared/draft-start-policy.ts isRoomTime). No second clock.
--
-- POSTPONED STAYS JOINABLE: postpone_league_draft (20261111000000 §7) clears
-- draft_date, so _draft_order_is_due is false and the code works again, as the
-- app's Share comes back. Deliberately NOT the window's second arm (order
-- state 'finalized'/'locked'): a league postponed after its order was set
-- keeps state 'finalized' (the legacy backfill leaves exactly that), and that
-- arm would refuse a postponed league. Without a postponement the draft time
-- cannot move once the room is open (enforce_leagues_draft_time), so the time
-- arm alone covers every open room.
--
-- THE REASON: 'draft_started', reused. Giorgio: the league "is considered
-- started". Every client already maps it, with no new copy: mobile's
-- refineBlock reads it with the preview's draft_status ('not_started' here)
-- as 'draft_in_progress' ("{League} is drafting right now, so it can't take
-- new managers this season."); web's REASON_MSG has "This league's draft has
-- already started". It sits in the same place in the precedence, so
-- already_member (the Open button) and season_completed are unchanged.
--
-- SHORT LEAGUES: a league short of 4 managers when its room would open is
-- already postponed then, not at T: draft-autopick-sweep's watchLeague
-- (_shared/draft-start.ts) treats not_enough_members as a real blocker in the
-- gate window [T-1h-30s, T) and postpones at stage 'room_open', which clears
-- draft_date, so this function lets the code work again at once. Nothing to
-- move; pinned by draft-start.test.ts and this file's PGlite test.
--
-- LATE JOINERS (20261111000000's open_due_draft_rooms late-joiner notice,
-- #67's order re-sync on a member change): with this file, NO human can become
-- a member after T-1h: not by a code (join_league_by_code below) and not by a
-- Run it back "I'm in" (respond_to_renewal, at the end of this file). Only the
-- test-only add_bots still writes member rows then, and bots get no notices.
-- So the late-joiner NOTICE pass is unreachable for humans; the order re-sync
-- serves bots only. Kept on purpose, not deleted (Orchestrator, 2026-10-14):
-- the notice pass is a per-participant completeness check ("every human in
-- the order has this opening's notice") inside a cron-critical function, and
-- re-creating that function to remove a backstop buys nothing.
--
-- The function below is 20261107000005's body VERBATIM plus the conjunct
-- marked "20261123000000". CREATE OR REPLACE keeps the ACL; the grants are
-- re-asserted verbatim (service_role only), as in 20261107000005.
--
-- POST-PUSH EFFECT CHECK:
--   SELECT proacl, position('_draft_order_is_due' in prosrc) > 0 AS room_refuses
--     FROM pg_proc WHERE proname = 'join_league_by_code';
--   -- {postgres=X/postgres,service_role=X/postgres}, t
-- ============================================================================

create or replace function join_league_by_code(p_code text, p_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league      leagues%rowtype;
  v_invite      league_invites%rowtype;
  v_from_invite boolean := false;
  v_count       int;
begin
  -- resolve code: leagues.invite_code FIRST, else league_invites.code (mirrors client)
  select * into v_league from leagues where invite_code = p_code;
  if not found then
    select * into v_invite from league_invites where code = p_code;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'invalid_code');
    end if;
    select * into v_league from leagues where id = v_invite.league_id;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'invalid_code');
    end if;
    v_from_invite := true;
  end if;

  -- LOCK the league row -> serialize concurrent joins (last-seat capacity race fix)
  -- and concurrent draft-starts (see header comment above).
  select * into v_league from leagues where id = v_league.id for update;

  -- re-validate under the lock (season_status now: 'active'|'playoffs'|'completed')
  if v_league.season_status = 'completed' then
    return jsonb_build_object('ok', false, 'reason', 'season_completed');
  end if;

  if v_from_invite and (v_invite.status <> 'pending'
       or (v_invite.expires_at is not null and v_invite.expires_at < now())) then
    return jsonb_build_object('ok', false, 'reason', 'invite_expired');
  end if;

  if exists (select 1 from league_members
             where league_id = v_league.id and user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'already_member',
      'league', jsonb_build_object('id', v_league.id, 'name', v_league.name));
  end if;

  -- draft_status != 'not_started' -> refuse. Distinct reason so clients can
  -- surface "This league's draft has already started" instead of a generic
  -- failure. See header comment for why this sits here (after the lock and
  -- after already_member) and why 'completed' is refused too.
  -- 20261123000000: so is a league whose draft room has opened (T-1h). Same
  -- clock as the room, the order and the leave window: _draft_order_is_due.
  -- A postponed draft has no draft_date, so it stays joinable.
  if v_league.draft_status <> 'not_started'
     or public._draft_order_is_due(v_league.draft_date) then
    return jsonb_build_object('ok', false, 'reason', 'draft_started',
      'league', jsonb_build_object('id', v_league.id, 'name', v_league.name));
  end if;

  select count(*) into v_count from league_members where league_id = v_league.id;
  if v_count >= v_league.num_participants then
    return jsonb_build_object('ok', false, 'reason', 'league_full');
  end if;

  insert into league_members (league_id, user_id, role)
  values (v_league.id, p_user_id, 'member');

  if v_from_invite then
    update league_invites set status = 'accepted' where id = v_invite.id;
  end if;

  -- 20261107000005: "Invite someone new" was waiting for exactly this.
  delete from league_roster_reconfirm r
   where r.league_id = v_league.id
     and r.choice = 'invite'
     and p_user_id not like 'bot-%'
     and (v_league.league_type is distinct from 'matchup'
          or v_league.playoff_teams is null
          or v_league.playoff_teams <= v_count + 1);   -- v_count was read before this member's insert
  if found then
    -- Its own exception scope: the function-wide unique_violation handler below
    -- must not report a finalize failure as 'already_member' (security review).
    -- A failed finalize rolls back only itself; the join and the clear stand,
    -- and the order is set lazily by the next read or cron tick (every finalize
    -- path re-runs _draft_order_sync), so the gap is recoverable, not permanent.
    begin
      perform _draft_order_sync(v_league.id, false);   -- we hold the league row lock
    exception when others then
      raise warning 'join_league_by_code: deferred draft-order finalize for % (%: %)', v_league.id, sqlstate, sqlerrm;
    end;
  end if;

  return jsonb_build_object('ok', true,
    'league', jsonb_build_object('id', v_league.id, 'name', v_league.name));

exception
  -- composite PK (league_id, user_id): a concurrent same-user double-submit that
  -- slipped past the pre-check -> resolve to a clean already_member, not a 500.
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already_member',
      'league', jsonb_build_object('id', v_league.id, 'name', v_league.name));
end;
$$;

revoke all on function join_league_by_code(text, text) from public;
revoke all on function join_league_by_code(text, text) from anon;
revoke all on function join_league_by_code(text, text) from authenticated;
grant execute on function join_league_by_code(text, text) to service_role;

-- ============================================================================
-- Run it back answers lock when the room opens (Giorgio, 2026-10-14)
-- ============================================================================
-- respond_to_renewal let an invitee flip "I'm in" / "I'm out" until the draft
-- STARTED (rev 3.1: "free flips until the draft starts"), so inside the room's
-- hour an "I'm in" was a join and an "I'm out" a leave, against the ruling
-- above and the T-1h leave lock. Giorgio ruled (2026-10-14, relayed by the
-- Orchestrator): answers lock at room open. Same clock as join_league_by_code
-- (_draft_order_is_due), same refusal ('draft_started'), which the app already
-- words "The draft has started, so answers are locked." A postponed draft
-- (draft_date NULL) takes answers again.
--
-- remove_renewal_invitee is NOT changed: it only removes a PENDING invitee, and
-- a pending reply blocks setting a draft time (trg_leagues_renewal_gate), so it
-- cannot run inside an open room.
--
-- The function below is 20261115000003's body VERBATIM plus the conjunct marked
-- "20261123000000". The grants are re-asserted verbatim from 20261115000003
-- (authenticated only: the caller is auth.uid()).
--
-- POST-PUSH EFFECT CHECK:
--   SELECT proacl, position('_draft_order_is_due' in prosrc) > 0 AS locks_at_room
--     FROM pg_proc WHERE proname = 'respond_to_renewal';
--   -- {postgres=X/postgres,authenticated=X/postgres}, t
-- ============================================================================

create or replace function public.respond_to_renewal(p_league_id uuid, p_response text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
  v_l      public.leagues%rowtype;
  v_r      public.league_renewal_responses%rowtype;
  v_c      record;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_response is null or p_response not in ('in', 'out') then
    raise exception 'invalid_response' using errcode = '22023';
  end if;

  -- Lock the league first: every reply and the gate serialize on this row.
  select * into v_l from public.leagues where id = p_league_id for update;
  -- Uniform for anyone who is not an invitee (no existence or state oracle):
  -- an unknown league, a league that is not a renewal, and a stranger all get
  -- not_invited, BEFORE any draft-state reason is revealed.
  select * into v_r from public.league_renewal_responses
   where league_id = p_league_id and user_id = v_caller for update;
  if not found or v_l.id is null or v_l.previous_league_id is null then
    return jsonb_build_object('status', 'refused', 'reason', 'not_invited');
  end if;
  -- 20261123000000: answers lock when the draft room opens (T-1h), the same
  -- clock as join_league_by_code above. A postponed draft has no draft_date.
  if coalesce(v_l.draft_status, 'not_started') <> 'not_started'
     or public._draft_order_is_due(v_l.draft_date) then
    return jsonb_build_object('status', 'refused', 'reason', 'draft_started');
  end if;
  if v_r.decided_by = 'commissioner' and v_r.status = 'out' then
    return jsonb_build_object('status', 'refused', 'reason', 'removed');
  end if;
  if v_l.commissioner_id = v_caller and p_response = 'out' then
    return jsonb_build_object('status', 'refused', 'reason', 'commissioner_cannot_opt_out');
  end if;
  if v_r.status = p_response then
    return jsonb_build_object('status', 'unchanged', 'response', p_response);
  end if;

  -- The seat cap (num_participants = 16 until the draft), checked BEFORE any
  -- write so a refusal writes nothing. Newcomers and bots share the seats, so
  -- this refusal is reachable; it is loud, never a silent over-cap member.
  if p_response = 'in'
     and (select count(*) from public.league_members where league_id = p_league_id) >= v_l.num_participants then
    return jsonb_build_object('status', 'refused', 'reason', 'league_full');
  end if;

  update public.league_renewal_responses
     set status = p_response, decided_by = 'player', responded_at = now()
   where league_id = p_league_id and user_id = v_caller;

  if p_response = 'in' then
    insert into public.league_members (league_id, user_id, role)
    values (p_league_id, v_caller, 'member')
    on conflict (league_id, user_id) do nothing;
  else
    delete from public.league_members where league_id = p_league_id and user_id = v_caller;
  end if;

  select * into v_c from public._renewal_counts(p_league_id);
  insert into public.league_notifications (league_id, user_id, kind, subject_user_id, detail)
  values (p_league_id, v_l.commissioner_id, 'renewal_reply', v_caller, jsonb_build_object(
    'response', p_response,
    'subject_name', public.participant_display_name(v_caller),
    'season_number', v_l.season_number,
    'in', v_c.n_in + v_c.n_new,
    'out', v_c.n_out,
    'pending', v_c.n_pending));

  return jsonb_build_object('status', 'replied', 'response', p_response,
    'in', v_c.n_in + v_c.n_new, 'out', v_c.n_out, 'pending', v_c.n_pending);
end;
$$;

revoke all on function public.respond_to_renewal(uuid, text)                 from public, anon, service_role;
grant execute on function public.respond_to_renewal(uuid, text)              to authenticated;
