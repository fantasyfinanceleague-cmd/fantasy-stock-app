-- ============================================================================
-- Account deletion (5/8): leave_league's pre-draft branch, shared
-- ============================================================================
-- Plan: docs/plans/2026-10-21-account-deletion.md, decision 7 ("Before the
-- draft: same as leaving") and step 4 ("the pre-draft branch of leave_league
-- ... factored into a shared internal function rather than duplicated").
--
-- _leave_league_before_draft(p_league_id, p_user_id, p_leaver_name) is
-- leave_league's applied body (20261110000001) from its "Run it back" read to
-- its return, VERBATIM, with one substitution: the two
-- participant_display_name(p_user_id) calls (the reconfirm entry's name
-- snapshot and the push's leaver_name) read p_leaver_name. leave_league passes
-- participant_display_name(p_user_id), so its behaviour is unchanged;
-- scrub_deleted_manager (20261125000005) passes deleted_manager_label(), so a
-- deleted manager's reconfirm entry never snapshots their name. The PGlite
-- suite diffs both bodies against 20261110000001.
--
-- What the branch does (unchanged): delete the member row (the draft-order and
-- Run-it-back AFTER DELETE triggers keep their tables in step), upsert the
-- commissioner's roster reconfirmation unless the leaver was a renewal
-- invitee, and write one member_left notice for the commissioner (none on a
-- repeat leave while the same confirmation is owed).
--
-- PRECONDITIONS, re-asserted inside (a breach RAISES, rolling the caller back):
-- the league exists, its window is 'before_draft', the leaver is a member and
-- is not the commissioner. The caller holds the leagues row lock (the function
-- re-takes it, a no-op in the same transaction).
--
-- leave_league is re-created with its window/commissioner/hide logic
-- byte-identical and the tail replaced by the call. Its now-unused locals are
-- dropped from its declare block. ACL unchanged (service_role only),
-- re-asserted. The internal is owner-only (no API role may execute it).
--
-- PROVISIONAL TIMESTAMP: see 20261125000000.
--
-- POST-PUSH CHECKS (SQL editor):
--   SELECT proname, proacl FROM pg_proc WHERE proname IN ('leave_league', '_leave_league_before_draft');
--   -- leave_league {postgres=X/postgres,service_role=X/postgres}; _leave_league_before_draft {postgres=X/postgres}
--   Effect: docs/security/leave-league-effect-test.sql still passes (it drives leave_league).
-- ============================================================================

create or replace function public._leave_league_before_draft(
  p_league_id   uuid,
  p_user_id     text,
  p_leaver_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l             public.leagues%rowtype;
  v_invitee       boolean := false;
  v_before        int;
  v_notify        text;
  v_notice        uuid;
  v_reconfirm     boolean;
  v_entry         jsonb;
  v_repeat        boolean := false;
begin
  -- The CALLER's checks, re-asserted: this is reached only from leave_league and
  -- scrub_deleted_manager, both of which hold the leagues row lock and have
  -- already refused everything else. A breach is a bug, so it raises (and rolls
  -- the caller back) rather than returning a refusal.
  select * into v_l from public.leagues where id = p_league_id for update;
  if not found
     or public._league_membership_window(p_league_id) is distinct from 'before_draft'
     or v_l.commissioner_id = p_user_id
     or not exists (select 1 from public.league_members
                     where league_id = p_league_id and user_id = p_user_id) then
    raise exception '_leave_league_before_draft: precondition failed for league %', p_league_id
      using errcode = 'P0001';
  end if;

  -- ---- Run it back (dynamic: #94 may not be on this database) ---------------
  if to_regclass('public.league_renewal_responses') is not null then
    execute 'select exists (select 1 from public.league_renewal_responses
                             where league_id = $1 and user_id = $2)'
       into v_invitee using p_league_id, p_user_id;
  end if;

  -- Every refusal is above this line: nothing has been written yet.
  select count(*)::int into v_before from public.league_members where league_id = p_league_id;

  v_notify := v_l.commissioner_id;   -- 20261110000001: the leaver is never the commissioner now

  delete from public.league_members where league_id = p_league_id and user_id = p_user_id;

  v_reconfirm := not v_invitee;
  -- Left, rejoined, left again while the same confirmation is still owed: the
  -- commissioner already knows. No second notice (push spam via a join/leave
  -- loop, security review), and the commissioner's choice stands.
  select coalesce(r.departed @> jsonb_build_array(jsonb_build_object('user_id', p_user_id)), false)
    into v_repeat
    from public.league_roster_reconfirm r where r.league_id = p_league_id;
  v_repeat := coalesce(v_repeat, false) and v_reconfirm;   -- 20261110000001: no hand-over clause left
  if v_reconfirm then
    -- The name is a SNAPSHOT: once the row is gone, a pre-draft leaver has no
    -- standings/matchups/drafts for get_league_display_names to resolve.
    v_entry := jsonb_build_object('user_id', p_user_id,
                                  'name', p_leaver_name,
                                  'left_at', now());
    insert into public.league_roster_reconfirm as r (league_id, departed, members_before)
    values (p_league_id, jsonb_build_array(v_entry), v_before)
    on conflict (league_id) do update
      set departed  = case when v_repeat then r.departed else r.departed || jsonb_build_array(v_entry) end,
          -- A NEW departure re-opens the question: whatever the commissioner chose
          -- ("Invite someone new") was for a different roster.
          choice    = case when v_repeat then r.choice    else 'pending' end,
          chosen_by = case when v_repeat then r.chosen_by else null end,
          chosen_at = case when v_repeat then r.chosen_at else null end,
          updated_at = now();   -- members_before stays: the count before the FIRST unconfirmed leave
  end if;

  if not v_repeat then
    insert into public.league_notifications (league_id, user_id, kind)
    values (p_league_id, v_notify, 'member_left')
    returning id into v_notice;
  end if;

  return jsonb_build_object(
    'status', 'left',
    'reconfirm_required', v_reconfirm,
    'made_commissioner', false,   -- 20261110000001: kept for the #126-era edge function; always false
    'members_before', v_before,
    'members_after', v_before - 1,
    -- For the edge function's push only; it never forwards these to the client.
    'notice_id', v_notice,
    'notify_user_id', v_notify,
    'leaver_name', p_leaver_name,
    'league_name', v_l.name);
end;
$$;

create or replace function public.leave_league(
  p_league_id        uuid,
  p_user_id          text,
  p_new_commissioner text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l             public.leagues%rowtype;
  v_window        text;
  v_is_comm       boolean;
begin
  if p_league_id is null or p_user_id is null or btrim(p_user_id) = '' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  -- Lock the league FIRST: joins (join_league_by_code), renewal replies, the
  -- draft-order trigger and the commissioner's date edits all serialize on it.
  select * into v_l from public.leagues where id = p_league_id for update;
  -- Uniform for an unknown league and a non-member (no existence oracle).
  if not found or p_user_id like 'bot-%' or not exists (
       select 1 from public.league_members
        where league_id = p_league_id and user_id = p_user_id) then
    return jsonb_build_object('status', 'refused', 'reason', 'not_member');
  end if;

  -- ---- 20261110000001: the window comes from the ONE helper transfer_commissioner
  -- also reads, so leaving and handing over the title can never drift apart.
  v_window := public._league_membership_window(p_league_id);
  if v_window = 'locked_season' then
    return jsonb_build_object('status', 'refused', 'reason', 'locked_in', 'window', 'season');
  elsif v_window = 'locked_order_set' then
    return jsonb_build_object('status', 'refused', 'reason', 'locked_in', 'window', 'order_set');
  end if;

  -- ---- 20261110000001: the commissioner transfers first (Q4 = A), in BOTH open
  -- windows. Before any Run-it-back read: this also covers the renewal
  -- commissioner, who must not reach #94's delete trigger.
  v_is_comm := v_l.commissioner_id = p_user_id;
  if v_is_comm then
    return jsonb_build_object('status', 'refused', 'reason', 'transfer_first');
  end if;
  if p_new_commissioner is not null then
    return jsonb_build_object('status', 'refused', 'reason', 'successor_not_allowed');
  end if;

  -- ---- After the season: hide, never delete ---------------------------------
  if v_window = 'after_season' then
    update public.league_members
       set hidden_at = now()
     where league_id = p_league_id and user_id = p_user_id and hidden_at is null;
    return jsonb_build_object('status', 'hidden', 'already_hidden', not found);
  end if;

  -- ---- Before the draft: the shared branch (20261125000004) -------------------
  -- 20261125000004: the body that was here is now _leave_league_before_draft,
  -- verbatim, so account deletion runs the SAME leave. The name snapshot is the
  -- leaver's own display name, exactly as before.
  return public._leave_league_before_draft(p_league_id, p_user_id, public.participant_display_name(p_user_id));
end;
$$;

revoke all on function public._leave_league_before_draft(uuid, text, text) from public, anon, authenticated, service_role;

revoke all on function public.leave_league(uuid, text, text) from public;
revoke all on function public.leave_league(uuid, text, text) from anon;
revoke all on function public.leave_league(uuid, text, text) from authenticated;
grant execute on function public.leave_league(uuid, text, text) to service_role;
