-- ============================================================================
-- Account deletion (3/8): a deleted seat is never a commissioner, an invitee,
-- or born on insert
-- ============================================================================
-- Plan: docs/plans/2026-10-21-account-deletion.md. 20261125000001 adds the
-- deleted seat (league_members.deleted_at). Three existing paths treat every
-- non-hidden member as a live person, and each would mis-handle a seat whose
-- manager no longer exists (CLAUDE.md: guards keyed on the old state are blind to
-- the new partial state):
--
--   1. transfer_commissioner (20261120000000) refused a hidden target but not a
--      deleted one. After the season a commissioner could hand the title to a
--      seat nobody can sign in to, leaving a league no one can run. Now
--      'target_invalid', like a hidden member.
--   2. renew_league (20261115000003) invites every non-hidden human of the
--      finished league. A deleted seat would get a 'pending' reply that no one
--      can ever answer, and the renewal gate (20261115000004) blocks the draft
--      while ANY reply is pending, so the new season would wait until the
--      commissioner found and removed it by hand. Now deleted seats are skipped,
--      in BOTH the expected count and the insert, so the count check still
--      compares like with like.
--   3. league_members_insert_self (20261120000001) let a commissioner insert
--      their own row with any deleted_at, i.e. a seat born "deleted" (it would
--      read the placeholder, and take_over_team would offer it to strangers once
--      the draft completed). Now `deleted_at is null` is required, as
--      20261120000001 did for hidden_at. Only scrub_deleted_manager sets it.
--
-- Both functions are their latest bodies with only the lines marked
-- "20261125000002" added (the PGlite suite diffs them against the source).
-- CREATE OR REPLACE keeps the ACLs; they are re-asserted verbatim from the
-- source files. POLICIES ARE NOT REPLACEABLE IN PLACE: the drop + create runs
-- in this file's one transaction (db push wraps each file), so there is no
-- window with no policy.
--
-- PROVISIONAL TIMESTAMP: see 20261125000000.
--
-- POST-PUSH CHECKS (SQL editor):
--   SELECT proname, proacl, position('deleted_at is null' in prosrc) > 0 AS refuses_deleted
--     FROM pg_proc WHERE proname IN ('transfer_commissioner', 'renew_league');
--   -- transfer_commissioner {postgres=X/postgres,service_role=X/postgres}, t
--   -- renew_league          {postgres=X/postgres,authenticated=X/postgres}, t
--   SELECT with_check FROM pg_policies
--    WHERE tablename = 'league_members' AND policyname = 'league_members_insert_self';
--   -- ... AND (hidden_at IS NULL) AND (deleted_at IS NULL)
-- ============================================================================

-- ---- 1. transfer_commissioner (20261120000000) -------------------------------
create or replace function public.transfer_commissioner(
  p_league_id        uuid,
  p_user_id          text,
  p_new_commissioner text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l      public.leagues%rowtype;
  v_notice uuid;
  v_window text;
begin
  if p_league_id is null or p_user_id is null or btrim(p_user_id) = '' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  select * into v_l from public.leagues where id = p_league_id for update;
  -- Uniform for an unknown league and a non-commissioner (no existence oracle).
  if not found or v_l.commissioner_id is distinct from p_user_id then
    return jsonb_build_object('status', 'refused', 'reason', 'not_commissioner');
  end if;
  v_window := public._league_membership_window(p_league_id);
  if v_window = 'locked_order_set' then
    return jsonb_build_object('status', 'refused', 'reason', 'locked_in', 'window', 'order_set');
  elsif v_window = 'locked_season' then
    return jsonb_build_object('status', 'refused', 'reason', 'locked_in', 'window', 'season');
  end if;
  if p_new_commissioner is null or p_new_commissioner = p_user_id
     or p_new_commissioner like 'bot-%' or not exists (
       select 1 from public.league_members
        where league_id = p_league_id and user_id = p_new_commissioner
          and hidden_at is null   -- 20261120000000: a player who has left is not a current member
          and deleted_at is null) then   -- 20261125000002: nor is a deleted manager's seat
    return jsonb_build_object('status', 'refused', 'reason', 'target_invalid');
  end if;

  -- Every refusal is above this line: nothing has been written yet.
  update public.leagues set commissioner_id = p_new_commissioner where id = p_league_id;
  -- Every stale 'commissioner' role goes, not just the caller's (a legacy row
  -- could carry one). The authority is leagues.commissioner_id; the role column
  -- is display, and is kept exactly in step.
  update public.league_members set role = 'member'
   where league_id = p_league_id and role = 'commissioner' and user_id <> p_new_commissioner;
  update public.league_members set role = 'commissioner'
   where league_id = p_league_id and user_id = p_new_commissioner;

  insert into public.league_notifications (league_id, user_id, kind)
  values (p_league_id, p_new_commissioner, 'commissioner_transferred')
  returning id into v_notice;

  return jsonb_build_object(
    'status', 'transferred',
    'window', v_window,   -- 'before_draft' | 'after_season'
    'reconfirm_owed', exists (select 1 from public.league_roster_reconfirm r where r.league_id = p_league_id),
    -- For the edge function's push only; it never forwards these to the client.
    'notice_id', v_notice,
    'notify_user_id', p_new_commissioner,
    'from_name', public.participant_display_name(p_user_id),
    'league_name', v_l.name);
