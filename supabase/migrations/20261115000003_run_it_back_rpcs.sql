-- ============================================================================
-- Run it back (4/6): the renewal RPCs, the newcomer history read, and the
-- renewal gate on set_draft_order
-- ============================================================================
-- Design: docs/migrations/RUN_IT_BACK_DESIGN.md (rev 3.1), §2.1–§2.6.
--
-- COMMISSIONER (auth.uid() must equal leagues.commissioner_id, checked BEFORE
-- any state, so a non-commissioner learns nothing about the league's state):
--   renew_league(p_league_id)                        -> jsonb   "Run it back"
--   start_renewed_season(p_league_id, p_settings, p_slots) -> jsonb   the review
--   nudge_renewal(p_league_id, p_user_id)            -> jsonb   "Nudge again"
--   remove_renewal_invitee(p_league_id, p_user_id)   -> jsonb   "Remove"
--   cancel_league_renewal(p_league_id)               -> jsonb
-- PLAYER (auth.uid() must hold a response row in the league):
--   respond_to_renewal(p_league_id, p_response)      -> jsonb   "I'm in" / "I'm out"
-- READS:
--   get_renewal_roster(p_league_id)                  -> jsonb   the "Who's running back" list
--   get_league_history(p_league_id)                  -> table   one row per season in the lineage
--   get_season_matchups(p_league_id)                 -> table   week-by-week matchups in the lineage
--
-- Every function: SECURITY DEFINER, search_path pinned, revoked from PUBLIC,
-- anon and service_role, then granted to authenticated only. Refusals of game
-- state return {"status":"refused","reason":...}; identity failures raise 42501.
--
-- PROVISIONAL TIMESTAMP: re-stamp before release (see 20261105000000's header).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helpers (internal: no client EXECUTE)
-- ----------------------------------------------------------------------------

-- A fresh invite code: the mobile client's alphabet and length
-- (apps/mobile/lib/inviteCode.ts: 32 symbols, 10 characters). 256 is a multiple
-- of 32, so one byte mod 32 is unbiased.
create or replace function public._renewal_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code  text;
  v_tries int := 0;
begin
  loop
    v_code := '';
    for i in 1..10 loop
      v_code := v_code || substr(c_alphabet,
        (get_byte(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 0) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.leagues where invite_code = v_code)
          and not exists (select 1 from public.league_invites where code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 20 then
      raise exception 'invite_code_exhausted' using errcode = '53000';
    end if;
  end loop;
  return v_code;
end;
$$;

-- The reply counts for a renewal. "in" counts the response rows that are in;
-- "new" counts members with no response row (newcomers who joined by code).
-- The commissioner's own row is 'in', so they are counted once.
create or replace function public._renewal_counts(p_league_id uuid)
returns table(n_in int, n_new int, n_out int, n_pending int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select count(*)::int from public.league_renewal_responses r
      where r.league_id = p_league_id and r.status = 'in'),
    (select count(*)::int from public.league_members m
      where m.league_id = p_league_id
        and m.user_id not like 'bot-%'
        and not exists (select 1 from public.league_renewal_responses r
                         where r.league_id = m.league_id and r.user_id = m.user_id)),
    (select count(*)::int from public.league_renewal_responses r
      where r.league_id = p_league_id and r.status = 'out'),
    (select count(*)::int from public.league_renewal_responses r
      where r.league_id = p_league_id and r.status = 'pending');
$$;

-- ----------------------------------------------------------------------------
-- renew_league: the "Run it back" tap. One transaction.
-- ----------------------------------------------------------------------------
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

  select count(*)::int into v_invited_expected
    from public.league_members m
   where m.league_id = v_old.id and m.user_id <> v_caller and m.user_id not like 'bot-%';
  insert into public.league_renewal_responses (league_id, user_id, status)
  select v_new_id, m.user_id, 'pending'
    from public.league_members m
   where m.league_id = v_old.id and m.user_id <> v_caller and m.user_id not like 'bot-%';
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

-- ----------------------------------------------------------------------------
-- respond_to_renewal: a player's own "I'm in" / "I'm out". Free flips until the
-- draft starts (Giorgio, rev 3.1). The commissioner's notice is per answer.
-- ----------------------------------------------------------------------------
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
  if coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
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

-- ----------------------------------------------------------------------------
-- nudge_renewal: "Nudge again". Re-sends the ask to ONE pending player. Never
-- changes status. At most once per 24 h per player.
-- ----------------------------------------------------------------------------
create or replace function public.nudge_renewal(p_league_id uuid, p_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
  v_l      public.leagues%rowtype;
  v_r      public.league_renewal_responses%rowtype;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_l from public.leagues where id = p_league_id for update;
  if not found or v_l.previous_league_id is null then
    raise exception 'not_commissioner' using errcode = '42501';
  end if;
  if v_l.commissioner_id is distinct from v_caller then
    raise exception 'not_commissioner' using errcode = '42501';
  end if;
  if coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
    return jsonb_build_object('status', 'refused', 'reason', 'draft_started');
  end if;

  select * into v_r from public.league_renewal_responses
   where league_id = p_league_id and user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('status', 'refused', 'reason', 'not_invited');
  end if;
  if v_r.status <> 'pending' then
    return jsonb_build_object('status', 'refused', 'reason', 'not_pending');
  end if;
  if v_r.last_nudged_at is not null and v_r.last_nudged_at > now() - interval '24 hours' then
    return jsonb_build_object('status', 'refused', 'reason', 'nudge_too_soon');
  end if;

  -- status is deliberately NOT in this update (the one-way door, §2.5).
  update public.league_renewal_responses
     set nudge_count = nudge_count + 1, last_nudged_at = now()
   where league_id = p_league_id and user_id = p_user_id;

  insert into public.league_notifications (league_id, user_id, kind, subject_user_id, detail)
  values (p_league_id, p_user_id, 'renewal_nudge', v_caller, jsonb_build_object(
    'commissioner_name', public.participant_display_name(v_caller),
    'league_name', v_l.name,
    'season_number', v_l.season_number));

  return jsonb_build_object('status', 'nudged', 'nudge_count', v_r.nudge_count + 1);
end;
$$;

-- ----------------------------------------------------------------------------
-- remove_renewal_invitee: "Remove". pending -> out, decided by the commissioner.
-- Final for that player: the guard trigger refuses any later change to the row.
-- ----------------------------------------------------------------------------
create or replace function public.remove_renewal_invitee(p_league_id uuid, p_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
  v_l      public.leagues%rowtype;
  v_r      public.league_renewal_responses%rowtype;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_l from public.leagues where id = p_league_id for update;
  if not found or v_l.previous_league_id is null
     or v_l.commissioner_id is distinct from v_caller then
    raise exception 'not_commissioner' using errcode = '42501';
  end if;
  if coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
    return jsonb_build_object('status', 'refused', 'reason', 'draft_started');
  end if;

  select * into v_r from public.league_renewal_responses
   where league_id = p_league_id and user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('status', 'refused', 'reason', 'not_invited');
  end if;
  if v_r.status <> 'pending' then
    return jsonb_build_object('status', 'refused', 'reason', 'not_pending');
  end if;

  update public.league_renewal_responses
     set status = 'out', decided_by = 'commissioner', responded_at = now()
   where league_id = p_league_id and user_id = p_user_id;

  insert into public.league_notifications (league_id, user_id, kind, subject_user_id, detail)
  values (p_league_id, p_user_id, 'renewal_removed', v_caller, jsonb_build_object(
    'commissioner_name', public.participant_display_name(v_caller),
    'league_name', v_l.name,
    'season_number', v_l.season_number));

  return jsonb_build_object('status', 'removed');
end;
$$;

-- ----------------------------------------------------------------------------
-- start_renewed_season: the review's "Start Season 2". Applies the reviewed
-- settings and the draft date, replaces the slots when given, and notifies
-- every member. Refused while any reply is pending (the same predicate as the
-- gate). Settings the whitelist does not name are REFUSED, never ignored.
-- ----------------------------------------------------------------------------
create or replace function public.start_renewed_season(
  p_league_id uuid,
  p_settings  jsonb default '{}'::jsonb,
  p_slots     jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller  text := auth.uid()::text;
  v_l       public.leagues%rowtype;
  v_draft   timestamptz;
  v_bad     text[];
  v_pending int;
  c_allowed constant text[] := array[
    'name', 'num_rounds', 'stake_mode', 'notional_per_slot', 'budget_amount',
    'allow_undraftable', 'num_weeks', 'playoff_teams', 'draft_order_mode',
    'pick_seconds', 'draft_date'];   -- pick_clock_enabled is not a renewal setting (20261010000000: client writes are always clocked)
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_l from public.leagues where id = p_league_id for update;
  if not found or v_l.previous_league_id is null
     or v_l.commissioner_id is distinct from v_caller then
    raise exception 'not_commissioner' using errcode = '42501';
  end if;
  if coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
    return jsonb_build_object('status', 'refused', 'reason', 'draft_started');
  end if;
  if v_l.season_status is distinct from 'active' then
    return jsonb_build_object('status', 'refused', 'reason', 'season_not_active');
  end if;

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    return jsonb_build_object('status', 'refused', 'reason', 'invalid_settings');
  end if;
  select array_agg(k) into v_bad
    from jsonb_object_keys(p_settings) k where k <> all (c_allowed);
  if v_bad is not null then
    return jsonb_build_object('status', 'refused', 'reason', 'invalid_settings', 'unknown_keys', to_jsonb(v_bad));
  end if;
  if p_slots is not null and jsonb_typeof(p_slots) <> 'array' then
    return jsonb_build_object('status', 'refused', 'reason', 'invalid_slots');
  end if;

  -- The draft date must be known once this succeeds: check BEFORE any write.
  v_draft := case when p_settings ? 'draft_date'
                  then (p_settings->>'draft_date')::timestamptz else v_l.draft_date end;
  if v_draft is null then
    return jsonb_build_object('status', 'refused', 'reason', 'no_draft_date');
  end if;

  select count(*)::int into v_pending from public.league_renewal_responses
   where league_id = p_league_id and status = 'pending';
  if v_pending > 0 then
    return jsonb_build_object('status', 'refused', 'reason', 'renewal_replies_pending', 'pending', v_pending);
  end if;

  update public.leagues set
    name              = case when p_settings ? 'name'              then p_settings->>'name'                          else name end,
    num_rounds        = case when p_settings ? 'num_rounds'        then (p_settings->>'num_rounds')::int             else num_rounds end,
    stake_mode        = case when p_settings ? 'stake_mode'        then p_settings->>'stake_mode'                    else stake_mode end,
    notional_per_slot = case when p_settings ? 'notional_per_slot' then (p_settings->>'notional_per_slot')::numeric  else notional_per_slot end,
    budget_amount     = case when p_settings ? 'budget_amount'     then (p_settings->>'budget_amount')::numeric      else budget_amount end,
    allow_undraftable = case when p_settings ? 'allow_undraftable' then (p_settings->>'allow_undraftable')::boolean  else allow_undraftable end,
    num_weeks         = case when p_settings ? 'num_weeks'         then (p_settings->>'num_weeks')::int              else num_weeks end,
    playoff_teams     = case when p_settings ? 'playoff_teams'     then (p_settings->>'playoff_teams')::int          else playoff_teams end,
    draft_order_mode  = case when p_settings ? 'draft_order_mode'  then p_settings->>'draft_order_mode'              else draft_order_mode end,
    pick_seconds      = case when p_settings ? 'pick_seconds'      then (p_settings->>'pick_seconds')::smallint      else pick_seconds end,
    draft_date        = v_draft
  where id = p_league_id;

  if p_slots is not null then
    delete from public.league_draft_slots where league_id = p_league_id;
    insert into public.league_draft_slots (league_id, slot_index, slot_count, price_min, price_max, category_id)
    select p_league_id, s.slot_index, coalesce(s.slot_count, 1), s.price_min, s.price_max, s.category_id
      from jsonb_to_recordset(p_slots) as s(slot_index int, slot_count int, price_min numeric,
                                            price_max numeric, category_id uuid);
  end if;

  -- Every member but the commissioner. Idempotent: the partial unique index
  -- makes a second "Start Season 2" write nothing new.
  insert into public.league_notifications (league_id, user_id, kind, subject_user_id, detail)
  select p_league_id, m.user_id, 'season_set', v_caller, jsonb_build_object(
           'league_name', v_l.name, 'season_number', v_l.season_number, 'draft_date', v_draft)
    from public.league_members m
   where m.league_id = p_league_id and m.user_id <> v_caller and m.user_id not like 'bot-%'
  on conflict do nothing;

  return jsonb_build_object('status', 'season_set', 'draft_date', v_draft);
end;
$$;

-- ----------------------------------------------------------------------------
-- cancel_league_renewal: discard a renewal before the draft. The new league is
-- deleted; its members, responses, notices, slots and any open order cascade.
-- The predecessor is untouched and can be renewed again.
-- ----------------------------------------------------------------------------
create or replace function public.cancel_league_renewal(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
  v_l      public.leagues%rowtype;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_l from public.leagues where id = p_league_id for update;
  if not found or v_l.commissioner_id is distinct from v_caller then
    raise exception 'not_commissioner' using errcode = '42501';
  end if;
  if v_l.previous_league_id is null then
    return jsonb_build_object('status', 'refused', 'reason', 'not_renewal');
  end if;
  if coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
    return jsonb_build_object('status', 'refused', 'reason', 'draft_started');
  end if;
  delete from public.leagues where id = p_league_id;
  return jsonb_build_object('status', 'cancelled');
end;
$$;

-- ----------------------------------------------------------------------------
-- get_renewal_roster: the "Who's running back" list.
--   * A member of the new league (the commissioner, an in player, a newcomer)
--     gets the FULL list, read-only; the commissioner also gets actions.
--   * A pending or out invitee gets ONLY their own status (rev 3.1).
--   * Anyone else gets {status:'not_visible'} (no existence oracle).
-- ----------------------------------------------------------------------------
create or replace function public.get_renewal_roster(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
  v_l      public.leagues%rowtype;
  v_r      public.league_renewal_responses%rowtype;
  v_member boolean;
  v_is_c   boolean;
  v_people jsonb;
  v_c      record;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_l from public.leagues where id = p_league_id;
  if not found or v_l.previous_league_id is null then
    return jsonb_build_object('status', 'not_visible');
  end if;
  select * into v_r from public.league_renewal_responses
   where league_id = p_league_id and user_id = v_caller;
  v_member := public.is_member(p_league_id);
  if not v_member and not found then
    return jsonb_build_object('status', 'not_visible');
  end if;

  if not v_member then
    -- commissioner_name: so a pending invitee's ask can name who is running it back.
    return jsonb_build_object(
      'status', 'ok', 'league_id', p_league_id, 'full_list', false,
      'commissioner_name', public.participant_display_name(v_l.commissioner_id),
      'caller_status', v_r.status, 'caller_decided_by', v_r.decided_by,
      'draft_status', v_l.draft_status, 'draft_date', v_l.draft_date);
  end if;

  v_is_c := v_l.commissioner_id = v_caller;
  select * into v_c from public._renewal_counts(p_league_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', x.user_id,
           'display_name', public.participant_display_name(x.user_id),
           'group', x.grp,
           'is_commissioner', x.user_id = v_l.commissioner_id,
           'decided_by', x.decided_by,
           'responded_at', case when x.grp in ('in','out') then x.responded_at end,
           'nudge_count', case when v_is_c then x.nudge_count end,
           'last_nudged_at', case when v_is_c then x.last_nudged_at end,
           'can_nudge', v_is_c and x.grp = 'pending'
                        and (x.last_nudged_at is null or x.last_nudged_at <= now() - interval '24 hours'),
           'can_remove', v_is_c and x.grp = 'pending'
         ) order by x.grp, x.user_id), '[]'::jsonb)
    into v_people
    from (
      select r.user_id,
             case r.status when 'in' then 'in' when 'out' then 'out' else 'pending' end as grp,
             r.decided_by, r.responded_at, r.nudge_count, r.last_nudged_at
        from public.league_renewal_responses r where r.league_id = p_league_id
      union all
      select m.user_id, 'new', null::text, null::timestamptz, 0::smallint, null::timestamptz
        from public.league_members m
       where m.league_id = p_league_id
         and m.user_id not like 'bot-%'
         and not exists (select 1 from public.league_renewal_responses r
                          where r.league_id = m.league_id and r.user_id = m.user_id)
    ) x;

  return jsonb_build_object(
    'status', 'ok',
    'league_id', p_league_id,
    'full_list', true,
    'commissioner_name', public.participant_display_name(v_l.commissioner_id),
    'is_commissioner', v_is_c,
    'caller_status', case when v_r.user_id is null then 'new' else v_r.status end,
    'draft_status', v_l.draft_status,
    'draft_date', v_l.draft_date,
    'counts', jsonb_build_object(
      'in', v_c.n_in, 'new', v_c.n_new, 'out', v_c.n_out, 'pending', v_c.n_pending,
      'team_count', v_c.n_in + v_c.n_new, 'max_teams', 16),
    'replies_pending', v_c.n_pending > 0,
    'people', v_people);
end;
$$;

-- ----------------------------------------------------------------------------
-- Lineage reads. Visibility is a CEILING: a caller sees every season up to the
-- latest one they were a member of in this lineage. A newcomer (a member of
-- Season 2) reads Season 1; a player who declined or was removed from Season 2
-- does not read Season 2 (the security review's MEDIUM-4; a decision to confirm).
-- ----------------------------------------------------------------------------
create or replace function public.get_league_history(p_league_id uuid)
returns table(
  league_id              uuid,
  season_number          int,
  is_current             boolean,
  draft_status           text,
  season_id              uuid,
  completed_at           timestamptz,
  champion_user_id       text,
  champion_display_name  text,
  runner_up_user_id      text,
  runner_up_display_name text,
  final_standings        jsonb,
  my_rank                int,
  my_wins                numeric,
  my_losses              numeric,
  my_ties                numeric,
  my_points_for          numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
  v_key    uuid;
  v_max    int;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select coalesce(l.lineage_id, l.id) into v_key from public.leagues l where l.id = p_league_id;
  if not found then
    return;
  end if;
  -- Visibility ceiling: a caller sees every season up to the LATEST one they
  -- were a member of. A newcomer (a member of Season 2) reads Season 1; a player
  -- who declined or was removed from Season 2 does not read Season 2.
  select max(l.season_number) into v_max
    from public.leagues l
    join public.league_members m on m.league_id = l.id and m.user_id = v_caller
   where coalesce(l.lineage_id, l.id) = v_key;
  if v_max is null then
    return;
  end if;

  return query
  select
    l.id,
    l.season_number,
    not exists (select 1 from public.leagues n where n.previous_league_id = l.id),
    l.draft_status,
    s.id,
    s.completed_at,
    s.champion_user_id,
    public.participant_display_name(s.champion_user_id),
    s.runner_up_user_id,
    public.participant_display_name(s.runner_up_user_id),
    case when jsonb_typeof(s.final_standings) = 'array' then (
      select jsonb_agg(e || jsonb_build_object(
               'display_name', public.participant_display_name(e->>'user_id'))
             order by (e->>'rank')::int)
        from jsonb_array_elements(s.final_standings) e)
    end,
    case when jsonb_typeof(s.final_standings) = 'array' then (
      select (e->>'rank')::int from jsonb_array_elements(s.final_standings) e
       where e->>'user_id' = v_caller) end,
    case when jsonb_typeof(s.final_standings) = 'array' then (
      select (e->>'wins')::numeric from jsonb_array_elements(s.final_standings) e
       where e->>'user_id' = v_caller) end,
    case when jsonb_typeof(s.final_standings) = 'array' then (
      select (e->>'losses')::numeric from jsonb_array_elements(s.final_standings) e
       where e->>'user_id' = v_caller) end,
    case when jsonb_typeof(s.final_standings) = 'array' then (
      select (e->>'ties')::numeric from jsonb_array_elements(s.final_standings) e
       where e->>'user_id' = v_caller) end,
    case when jsonb_typeof(s.final_standings) = 'array' then (
      select (e->>'points_for')::numeric from jsonb_array_elements(s.final_standings) e
       where e->>'user_id' = v_caller) end
  from public.leagues l
  left join public.league_seasons s on s.id = l.current_season_id
  where coalesce(l.lineage_id, l.id) = v_key
    and l.season_number <= v_max
  order by l.season_number desc;
end;
$$;

create or replace function public.get_season_matchups(p_league_id uuid)
returns table(
  league_id             uuid,
  season_number         int,
  week_number           int,
  is_playoff            boolean,
  playoff_round_number  smallint,
  bracket_position      smallint,
  week_start            timestamptz,
  week_end              timestamptz,
  team1_user_id         text,
  team1_display_name    text,
  team1_gain            numeric,
  team2_user_id         text,
  team2_display_name    text,
  team2_gain            numeric,
  winner_user_id        text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
  v_key    uuid;
  v_max    int;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select coalesce(l.lineage_id, l.id) into v_key from public.leagues l where l.id = p_league_id;
  if not found then
    return;
  end if;
  -- Same visibility ceiling as get_league_history.
  select max(l.season_number) into v_max
    from public.leagues l
    join public.league_members m on m.league_id = l.id and m.user_id = v_caller
   where coalesce(l.lineage_id, l.id) = v_key;
  if v_max is null then
    return;
  end if;

  -- The draft recap (picks per season) is NOT included: it is a separate read
  -- and is listed as a follow-up in the design.
  return query
  select l.id, l.season_number, mu.week_number, coalesce(mu.is_playoff, false),
         mu.playoff_round_number, mu.bracket_position, mu.week_start, mu.week_end,
         mu.team1_user_id, public.participant_display_name(mu.team1_user_id), mu.team1_gain,
         mu.team2_user_id, public.participant_display_name(mu.team2_user_id), mu.team2_gain,
         mu.winner_user_id
    from public.leagues l
    join public.matchups mu on mu.league_id = l.id
   where coalesce(l.lineage_id, l.id) = v_key
     and l.season_number <= v_max
   order by l.season_number desc, mu.week_number, coalesce(mu.is_playoff, false), mu.bracket_position;
end;
$$;

-- ----------------------------------------------------------------------------
-- set_draft_order: 20261013000000 verbatim, plus the renewal refusal (inserted
-- after the manual-mode check). CREATE OR REPLACE keeps the ACL; re-stated below.
-- ----------------------------------------------------------------------------
create or replace function public.set_draft_order(p_league_id uuid, p_user_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   text := auth.uid()::text;
  v_l     public.leagues%rowtype;
  v_state text;
  v_n     integer;
  v_order jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  select * into v_l from public.leagues where id = p_league_id for no key update;
  if not found or not exists (select 1 from public.league_members
                               where league_id = p_league_id and user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'not_a_member');
  end if;
  if v_l.commissioner_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_commissioner');
  end if;
  if coalesce(v_l.draft_status, 'not_started') <> 'not_started' then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  if v_l.draft_order_mode <> 'manual' then
    return jsonb_build_object('ok', false, 'reason', 'not_manual');
  end if;
  -- Run it back (20261105000002): no manual order while a renewal reply is pending.
  if exists (select 1 from public.league_renewal_responses
              where league_id = p_league_id and status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'renewal_replies_pending');
  end if;

  perform public._draft_order_sync(p_league_id, false);   -- finalize if due; seed if absent
  select state into v_state from public.league_draft_order_meta where league_id = p_league_id;
  if v_state is distinct from 'open' then
    return jsonb_build_object('ok', false, 'reason', 'finalized');
  end if;

  select count(*) into v_n from public.league_members where league_id = p_league_id;
  if p_user_ids is null
     or array_ndims(p_user_ids) is distinct from 1
     or cardinality(p_user_ids) <> v_n
     or array_position(p_user_ids, null) is not null
     or (select count(distinct u) from unnest(p_user_ids) u) <> v_n
     or exists (select u from unnest(p_user_ids) u
                except
                select m.user_id from public.league_members m where m.league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_a_permutation');
  end if;

  delete from public.league_draft_order where league_id = p_league_id;
  insert into public.league_draft_order (league_id, position, user_id)
  select p_league_id, t.ord, t.u from unnest(p_user_ids) with ordinality as t(u, ord);
  update public.league_draft_order_meta set last_edited_at = now() where league_id = p_league_id;

  select jsonb_agg(jsonb_build_object('position', o.position, 'user_id', o.user_id) order by o.position)
    into v_order
    from public.league_draft_order o where o.league_id = p_league_id;
  return jsonb_build_object('ok', true, 'order', v_order);
end;
$$;
-- ----------------------------------------------------------------------------
-- Grants. Each function: revoke PUBLIC, anon, service_role (and authenticated
-- for internal helpers), then grant the client RPCs to authenticated.
-- ----------------------------------------------------------------------------
revoke all on function public._renewal_invite_code() from public, anon, authenticated, service_role;
revoke all on function public._renewal_counts(uuid)  from public, anon, authenticated, service_role;

revoke all on function public.renew_league(uuid)                             from public, anon, service_role;
revoke all on function public.respond_to_renewal(uuid, text)                 from public, anon, service_role;
revoke all on function public.nudge_renewal(uuid, text)                      from public, anon, service_role;
revoke all on function public.remove_renewal_invitee(uuid, text)             from public, anon, service_role;
revoke all on function public.start_renewed_season(uuid, jsonb, jsonb)       from public, anon, service_role;
revoke all on function public.cancel_league_renewal(uuid)                    from public, anon, service_role;
revoke all on function public.get_renewal_roster(uuid)                       from public, anon, service_role;
revoke all on function public.get_league_history(uuid)                       from public, anon, service_role;
revoke all on function public.get_season_matchups(uuid)                      from public, anon, service_role;
revoke all on function public.set_draft_order(uuid, text[])                  from public, anon, service_role;

grant execute on function public.renew_league(uuid)                          to authenticated;
grant execute on function public.respond_to_renewal(uuid, text)              to authenticated;
grant execute on function public.nudge_renewal(uuid, text)                   to authenticated;
grant execute on function public.remove_renewal_invitee(uuid, text)          to authenticated;
grant execute on function public.start_renewed_season(uuid, jsonb, jsonb)    to authenticated;
grant execute on function public.cancel_league_renewal(uuid)                 to authenticated;
grant execute on function public.get_renewal_roster(uuid)                    to authenticated;
grant execute on function public.get_league_history(uuid)                    to authenticated;
grant execute on function public.get_season_matchups(uuid)                   to authenticated;
grant execute on function public.set_draft_order(uuid, text[])               to authenticated;