end;
$$;

revoke all on function public.transfer_commissioner(uuid, text, text) from public;
revoke all on function public.transfer_commissioner(uuid, text, text) from anon;
revoke all on function public.transfer_commissioner(uuid, text, text) from authenticated;
grant execute on function public.transfer_commissioner(uuid, text, text) to service_role;

-- ---- 2. renew_league (20261115000003) ----------------------------------------
create or replace function public.renew_league(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller   text := auth.uid()::text;
  v_old      public.leagues%rowtype;
  v_season   public.league_seasons%rowtype;
  v_existing uuid;
  v_new_id   uuid;
  v_code     text;
  v_slots_old int;
  v_slots_new int;
  v_invited_expected int;
  v_invited  int;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Serialize: a second tap waits here, then sees the successor below.
  select * into v_old from public.leagues where id = p_league_id for update;
  -- A missing league and a non-commissioner get the SAME error: no existence oracle.
  if not found or v_old.commissioner_id is distinct from v_caller then
    raise exception 'not_commissioner' using errcode = '42501';
  end if;

  select id into v_existing from public.leagues where previous_league_id = v_old.id;
  if found then
    return jsonb_build_object('status', 'already_renewed', 'league_id', v_existing);
  end if;

  if v_old.league_type is distinct from 'matchup' then
    return jsonb_build_object('status', 'refused', 'reason', 'unsupported_league_type');
  end if;
  if v_old.season_status is distinct from 'completed' then
    return jsonb_build_object('status', 'refused', 'reason', 'season_not_complete');
  end if;
  select * into v_season from public.league_seasons where id = v_old.current_season_id;
  if not found or v_season.completed_at is null then
    -- season_status and the season row must agree (get_season_result's rule).
    return jsonb_build_object('status', 'refused', 'reason', 'season_not_complete');
  end if;

  v_code := public._renewal_invite_code();

  -- Settings copied as they are; the review edits them through start_renewed_season.
  -- A 'legacy' draft order is backfill-only (20261013000000) and is never copied:
  -- the new season starts as a normal league.
  insert into public.leagues (
    name, commissioner_id, invite_code, num_participants, num_rounds, stake_mode,
    notional_per_slot, budget_amount, budget_mode, allow_undraftable, league_type,
    duration_days, num_weeks, playoff_teams, draft_order_mode, pick_seconds,
    pick_clock_enabled, draft_status, draft_date, current_week, season_status,
    previous_league_id, lineage_id, season_number
  ) values (
    v_old.name, v_old.commissioner_id, v_code,
    16,                                  -- the ceiling until the draft starts (§2.7)
    v_old.num_rounds, v_old.stake_mode, v_old.notional_per_slot, v_old.budget_amount,
    v_old.budget_mode, v_old.allow_undraftable, v_old.league_type, v_old.duration_days,
    v_old.num_weeks, v_old.playoff_teams,
    case when v_old.draft_order_mode = 'legacy' then 'random' else v_old.draft_order_mode end,
    v_old.pick_seconds, v_old.pick_clock_enabled,
    'not_started', null, 1, 'active',
    v_old.id, coalesce(v_old.lineage_id, v_old.id), v_old.season_number + 1
  )
  returning id into v_new_id;

  -- Slots: copy, then count against the source (CLAUDE.md: count, not exists).
  insert into public.league_draft_slots (league_id, slot_index, slot_count, price_min, price_max, category_id)
  select v_new_id, s.slot_index, s.slot_count, s.price_min, s.price_max, s.category_id
    from public.league_draft_slots s where s.league_id = v_old.id;
  select count(*)::int into v_slots_old from public.league_draft_slots where league_id = v_old.id;
  select count(*)::int into v_slots_new from public.league_draft_slots where league_id = v_new_id;
  if v_slots_new <> v_slots_old then
    raise exception 'renewal_copy_mismatch: slots % of %', v_slots_new, v_slots_old using errcode = 'P0001';
  end if;

  -- The commissioner is in (a member and an 'in' row); everyone else is invited.
  insert into public.league_members (league_id, user_id, role)
  values (v_new_id, v_caller, 'commissioner');
  insert into public.league_renewal_responses (league_id, user_id, status, decided_by, responded_at)
  values (v_new_id, v_caller, 'in', 'player', now());

  -- hidden_at (#126, leave-league): a player who left the finished Season 1
  -- league is hidden, not invited back.
  -- 20261125000002: nor is a deleted manager's seat: their pending reply would
  -- hold the renewal gate shut until the commissioner removed it by hand.
  select count(*)::int into v_invited_expected
    from public.league_members m
   where m.league_id = v_old.id and m.user_id <> v_caller and m.user_id not like 'bot-%'
     and m.hidden_at is null
     and m.deleted_at is null;   -- 20261125000002: a deleted manager is never invited back
  insert into public.league_renewal_responses (league_id, user_id, status)
  select v_new_id, m.user_id, 'pending'
    from public.league_members m
   where m.league_id = v_old.id and m.user_id <> v_caller and m.user_id not like 'bot-%'
     and m.hidden_at is null
     and m.deleted_at is null;   -- 20261125000002: a deleted manager is never invited back
  get diagnostics v_invited = row_count;
  if v_invited <> v_invited_expected then
    raise exception 'renewal_copy_mismatch: invitations % of %', v_invited, v_invited_expected using errcode = 'P0001';
  end if;

  -- One ask per invitee, exactly once (partial unique index on renewal_invite).
  insert into public.league_notifications (league_id, user_id, kind, subject_user_id, detail)
  select v_new_id, r.user_id, 'renewal_invite', v_caller, jsonb_build_object(
           'commissioner_name', public.participant_display_name(v_caller),
           'league_name', v_old.name,
           'season_number', v_old.season_number + 1)
    from public.league_renewal_responses r
   where r.league_id = v_new_id and r.status = 'pending';

  return jsonb_build_object(
    'status', 'renewed',
    'league_id', v_new_id,
    'invite_code', v_code,
    'invited', v_invited);
end;
$$;

revoke all on function public.renew_league(uuid)                             from public, anon, service_role;
grant execute on function public.renew_league(uuid)                          to authenticated;

-- ---- 3. league_members_insert_self (20261120000001) --------------------------
drop policy "league_members_insert_self" on league_members;

create policy "league_members_insert_self" on league_members
  for insert to authenticated
  with check (
    user_id = auth.uid()::text
    and role = 'commissioner'
    and exists (
      select 1 from leagues l
      where l.id = league_members.league_id
        and l.commissioner_id = auth.uid()::text
        and l.draft_status = 'not_started'
    )
    and hidden_at is null   -- 20261120000001: never born hidden; only leave_league hides
    and deleted_at is null  -- 20261125000002: never born deleted; only scrub_deleted_manager deletes
  );
